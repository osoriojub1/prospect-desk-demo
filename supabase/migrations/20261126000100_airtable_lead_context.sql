begin;

create or replace function public.outreach_airtable_action(p_owner uuid, p_action text, p_data jsonb)
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
    -- An older worker expects a different Airtable payload.
    if p_data->>'pipeline' is distinct from 'interested' then return '{"items":[]}'::jsonb; end if;

    -- Return the same immutable batch if n8n retries a claim after losing the response.
    if not exists (
      select 1 from public.airtable_syncs q where q.owner_id = p_owner and q.execution_id = execution_key
        and q.qualified_reply_id is not null and q.status = 'syncing' and q.lease_expires_at > now()
    ) then
      with next_batch as (
        select q.prospect_id, jsonb_build_object(
          'prospectId', p.id, 'company', p.name, 'email', reply.sender, 'domain', p.domain,
          'contact', nullif(btrim(r.research_snapshot #>> '{contact,name}'), ''),
          'offer', coalesce(nullif(btrim(c.offer), ''), sent.subject),
          'researchSummary', r.research_snapshot->>'rationale', 'reply', reply.message
        ) as payload
        from public.airtable_syncs q
        join public.prospects p on p.id = q.prospect_id and p.owner_id = q.owner_id
        join public.outreach_replies reply on reply.id = q.qualified_reply_id and reply.owner_id = q.owner_id
        join public.outreach_send_items sent on sent.id = reply.send_item_id and sent.owner_id = q.owner_id and sent.status = 'sent'
        join public.outreach_recipients r on r.id = sent.recipient_id and r.prospect_id = p.id and r.owner_id = q.owner_id
        left join public.outreach_campaigns c on c.id = r.campaign_id and c.owner_id = q.owner_id
        where q.owner_id = p_owner and p.stage = 'Replied' and not p.do_not_contact
          and reply.outcome in ('Hot', 'Warm', 'Needs nurture') and q.airtable_record_id is null
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
      and q.qualified_reply_id is not null and q.status = 'syncing' and q.lease_expires_at > now();
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

commit;
