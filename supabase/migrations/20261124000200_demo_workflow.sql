begin;

alter table public.research_runs add column email_count integer not null default 0;
alter table public.run_prospects
  add column email_kind text check (email_kind in ('direct', 'shared', 'unattributed')),
  add column email_evidence jsonb check (jsonb_typeof(email_evidence) = 'object');

update public.research_runs r
set email_count = evidence.count
from (
  select run_id, count(*)::integer as count from public.run_prospects
  where nullif(btrim(contact_email), '') is not null group by run_id
) evidence
where r.id = evidence.run_id;

alter table public.outreach_campaigns
  add column offer text check (length(btrim(offer)) between 1 and 500);

alter table public.system_log_events
  add column research_run_id uuid references public.research_runs on delete set null;

create or replace function public.complete_research_run(p_run_id uuid, p_execution_id text, p_matches jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  run public.research_runs;
  candidate jsonb;
  saved_prospect_id uuid;
  sourced_contacts integer := 0;
  sourced_emails integer := 0;
  address text;
begin
  select * into run from public.research_runs
    where id = p_run_id and execution_id = p_execution_id for update;
  if not found then return false; end if;
  if run.status = 'completed' then return true; end if;
  if run.status <> 'validating' then return false; end if;

  if jsonb_array_length(p_matches) > (run.criteria->>'limit')::integer then
    raise exception 'Result limit exceeded';
  end if;

  for candidate in select value from jsonb_array_elements(p_matches) order by value->>'domain' loop
    insert into public.prospects (owner_id, domain, name)
      values (run.owner_id, candidate->>'domain', candidate->>'name')
      on conflict (owner_id, domain) do update set name = excluded.name
      returning id into saved_prospect_id;

    address := nullif(btrim(candidate->>'contactEmail'), '');
    insert into public.run_prospects (
      run_id, prospect_id, owner_id, industry, location, fit, rationale, evidence, matched_signals, contact, contact_email, email_kind, email_evidence
    ) values (
      run.id, saved_prospect_id, run.owner_id, run.criteria->>'industry', candidate->>'location',
      candidate->>'fit', candidate->>'rationale', candidate->'evidence',
      array(select jsonb_array_elements_text(candidate->'matchedSignals')),
      nullif(candidate->'contact', 'null'::jsonb), address,
      case when address is not null then candidate->>'emailKind' end,
      case when address is not null then nullif(candidate->'emailEvidence', 'null'::jsonb) end
    );
    if jsonb_typeof(candidate->'contact') = 'object' then
      sourced_contacts := sourced_contacts + 1;
    end if;
    if address is not null then sourced_emails := sourced_emails + 1; end if;
  end loop;

  update public.research_runs set status = 'completed', result_count = jsonb_array_length(p_matches),
    contact_count = sourced_contacts, email_count = sourced_emails, finished_at = now(), updated_at = now()
    where id = p_run_id;
  return true;
end;
$$;

create or replace function public.outreach_user_action(
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
  search_key uuid;
  campaign_offer text;
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

    campaign_offer := nullif(btrim(p_data->>'offer'), '');
    search_key := nullif(p_data->>'runId', '')::uuid;
    if (p_data ? 'offer' and campaign_offer is null) or length(campaign_offer) > 500 then
      raise exception 'Enter an outreach offer.' using errcode = '22023';
    end if;
    if search_key is not null and not exists (
      select 1 from public.research_runs r
      where r.id = search_key and r.owner_id = p_owner and r.status = 'completed'
    ) then
      raise exception 'Choose an available lead search.' using errcode = '22023';
    end if;

    insert into public.outreach_campaigns (owner_id, name, offer, filters)
    values (p_owner, btrim(p_data->>'name'), campaign_offer,
      jsonb_build_object('industry', p_data->>'industry', 'location', p_data->>'location', 'runId', search_key))
    returning id into campaign_key;
    insert into public.outreach_jobs (owner_id, campaign_id, request_id, kind)
    values (p_owner, campaign_key, request_key, 'draft') returning id into job_key;

    insert into public.outreach_recipients (owner_id, campaign_id, prospect_id, address, research_snapshot, draft_job_id)
    select p_owner, campaign_key, prospect.id, lower(btrim(research.contact_email)),
      jsonb_build_object('company', prospect.name, 'industry', research.industry, 'location', research.location,
        'contact', research.contact, 'evidence', research.evidence, 'rationale', research.rationale,
        'emailKind', coalesce(research.email_kind, 'unattributed'), 'emailEvidence', research.email_evidence,
        'offer', campaign_offer), job_key
    from public.prospects prospect
    join lateral (
      select r.* from public.run_prospects r
      where r.prospect_id = prospect.id and r.owner_id = p_owner and (search_key is null or r.run_id = search_key)
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

create function outreach_private.log_research_failure(p_run public.research_runs)
returns void language sql set search_path = '' as $$
  insert into public.system_log_events (owner_id, event_key, source, title, detail, research_run_id, occurred_at, execution_id)
  select p_run.owner_id, 'research:' || p_run.id,
    case when p_run.failure_code = 'save_failed' then 'Supabase'
      when p_run.failure_code like 'firecrawl_%' or p_run.failure_code = 'invalid_results' then 'Firecrawl'
      else 'n8n' end,
    'Lead search failed',
    case p_run.failure_code
      when 'workflow_unconfigured' then 'Connect the lead discovery workflow.'
      when 'workflow_dispatch' then 'Check the discovery webhook in n8n, then retry the search.'
      when 'workflow_timeout' then 'Open the n8n execution for this search.'
      when 'firecrawl_start' then 'Check the Firecrawl connection, then retry.'
      when 'firecrawl_credit_limit' then 'Check your Firecrawl credit limit or use narrower criteria.'
      when 'firecrawl_timeout' then 'Open the search to retry or narrow the criteria.'
      when 'save_failed' then 'Open the search to retry saving the results.'
      else 'Open the search to see its status and retry.'
    end,
    p_run.id, coalesce(p_run.finished_at, p_run.updated_at), p_run.execution_id
  where p_run.status = 'failed'
  on conflict (owner_id, event_key) do nothing;
$$;

create function outreach_private.log_research_failure_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform outreach_private.log_research_failure(new);
  return new;
end;
$$;

revoke execute on function outreach_private.log_research_failure(public.research_runs),
  outreach_private.log_research_failure_trigger() from public, anon, authenticated;
grant execute on function outreach_private.log_research_failure(public.research_runs),
  outreach_private.log_research_failure_trigger() to service_role;

create trigger log_research_failure after insert or update of status on public.research_runs
for each row when (new.status = 'failed') execute function outreach_private.log_research_failure_trigger();

select outreach_private.log_research_failure(r) from public.research_runs r where r.status = 'failed';

commit;
