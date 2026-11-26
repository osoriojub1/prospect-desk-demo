begin;

create schema outreach_private;

create table public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.outreach_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('draft', 'send')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  dispatch_id bigint,
  execution_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, request_id)
);

create table public.outreach_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  prospect_id uuid not null references public.prospects on delete cascade,
  address text not null,
  research_snapshot jsonb not null,
  draft_job_id uuid not null references public.outreach_jobs on delete cascade,
  draft_status text not null default 'pending' check (draft_status in ('pending', 'ready', 'failed', 'skipped')),
  revision integer not null default 0,
  approved_revision integer,
  subject text,
  message text,
  released_at timestamptz,
  unique (campaign_id, prospect_id)
);

create unique index outreach_one_reserved_prospect on public.outreach_recipients (prospect_id)
  where released_at is null;
create index outreach_draft_job_items on public.outreach_recipients (draft_job_id);

create table public.outreach_send_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.outreach_jobs on delete cascade,
  recipient_id uuid not null references public.outreach_recipients on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null,
  address text not null,
  subject text not null,
  message text not null,
  mailbox text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'not_sent', 'uncertain')),
  failure_code text,
  gmail_message_id text,
  gmail_thread_id text,
  attempted_at timestamptz,
  finished_at timestamptz,
  unique (job_id, recipient_id),
  unique (mailbox, gmail_message_id)
);

create unique index outreach_one_live_send on public.outreach_send_items (recipient_id)
  where status in ('queued', 'sending', 'sent', 'uncertain');
create index outreach_gmail_threads on public.outreach_send_items (owner_id, mailbox, gmail_thread_id, address)
  where status = 'sent';

create table public.outreach_replies (
  id uuid primary key default gen_random_uuid(),
  send_item_id uuid not null references public.outreach_send_items on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  mailbox text not null,
  gmail_message_id text not null,
  sender text not null,
  message text not null,
  received_at timestamptz not null,
  read_at timestamptz,
  outcome text check (outcome in ('Hot', 'Warm', 'Needs nurture', 'Do not contact')),
  unique (mailbox, gmail_message_id)
);

create table public.system_log_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  source text not null,
  title text not null,
  detail text not null,
  campaign_id uuid references public.outreach_campaigns on delete set null,
  execution_id text,
  occurred_at timestamptz not null default now(),
  read_at timestamptz,
  unique (owner_id, event_key)
);

alter table public.outreach_campaigns enable row level security;
alter table public.outreach_jobs enable row level security;
alter table public.outreach_recipients enable row level security;
alter table public.outreach_send_items enable row level security;
alter table public.outreach_replies enable row level security;
alter table public.system_log_events enable row level security;

do $$
declare relation text;
begin
  foreach relation in array array[
    'outreach_campaigns', 'outreach_jobs', 'outreach_recipients',
    'outreach_send_items', 'outreach_replies', 'system_log_events'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    execute format('grant select, insert, update on public.%I to service_role', relation);
    execute format('create policy "Read own records" on public.%I for select to authenticated using ((select auth.uid()) = owner_id)', relation);
    execute format('alter publication supabase_realtime add table public.%I', relation);
  end loop;
end $$;

create function outreach_private.lock_owner(p_owner uuid)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('prospect-desk-outreach:' || p_owner::text, 0));
$$;

create function outreach_private.log_event(
  p_owner uuid, p_key text, p_source text, p_title text, p_detail text,
  p_campaign uuid default null, p_execution text default null
)
returns void language sql set search_path = '' as $$
  insert into public.system_log_events (owner_id, event_key, source, title, detail, campaign_id, execution_id)
  values (p_owner, p_key, p_source, p_title, p_detail, p_campaign, p_execution)
  on conflict (owner_id, event_key) do nothing;
$$;

create function outreach_private.dispatch_job(p_job uuid, p_url text, p_key text)
returns void language sql set search_path = '' as $$
  update public.outreach_jobs set dispatch_id = net.http_post(
    url := p_url,
    body := jsonb_build_object('jobId', p_job),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-outreach-key', p_key),
    timeout_milliseconds := 10000
  ) where id = p_job;
$$;

create function outreach_private.finish_job(p_job uuid, p_reason text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  job public.outreach_jobs;
  waiting integer;
  succeeded integer;
  failed integer;
  final_status text;
begin
  select * into job from public.outreach_jobs where id = p_job for update;
  if not found then return null; end if;
  if job.status not in ('queued', 'running') then return jsonb_build_object('status', job.status); end if;

  if job.kind = 'draft' then
    if p_reason is not null then
      update public.outreach_recipients set draft_status = 'failed'
      where draft_job_id = job.id and draft_status = 'pending';
    end if;
    select count(*) filter (where draft_status = 'pending'), count(*) filter (where draft_status = 'ready'),
      count(*) filter (where draft_status = 'failed') into waiting, succeeded, failed
    from public.outreach_recipients where draft_job_id = job.id;
  else
    if p_reason is not null then
      update public.outreach_send_items
      set status = case when status = 'sending' then 'uncertain' else 'not_sent' end,
        failure_code = 'workflow_interrupted', finished_at = now()
      where job_id = job.id and status in ('queued', 'sending');
    end if;
    select count(*) filter (where status in ('queued', 'sending')), count(*) filter (where status = 'sent'),
      count(*) filter (where status in ('not_sent', 'uncertain')) into waiting, succeeded, failed
    from public.outreach_send_items where job_id = job.id;
  end if;

  if waiting > 0 then return jsonb_build_object('status', job.status, 'pending', waiting); end if;
  final_status := case when failed > 0 and succeeded > 0 then 'partial'
    when failed > 0 or p_reason is not null then 'failed' else 'completed' end;
  update public.outreach_jobs set status = final_status, updated_at = now() where id = job.id;

  if final_status in ('failed', 'partial') then
    perform outreach_private.log_event(job.owner_id, 'job:' || job.id, 'n8n',
      case when job.kind = 'draft' then 'Draft generation needs attention' else 'Email delivery needs attention' end,
      coalesce(p_reason, case when job.kind = 'draft' then failed || ' draft(s) could not be generated.'
        else failed || ' email(s) need attention. Open Email Activity for the results.' end),
      job.campaign_id, job.execution_id);
  end if;

  return jsonb_build_object('status', final_status, 'succeeded', succeeded, 'failed', failed);
end;
$$;

create function public.outreach_user_action(
  p_owner uuid, p_action text, p_data jsonb, p_mailbox text, p_webhook_url text, p_worker_key text
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  campaign_key uuid;
  job_key uuid;
  request_key uuid;
  recipient public.outreach_recipients;
  body text := btrim(p_data->>'message');
  draft_subject text := btrim(p_data->>'subject');
  draft_version integer := (p_data->>'revision')::integer;
  selected jsonb;
  item_count integer;
begin
  perform outreach_private.lock_owner(p_owner);

  if p_action in ('create_campaign', 'regenerate', 'queue_send') then
    request_key := (p_data->>'requestId')::uuid;
    if request_key is null then raise exception 'A request ID is required.' using errcode = '22023'; end if;
    select j.id, j.campaign_id into job_key, campaign_key from public.outreach_jobs j
    where j.owner_id = p_owner and j.request_id = request_key;
    if found then return jsonb_build_object('jobId', job_key, 'campaignId', campaign_key); end if;
    if nullif(p_webhook_url, '') is null or nullif(p_worker_key, '') is null then
      raise exception 'Connect the outreach workflow first.' using errcode = '22023';
    end if;
  end if;

  if p_action = 'create_campaign' then
    selected := p_data->'prospectIds';
    if coalesce(length(btrim(p_data->>'name')), 0) not between 1 and 120 or
      jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected) not between 1 and 50 then
      raise exception 'Enter a campaign name and select up to 50 prospects.' using errcode = '22023';
    end if;

    insert into public.outreach_campaigns (owner_id, name, filters)
    values (p_owner, btrim(p_data->>'name'), jsonb_build_object('industry', p_data->>'industry', 'location', p_data->>'location'))
    returning id into campaign_key;
    insert into public.outreach_jobs (owner_id, campaign_id, request_id, kind)
    values (p_owner, campaign_key, request_key, 'draft') returning id into job_key;

    insert into public.outreach_recipients (owner_id, campaign_id, prospect_id, address, research_snapshot, draft_job_id)
    select p_owner, campaign_key, prospect.id, lower(btrim(research.contact_email)),
      jsonb_build_object('company', prospect.name, 'industry', research.industry, 'location', research.location,
        'contact', research.contact, 'evidence', research.evidence, 'rationale', research.rationale), job_key
    from public.prospects prospect
    join lateral (
      select r.* from public.run_prospects r where r.prospect_id = prospect.id and r.owner_id = p_owner
      order by r.recorded_at desc, r.run_id desc limit 1
    ) research on true
    where prospect.id in (select value::uuid from jsonb_array_elements_text(selected)) and prospect.owner_id = p_owner
      and prospect.stage = 'Generated' and prospect.contacted_at is null and prospect.replied_at is null and not prospect.do_not_contact
      and length(btrim(research.contact_email)) <= 254
      and btrim(research.contact_email) ~* '^[^[:space:]@<>,;]+@[a-z0-9.-]+[.][a-z]{2,}$'
      and (coalesce(p_data->>'industry', '') = '' or research.industry = p_data->>'industry')
      and (coalesce(p_data->>'location', '') = '' or research.location = p_data->>'location')
    on conflict do nothing;

    get diagnostics item_count = row_count;
    if item_count <> jsonb_array_length(selected) then
      raise exception 'The audience changed. Review the eligible prospects and try again.' using errcode = '22023';
    end if;
  elsif p_action = 'queue_send' then
    selected := p_data->'items';
    if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected) not between 1 and 50 then
      raise exception 'Confirm up to 50 approved drafts.' using errcode = '22023';
    end if;
    select c.id into campaign_key from public.outreach_campaigns c
    where c.id = (p_data->>'campaignId')::uuid and c.owner_id = p_owner;
    if not found then return null; end if;

    insert into public.outreach_jobs (owner_id, campaign_id, request_id, kind)
    values (p_owner, campaign_key, request_key, 'send') returning id into job_key;
    insert into public.outreach_send_items (job_id, recipient_id, owner_id, revision, address, subject, message, mailbox)
    select job_key, r.id, p_owner, r.revision, r.address, r.subject, r.message, p_mailbox
    from jsonb_to_recordset(selected) as approved("recipientId" uuid, revision integer)
    join public.outreach_recipients r on r.id = approved."recipientId"
    join public.prospects p on p.id = r.prospect_id and p.owner_id = p_owner
    where r.campaign_id = campaign_key and r.owner_id = p_owner and r.released_at is null
      and r.draft_status in ('ready', 'failed') and r.approved_revision = r.revision and r.revision = approved.revision
      and p.stage = 'Generated' and p.contacted_at is null and p.replied_at is null and not p.do_not_contact
    on conflict do nothing;

    get diagnostics item_count = row_count;
    if item_count <> jsonb_array_length(selected) then
      raise exception 'The approved drafts changed. Review and confirm the batch again.' using errcode = '22023';
    end if;
  elsif p_action = 'read_replies' then
    update public.outreach_replies set read_at = now()
    where owner_id = p_owner and send_item_id = (p_data->>'sendItemId')::uuid and read_at is null;
    return '{"updated":true}'::jsonb;
  elsif p_action = 'read_logs' then
    update public.system_log_events set read_at = now() where owner_id = p_owner and read_at is null;
    return '{"updated":true}'::jsonb;
  else
    select * into recipient from public.outreach_recipients r
    where r.id = (p_data->>'recipientId')::uuid and r.owner_id = p_owner and r.released_at is null;
    if not found then return null; end if;
    if draft_version is distinct from recipient.revision or exists (
      select 1 from public.outreach_send_items i where i.recipient_id = recipient.id
      and i.status in ('queued', 'sending', 'sent', 'uncertain')
    ) then
      raise exception 'Refresh this draft before making changes.' using errcode = '22023';
    end if;

    if p_action = 'skip_draft' then
      update public.outreach_recipients set draft_status = 'skipped', approved_revision = null, released_at = now()
      where id = recipient.id;
      return '{"updated":true}'::jsonb;
    end if;
    if recipient.draft_status = 'pending' then
      raise exception 'The draft is still generating.' using errcode = '22023';
    end if;

    if p_action = 'regenerate' then
      campaign_key := recipient.campaign_id;
      insert into public.outreach_jobs (owner_id, campaign_id, request_id, kind)
      values (p_owner, campaign_key, request_key, 'draft') returning id into job_key;
      update public.outreach_recipients set draft_job_id = job_key, draft_status = 'pending', approved_revision = null
      where id = recipient.id;
    elsif p_action = 'edit_draft' then
      if coalesce(length(draft_subject), 0) not between 1 and 160 or draft_subject ~ E'[\\r\\n]' or
        coalesce(length(body), 0) not between 1 and 8000 then
        raise exception 'Enter an email subject and message.' using errcode = '22023';
      end if;
      update public.outreach_recipients set subject = draft_subject, message = body,
        revision = recipient.revision + 1, approved_revision = null, draft_status = 'ready' where id = recipient.id;
      return jsonb_build_object('revision', recipient.revision + 1);
    elsif p_action = 'approve_draft' then
      if nullif(recipient.subject, '') is null or nullif(recipient.message, '') is null then
        raise exception 'Save a subject and message before approving.' using errcode = '22023';
      end if;
      update public.outreach_recipients set approved_revision = case when (p_data->>'approved')::boolean then recipient.revision end
      where id = recipient.id;
      return '{"updated":true}'::jsonb;
    else
      raise exception 'Unknown outreach action.' using errcode = '22023';
    end if;
  end if;

  perform outreach_private.dispatch_job(job_key, p_webhook_url, p_worker_key);
  return jsonb_build_object('jobId', job_key, 'campaignId', campaign_key);
end;
$$;

create function public.outreach_worker_action(p_owner uuid, p_action text, p_data jsonb, p_mailbox text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  job public.outreach_jobs;
  item public.outreach_send_items;
  reply public.outreach_replies;
  latest_results jsonb;
  result text;
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
    if reply.outcome is not null then return '{"updated":true}'::jsonb; end if;
    result := p_data->>'outcome';
    select * into item from public.outreach_send_items i where i.id = reply.send_item_id;
    if result = 'failed' then
      select * into job from public.outreach_jobs j where j.id = item.job_id;
      perform outreach_private.log_event(p_owner, 'reply:' || reply.id, 'n8n', 'Reply triage failed',
        'The reply is available in Email Activity.', job.campaign_id, execution_key);
      return '{"updated":false}'::jsonb;
    end if;
    if result is null or result not in ('Hot', 'Warm', 'Needs nurture', 'Do not contact') then
      raise exception 'Invalid reply triage.' using errcode = '22023';
    end if;
    update public.outreach_replies set outcome = result where id = reply.id;
    update public.prospects p set do_not_contact = p.do_not_contact or result = 'Do not contact',
      triage = case when p.do_not_contact or result = 'Do not contact' then null else result end
    from public.outreach_recipients r where r.id = item.recipient_id and p.id = r.prospect_id
      and (result = 'Do not contact' or p.replied_at <= reply.received_at);
    return '{"updated":true}'::jsonb;
  end if;

  if p_action = 'report_error' then
    workflow_name := p_data->>'workflow';
    if workflow_name is null or workflow_name not in ('Prospect Desk - Lead discovery', 'Prospect Desk - Draft outreach',
      'Prospect Desk - Send outreach', 'Prospect Desk - Detect Gmail replies') then
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

create function outreach_private.expire_jobs()
returns void language plpgsql set search_path = '' as $$
declare
  job public.outreach_jobs;
  reason text;
begin
  for job in select j.* from public.outreach_jobs j
    left join net._http_response response on response.id = j.dispatch_id and j.status = 'queued'
    where j.status in ('queued', 'running') and (j.updated_at < now() - interval '5 minutes'
      or response.timed_out or response.error_msg is not null or response.status_code not between 200 and 299)
  loop
    perform outreach_private.lock_owner(job.owner_id);
    select case
      when response.timed_out or response.error_msg is not null or response.status_code not between 200 and 299
        then 'Supabase could not reach the outreach webhook.'
      when j.updated_at < now() - interval '5 minutes' then 'The workflow stopped updating. Review the execution in n8n.'
    end into reason from public.outreach_jobs j
    left join net._http_response response on response.id = j.dispatch_id and j.status = 'queued'
    where j.id = job.id and j.status in ('queued', 'running');
    if reason is not null then perform outreach_private.finish_job(job.id, reason); end if;
  end loop;
end;
$$;

revoke all on schema outreach_private from public, anon, authenticated;
grant usage on schema outreach_private to service_role;
revoke execute on function public.outreach_user_action(uuid, text, jsonb, text, text, text),
  public.outreach_worker_action(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.outreach_user_action(uuid, text, jsonb, text, text, text),
  public.outreach_worker_action(uuid, text, jsonb, text) to service_role;

select cron.schedule('prospect-desk-expire-outreach-jobs', '* * * * *', 'select outreach_private.expire_jobs()');

commit;
