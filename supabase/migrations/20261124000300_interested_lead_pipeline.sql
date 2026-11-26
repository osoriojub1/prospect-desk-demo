begin;

alter table public.outreach_replies drop constraint outreach_replies_outcome_check;
alter table public.outreach_replies add constraint outreach_replies_outcome_check
  check (outcome in ('Hot', 'Warm', 'Needs nurture', 'Do not contact', 'No interest shown'));

-- Legacy outcomes included ambiguous declines. A new CRM entry needs a qualifying reply.
alter table public.airtable_syncs add column qualified_reply_id uuid
  references public.outreach_replies(id) on delete set null;

drop trigger queue_airtable_sync on public.outreach_replies;
drop function outreach_private.queue_airtable_sync();

create or replace function public.outreach_worker_action(p_owner uuid, p_action text, p_data jsonb, p_mailbox text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  job public.outreach_jobs;
  item public.outreach_send_items;
  reply public.outreach_replies;
  latest_results jsonb;
  result text;
  airtable_queued boolean := false;
  workflow_name text;
  execution_key text := nullif(p_data->>'executionId', '');
  message_id text := nullif(p_data->>'messageId', '');
  thread_id text := nullif(p_data->>'threadId', '');
  sender_address text := lower(btrim(p_data->>'sender'));
  draft_subject text := btrim(p_data->>'subject');
  message_body text := btrim(p_data->>'message');
begin
  perform outreach_private.lock_owner(p_owner);

  if p_action = 'match_reply' or p_action = 'record_reply' then
    select * into item from public.outreach_send_items i
    where i.owner_id = p_owner and i.mailbox = p_mailbox and i.status = 'sent'
      and i.gmail_thread_id = thread_id and i.address = sender_address and i.gmail_message_id <> message_id
    order by i.finished_at desc limit 1;
    if not found then return '{"matched":false}'::jsonb; end if;

    select * into reply from public.outreach_replies r
    where r.owner_id = p_owner and r.mailbox = p_mailbox and r.gmail_message_id = message_id;
    if p_action = 'match_reply' then
      return jsonb_build_object('matched', true, 'sendItemId', item.id, 'needsBody', reply.id is null,
        'replyId', reply.id, 'needsTriage', reply.id is not null and reply.outcome is null, 'message', reply.message);
    end if;
    if reply.id is not null then
      return jsonb_build_object('replyId', reply.id, 'needsTriage', reply.outcome is null, 'message', reply.message);
    end if;
    if coalesce(length(message_body), 0) not between 1 and 12000 or message_id is null or
      nullif(p_data->>'receivedAt', '') is null or (p_data->>'sendItemId')::uuid is distinct from item.id then
      raise exception 'Invalid reply details.' using errcode = '22023';
    end if;
    if (p_data->>'receivedAt')::timestamptz < item.attempted_at then return '{"matched":false}'::jsonb; end if;

    insert into public.outreach_replies (send_item_id, owner_id, mailbox, gmail_message_id, sender, message, received_at)
    values (item.id, p_owner, p_mailbox, message_id, sender_address, message_body, (p_data->>'receivedAt')::timestamptz)
    returning * into reply;
    update public.prospects p set stage = 'Replied', replied_at = greatest(p.replied_at, reply.received_at)
    from public.outreach_recipients r where r.id = item.recipient_id and p.id = r.prospect_id;
    return jsonb_build_object('replyId', reply.id, 'needsTriage', true, 'message', reply.message);
  end if;

  if p_action = 'triage_reply' then
    select * into reply from public.outreach_replies r where r.id = (p_data->>'replyId')::uuid and r.owner_id = p_owner;
    if not found then return null; end if;
    if reply.outcome is not null then
      return jsonb_build_object('updated', true, 'airtableQueued', exists (
        select 1 from public.airtable_syncs q where q.owner_id = p_owner
          and q.qualified_reply_id = reply.id and q.status in ('pending', 'syncing')
      ));
    end if;

    result := p_data->>'outcome';
    select * into item from public.outreach_send_items i where i.id = reply.send_item_id and i.owner_id = p_owner;
    if result = 'failed' then
      select * into job from public.outreach_jobs j where j.id = item.job_id;
      perform outreach_private.log_event(p_owner, 'reply:' || reply.id, 'n8n', 'Reply triage failed',
        'The reply is available in Email Activity.', job.campaign_id, execution_key);
      return '{"updated":false}'::jsonb;
    end if;
    if result is null or result not in ('Hot', 'Warm', 'Needs nurture', 'Do not contact', 'No interest shown') then
      raise exception 'Invalid reply triage.' using errcode = '22023';
    end if;

    update public.outreach_replies set outcome = result where id = reply.id;
    if result <> 'No interest shown' then
      update public.prospects p set do_not_contact = p.do_not_contact or result = 'Do not contact',
        triage = case when p.do_not_contact or result = 'Do not contact' then null else result end
      from public.outreach_recipients r where r.id = item.recipient_id and p.id = r.prospect_id and p.owner_id = p_owner
        and (result = 'Do not contact' or p.replied_at <= reply.received_at);
    end if;

    if result = 'Do not contact' then
      update public.airtable_syncs q set qualified_reply_id = null, updated_at = now()
      from public.outreach_recipients r where r.id = item.recipient_id and q.prospect_id = r.prospect_id
        and q.owner_id = p_owner and q.airtable_record_id is null and q.qualified_reply_id is not null;
    elsif p_data->'interestConfirmed' = 'true'::jsonb and result in ('Hot', 'Warm', 'Needs nurture') then
      insert into public.airtable_syncs as q (prospect_id, owner_id, qualified_reply_id)
      select p.id, p.owner_id, reply.id
      from public.outreach_recipients r
      join public.prospects p on p.id = r.prospect_id and p.owner_id = r.owner_id
      where r.id = item.recipient_id and p.owner_id = p_owner and item.status = 'sent'
        and p.stage = 'Replied' and not p.do_not_contact
      on conflict (prospect_id) do update set qualified_reply_id = excluded.qualified_reply_id,
        status = 'pending', revision = q.revision + 1, failure_code = null, claimed_payload = null,
        claimed_revision = null, execution_id = null, lease_expires_at = null, updated_at = now()
      where q.qualified_reply_id is null and q.airtable_record_id is null
      returning true into airtable_queued;
    end if;

    return jsonb_build_object('updated', true, 'airtableQueued', coalesce(airtable_queued, false));
  end if;

  if p_action = 'report_error' then
    workflow_name := p_data->>'workflow';
    if workflow_name is null or workflow_name not in ('Prospect Desk - Lead discovery', 'Prospect Desk - Draft outreach',
      'Prospect Desk - Send outreach', 'Prospect Desk - Detect Gmail replies', 'Prospect Desk - Sync Airtable leads') then
      return '{"recorded":false}'::jsonb;
    end if;
    select * into job from public.outreach_jobs j
    where j.owner_id = p_owner and j.execution_id = execution_key
      and (workflow_name = 'Prospect Desk - Draft outreach' and j.kind = 'draft'
        or workflow_name = 'Prospect Desk - Send outreach' and j.kind = 'send')
    order by j.created_at desc limit 1;
    if found then
      if job.status in ('queued', 'running') then
        perform outreach_private.finish_job(job.id, 'The workflow stopped. Review the execution in n8n.');
      end if;
    elsif workflow_name <> 'Prospect Desk - Lead discovery' or not exists (
      select 1 from public.research_runs r where r.owner_id = p_owner and r.execution_id = execution_key
    ) then
      perform outreach_private.log_event(p_owner,
        'workflow:' || workflow_name || ':' || coalesce(execution_key, p_data->>'occurredAt', 'unknown'), 'n8n',
        workflow_name || ' failed', 'Review the workflow in n8n.', null, execution_key);
    end if;
    return '{"recorded":true}'::jsonb;
  end if;

  select * into job from public.outreach_jobs j where j.id = (p_data->>'jobId')::uuid and j.owner_id = p_owner;
  if not found then return null; end if;
  if p_action = 'claim_job' then
    if job.kind is distinct from p_data->>'kind' or execution_key is null or
      (job.status <> 'queued' and (job.status <> 'running' or job.execution_id is distinct from execution_key)) then
      return '{"claimed":false}'::jsonb;
    end if;
    update public.outreach_jobs set execution_id = execution_key, status = 'running', updated_at = now() where id = job.id;
    if job.kind = 'draft' then
      select coalesce(jsonb_agg(jsonb_build_object('recipientId', r.id, 'revision', r.revision,
        'research', r.research_snapshot, 'previousSubject', r.subject, 'previousMessage', r.message) order by r.id), '[]')
      into latest_results from public.outreach_recipients r where r.draft_job_id = job.id and r.draft_status = 'pending';
    else
      select coalesce(jsonb_agg(jsonb_build_object('sendItemId', i.id) order by i.id), '[]')
      into latest_results from public.outreach_send_items i where i.job_id = job.id and i.status = 'queued';
    end if;
    if jsonb_array_length(latest_results) = 0 then
      perform outreach_private.finish_job(job.id);
      return '{"claimed":false}'::jsonb;
    end if;
    return jsonb_build_object('claimed', true, 'items', latest_results);
  end if;

  if job.execution_id is distinct from execution_key or execution_key is null then return null; end if;
  if p_action = 'finish_job' then return outreach_private.finish_job(job.id); end if;
  if job.status <> 'running' then return null; end if;
  update public.outreach_jobs set updated_at = now() where id = job.id;

  if p_action = 'record_draft' and job.kind = 'draft' then
    if p_data->>'outcome' = 'ready' and coalesce(length(draft_subject), 0) between 1 and 160
      and draft_subject !~ E'[\r\n]' and coalesce(length(message_body), 0) between 1 and 8000 then
      update public.outreach_recipients r set draft_status = 'ready', subject = draft_subject,
        message = message_body, revision = r.revision + 1, approved_revision = null
      where r.id = (p_data->>'recipientId')::uuid and r.draft_job_id = job.id and r.draft_status = 'pending'
        and r.revision = (p_data->>'revision')::integer;
    else
      update public.outreach_recipients r set draft_status = 'failed', approved_revision = null
      where r.id = (p_data->>'recipientId')::uuid and r.draft_job_id = job.id and r.draft_status = 'pending'
        and r.revision = (p_data->>'revision')::integer;
    end if;
    return jsonb_build_object('updated', found);
  end if;

  if job.kind = 'send' and p_action in ('claim_send', 'record_send') then
    select * into item from public.outreach_send_items i where i.id = (p_data->>'sendItemId')::uuid and i.job_id = job.id;
    if not found then return null; end if;
    if p_action = 'claim_send' then
      if item.status <> 'queued' then return '{"ready":false}'::jsonb; end if;
      if not exists (
        select 1 from public.outreach_recipients r join public.prospects p on p.id = r.prospect_id
        where r.id = item.recipient_id and r.released_at is null and r.revision = item.revision and r.approved_revision = item.revision
          and r.address = item.address and p.stage = 'Generated' and p.contacted_at is null and p.replied_at is null and not p.do_not_contact
          and r.draft_status in ('ready', 'failed')
      ) then
        update public.outreach_send_items set status = 'not_sent', failure_code = 'ineligible', finished_at = now() where id = item.id;
        return '{"ready":false}'::jsonb;
      end if;
      update public.outreach_send_items set status = 'sending', attempted_at = now() where id = item.id;
      return jsonb_build_object('ready', true, 'sendItemId', item.id, 'address', item.address, 'subject', item.subject, 'message', item.message);
    end if;

    if item.status <> 'sending' then return '{"updated":false}'::jsonb; end if;
    result := p_data->>'outcome';
    if result is null or result not in ('sent', 'not_sent', 'uncertain') or
      (result = 'sent' and (message_id is null or thread_id is null)) then
      raise exception 'Invalid delivery outcome.' using errcode = '22023';
    end if;
    update public.outreach_send_items set status = result, finished_at = now(),
      failure_code = case result when 'not_sent' then 'gmail_rejected' when 'uncertain' then 'gmail_unconfirmed' end,
      gmail_message_id = case when result = 'sent' then message_id end,
      gmail_thread_id = case when result = 'sent' then thread_id end where id = item.id;
    if result = 'sent' then
      update public.prospects p set stage = case when p.stage = 'Generated' then 'Contacted' else p.stage end,
        contacted_at = coalesce(p.contacted_at, now()) from public.outreach_recipients r
      where r.id = item.recipient_id and p.id = r.prospect_id;
    end if;
    return '{"updated":true}'::jsonb;
  end if;

  raise exception 'Unknown outreach workflow action.' using errcode = '22023';
end;
$$;

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
          'prospectId', p.id, 'company', p.name, 'email', reply.sender,
          'contact', case when r.research_snapshot->>'emailKind' = 'direct' then r.research_snapshot #>> '{contact,name}' end
        ) as payload
        from public.airtable_syncs q
        join public.prospects p on p.id = q.prospect_id and p.owner_id = q.owner_id
        join public.outreach_replies reply on reply.id = q.qualified_reply_id and reply.owner_id = q.owner_id
        join public.outreach_send_items sent on sent.id = reply.send_item_id and sent.owner_id = q.owner_id and sent.status = 'sent'
        join public.outreach_recipients r on r.id = sent.recipient_id and r.prospect_id = p.id and r.owner_id = q.owner_id
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
