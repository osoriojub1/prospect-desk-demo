begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  retry_of uuid unique references public.research_runs(id) on delete set null,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  status text not null default 'queued' check (status in ('queued', 'researching', 'validating', 'completed', 'failed')),
  dispatch_id bigint,
  execution_id text,
  provider_job_id text,
  failure_code text,
  result_count integer not null default 0,
  contact_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  last_checked_at timestamptz,
  finished_at timestamptz,
  unique (owner_id, request_id)
);

create index research_runs_owner_created_idx on public.research_runs (owner_id, created_at desc);

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  name text not null,
  stage text not null default 'Generated' check (stage in ('Generated', 'Contacted', 'Replied')),
  contacted_at timestamptz,
  replied_at timestamptz,
  triage text check (triage in ('Hot', 'Warm', 'Needs nurture')),
  do_not_contact boolean not null default false,
  unique (owner_id, domain)
);

create table public.run_prospects (
  run_id uuid not null references public.research_runs(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  industry text not null,
  location text not null,
  fit text not null check (fit in ('Match', 'Possible match', 'Insufficient evidence')),
  rationale text not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  matched_signals text[] not null default '{}',
  contact jsonb check (jsonb_typeof(contact) = 'object'),
  contact_email text,
  recorded_at timestamptz not null default now(),
  primary key (run_id, prospect_id)
);

create index run_prospects_owner_recorded_idx on public.run_prospects (owner_id, recorded_at desc);

alter table public.research_runs enable row level security;
alter table public.prospects enable row level security;
alter table public.run_prospects enable row level security;

create policy "Read own runs" on public.research_runs for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Read own prospects" on public.prospects for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Read own research evidence" on public.run_prospects for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.research_runs, public.prospects, public.run_prospects from anon, authenticated;
grant select on public.research_runs, public.prospects, public.run_prospects to authenticated;
grant select, insert, update on public.research_runs, public.prospects, public.run_prospects to service_role;
alter publication supabase_realtime add table public.research_runs;

create function public.create_research_run(
  p_owner_id uuid, p_request_id uuid, p_criteria jsonb, p_retry_of uuid,
  p_webhook_url text, p_worker_key text
)
returns uuid language plpgsql set search_path = '' as $$
declare
  run_id uuid;
  criteria jsonb := p_criteria;
  resume_job_id text;
  dispatch_ready boolean := nullif(p_webhook_url, '') is not null and nullif(p_worker_key, '') is not null;
begin
  if p_retry_of is not null then
    select r.criteria, case when r.failure_code in ('workflow_timeout', 'firecrawl_status', 'firecrawl_timeout') then r.provider_job_id end
      into criteria, resume_job_id
      from public.research_runs r
      where r.id = p_retry_of and r.owner_id = p_owner_id and r.status = 'failed';
    if not found then return null; end if;
  end if;

  insert into public.research_runs (owner_id, request_id, criteria, retry_of, status, failure_code, finished_at, provider_job_id)
    values (p_owner_id, p_request_id, criteria, p_retry_of,
      case when dispatch_ready then 'queued' else 'failed' end,
      case when not dispatch_ready then 'workflow_unconfigured' end,
      case when not dispatch_ready then now() end, resume_job_id)
    on conflict do nothing returning id into run_id;

  if run_id is null then
    select r.id into run_id from public.research_runs r
      where r.owner_id = p_owner_id and (r.request_id = p_request_id or r.retry_of = p_retry_of)
      order by (r.request_id = p_request_id) desc limit 1;
  elsif dispatch_ready then
    -- pg_net dispatches after the transaction commits, so the run is visible to n8n.
    update public.research_runs set dispatch_id = net.http_post(
      url := p_webhook_url,
      body := jsonb_build_object('runId', run_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-research-key', p_worker_key),
      timeout_milliseconds := 10000
    ) where id = run_id;
  end if;

  return run_id;
end;
$$;

create function public.claim_research_run(p_run_id uuid, p_execution_id text)
returns jsonb language sql set search_path = '' as $$
  update public.research_runs r set
    execution_id = p_execution_id, started_at = coalesce(r.started_at, now()), updated_at = now()
  where r.id = p_run_id and r.status = 'queued' and (r.execution_id is null or r.execution_id = p_execution_id)
  returning jsonb_build_object('criteria', r.criteria, 'providerJobId', r.provider_job_id);
$$;

create function public.report_research_run(
  p_run_id uuid, p_execution_id text, p_status text, p_provider_job_id text, p_polled boolean, p_failure_code text
)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.research_runs r set
    status = p_status,
    provider_job_id = coalesce(r.provider_job_id, p_provider_job_id),
    last_checked_at = case when p_polled then now() else r.last_checked_at end,
    failure_code = case when p_status = 'failed' then p_failure_code end,
    finished_at = case when p_status = 'failed' then now() end,
    updated_at = now()
  where r.id = p_run_id and r.execution_id = p_execution_id
    and (p_provider_job_id is null or r.provider_job_id is null or r.provider_job_id = p_provider_job_id)
    and (
      (p_status = 'researching' and r.status in ('queued', 'researching') and coalesce(r.provider_job_id, p_provider_job_id) is not null)
      or (p_status = 'validating' and r.status in ('researching', 'validating'))
      or (p_status = 'failed' and r.status in ('queued', 'researching', 'validating'))
    );
  return found;
end;
$$;

create function public.complete_research_run(p_run_id uuid, p_execution_id text, p_matches jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  run public.research_runs;
  candidate jsonb;
  saved_prospect_id uuid;
  sourced_contacts integer := 0;
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

    insert into public.run_prospects (
      run_id, prospect_id, owner_id, industry, location, fit, rationale, evidence, matched_signals, contact, contact_email
    ) values (
      run.id, saved_prospect_id, run.owner_id, run.criteria->>'industry', candidate->>'location',
      candidate->>'fit', candidate->>'rationale', candidate->'evidence',
      array(select jsonb_array_elements_text(candidate->'matchedSignals')),
      nullif(candidate->'contact', 'null'::jsonb), candidate->>'contactEmail'
    );
    if jsonb_typeof(candidate->'contact') = 'object' then
      sourced_contacts := sourced_contacts + 1;
    end if;
  end loop;

  update public.research_runs set status = 'completed', result_count = jsonb_array_length(p_matches),
    contact_count = sourced_contacts, finished_at = now(), updated_at = now()
    where id = p_run_id;
  return true;
end;
$$;

create function public.expire_research_runs()
returns void language sql set search_path = '' as $$
  update public.research_runs r set status = 'failed', failure_code = 'workflow_dispatch',
    finished_at = now(), updated_at = now()
  where r.status = 'queued' and r.execution_id is null
    and (r.created_at < now() - interval '2 minutes' or exists (
      select 1 from net._http_response response where response.id = r.dispatch_id
        and (response.timed_out or response.error_msg is not null or response.status_code not between 200 and 299)
    ));

  update public.research_runs r set status = 'failed', failure_code = 'workflow_timeout',
    finished_at = now(), updated_at = now()
  where r.status in ('queued', 'researching', 'validating') and r.execution_id is not null
    and r.updated_at < now() - interval '3 minutes';
$$;

revoke execute on function public.create_research_run(uuid, uuid, jsonb, uuid, text, text),
  public.claim_research_run(uuid, text), public.report_research_run(uuid, text, text, text, boolean, text),
  public.complete_research_run(uuid, text, jsonb), public.expire_research_runs()
  from public, anon, authenticated;
grant execute on function public.create_research_run(uuid, uuid, jsonb, uuid, text, text),
  public.claim_research_run(uuid, text), public.report_research_run(uuid, text, text, text, boolean, text),
  public.complete_research_run(uuid, text, jsonb) to service_role;

select cron.schedule('prospect-desk-expire-lead-runs', '* * * * *', 'select public.expire_research_runs()');

commit;
