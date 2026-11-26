begin;

create table public.airtable_syncs (
  prospect_id uuid primary key references public.prospects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'syncing', 'synced', 'failed')),
  revision integer not null default 1,
  airtable_record_id text,
  last_synced_at timestamptz,
  failure_code text,
  execution_id text,
  claimed_revision integer,
  claimed_payload jsonb,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index airtable_syncs_owner_pending on public.airtable_syncs (owner_id, updated_at, prospect_id)
  where status <> 'synced';

alter table public.airtable_syncs enable row level security;
revoke all on public.airtable_syncs from anon, authenticated;
grant select on public.airtable_syncs to authenticated;
grant select, insert, update on public.airtable_syncs to service_role;
create policy "Read own Airtable syncs" on public.airtable_syncs for select to authenticated
  using ((select auth.uid()) = owner_id);
alter publication supabase_realtime add table public.airtable_syncs;

create function outreach_private.queue_airtable_sync()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.outcome is not distinct from old.outcome then return new; end if;

  insert into public.airtable_syncs as queue (prospect_id, owner_id)
  select recipient.prospect_id, new.owner_id
  from public.outreach_send_items sent
  join public.outreach_recipients recipient on recipient.id = sent.recipient_id and recipient.owner_id = new.owner_id
  where sent.id = new.send_item_id and sent.owner_id = new.owner_id and sent.status = 'sent'
  on conflict (prospect_id) do update set revision = queue.revision + 1,
    status = case when queue.status = 'syncing' then 'syncing' else 'pending' end,
    failure_code = null, updated_at = now();

  return new;
end;
$$;

create trigger queue_airtable_sync after insert or update of outcome on public.outreach_replies
for each row when (new.outcome is not null) execute function outreach_private.queue_airtable_sync();

insert into public.airtable_syncs (prospect_id, owner_id)
select distinct prospect.id, prospect.owner_id
from public.outreach_replies reply
join public.outreach_send_items sent on sent.id = reply.send_item_id and sent.owner_id = reply.owner_id
join public.outreach_recipients recipient on recipient.id = sent.recipient_id and recipient.owner_id = reply.owner_id
join public.prospects prospect on prospect.id = recipient.prospect_id and prospect.owner_id = reply.owner_id
where reply.outcome is not null and sent.status = 'sent' and prospect.stage = 'Replied';

create function public.outreach_airtable_action(p_owner uuid, p_action text, p_data jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  execution_key text := p_data->>'executionId';
  retry_failed boolean := coalesce((p_data->>'retryFailed')::boolean, false);
  sync_items jsonb;
  result record;
  updated_count integer := 0;
begin
  perform outreach_private.lock_owner(p_owner);

  if p_action = 'claim_airtable_sync' then
    -- Return the same immutable batch if n8n retries a claim after losing the response.
    if not exists (
      select 1 from public.airtable_syncs q where q.owner_id = p_owner and q.execution_id = execution_key
        and q.status = 'syncing' and q.lease_expires_at > now()
    ) then
      with next_batch as (
        select q.prospect_id, jsonb_build_object(
          'prospectId', p.id, 'company', p.name, 'domain', p.domain,
          'researchSummary', coalesce(latest.summary, ''), 'lastReplyAt', latest.received_at,
          'triage', case when not p.do_not_contact and latest.outcome <> 'Do not contact' then latest.outcome end,
          'doNotContact', p.do_not_contact or latest.outcome = 'Do not contact'
        ) as payload
        from public.airtable_syncs q
        join public.prospects p on p.id = q.prospect_id and p.owner_id = q.owner_id
        join lateral (
          select r.research_snapshot->>'rationale' as summary, reply.received_at, reply.outcome
          from public.outreach_recipients r
          join public.outreach_send_items sent on sent.recipient_id = r.id and sent.owner_id = r.owner_id and sent.status = 'sent'
          join public.outreach_replies reply on reply.send_item_id = sent.id and reply.owner_id = r.owner_id
          where r.prospect_id = p.id and r.owner_id = p_owner and reply.outcome is not null
          order by reply.received_at desc, reply.id desc limit 1
        ) latest on true
        where q.owner_id = p_owner and p.stage = 'Replied'
          and (q.status = 'pending' or (retry_failed and q.status = 'failed')
            or (q.status = 'syncing' and q.lease_expires_at <= now()))
        order by q.updated_at, q.prospect_id limit 10
      )
      update public.airtable_syncs q set status = 'syncing', claimed_revision = q.revision,
        claimed_payload = next_batch.payload, execution_id = execution_key, lease_expires_at = now() + interval '3 minutes',
        failure_code = null, updated_at = now()
      from next_batch where q.prospect_id = next_batch.prospect_id;
    end if;

    select coalesce(jsonb_agg(q.claimed_payload || jsonb_build_object('revision', q.claimed_revision) order by q.prospect_id), '[]')
    into sync_items from public.airtable_syncs q where q.owner_id = p_owner and q.execution_id = execution_key
      and q.status = 'syncing' and q.lease_expires_at > now();
    return jsonb_build_object('items', sync_items);
  end if;

  if p_action <> 'record_airtable_sync' then raise exception 'Unknown Airtable sync action.' using errcode = '22023'; end if;

  for result in
    update public.airtable_syncs q set
      status = case when q.revision > response.revision then 'pending'
        when response."recordId" is not null then 'synced' else 'failed' end,
      airtable_record_id = coalesce(response."recordId", q.airtable_record_id),
      last_synced_at = case when response."recordId" is not null then now() else q.last_synced_at end,
      failure_code = case when q.revision = response.revision then response."errorCode" end,
      claimed_payload = null, claimed_revision = null, execution_id = null, lease_expires_at = null, updated_at = now()
    from jsonb_to_recordset(p_data->'results') as response("prospectId" uuid, revision integer, "recordId" text, "errorCode" text)
    where q.prospect_id = response."prospectId" and q.owner_id = p_owner and q.execution_id = execution_key
      and q.status = 'syncing' and q.claimed_revision = response.revision
    returning q.prospect_id, response.revision, response."errorCode" as failure
  loop
    updated_count := updated_count + 1;
    if result.failure is not null then
      perform outreach_private.log_event(p_owner, 'airtable:' || result.prospect_id || ':' || result.revision,
        'Airtable', 'Lead sync failed', case result.failure
          when 'airtable_access' then 'Check the Airtable credential and its access to the demo base.'
          when 'airtable_target' then 'Check the demo Airtable base and table IDs.'
          when 'airtable_fields' then 'Check the Airtable field names, types, and Lead ID values.'
          when 'airtable_rate_limit' then 'Airtable limited requests. Retry the saved sync in n8n.'
          else 'Airtable did not confirm the write. Retry the saved sync in n8n.'
        end, null, execution_key);
    end if;
  end loop;

  return jsonb_build_object('updated', updated_count);
end;
$$;

revoke execute on function public.outreach_airtable_action(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.outreach_airtable_action(uuid, text, jsonb) to service_role;

commit;
