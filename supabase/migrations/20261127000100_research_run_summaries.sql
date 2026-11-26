begin;

create or replace view public.research_run_summaries
with (security_invoker = true) as
select
  run.id,
  run.owner_id,
  run.criteria,
  run.status,
  run.failure_code,
  run.created_at,
  run.started_at,
  run.last_checked_at,
  run.finished_at,
  saved.saved_result_count,
  saved.saved_contact_count,
  saved.saved_email_count,
  (run.status = 'completed' and run.result_count > 0 and saved.saved_result_count = 0) as results_cleared
from public.research_runs run
cross join lateral (
  select
    count(*)::integer as saved_result_count,
    (count(*) filter (where jsonb_typeof(result.contact) = 'object'))::integer as saved_contact_count,
    (count(*) filter (where nullif(btrim(result.contact_email), '') is not null))::integer as saved_email_count
  from public.run_prospects result
  join public.prospects prospect on prospect.id = result.prospect_id and prospect.owner_id = run.owner_id
  where result.run_id = run.id and result.owner_id = run.owner_id
) saved;

revoke all on public.research_run_summaries from public, anon, authenticated;
grant select on public.research_run_summaries to authenticated;

create or replace function public.notify_research_results_removed()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Notify the existing run subscriptions after linked results are removed.
  update public.research_runs run
  set updated_at = now()
  where run.status = 'completed'
    and exists (
      select 1 from removed_results result where result.run_id = run.id and result.owner_id = run.owner_id
    );
  return null;
end;
$$;

revoke all on function public.notify_research_results_removed() from public, anon, authenticated;

create or replace trigger research_results_removed
after delete on public.run_prospects
referencing old table as removed_results
for each statement execute function public.notify_research_results_removed();

notify pgrst, 'reload schema';

commit;
