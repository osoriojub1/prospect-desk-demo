"use client";

import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, ListChecks, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { SearchCriteria } from "../lib/prospects";
import { isActiveResearchRun, isResearchRunId, readResearchRun, researchConfigured, researchFailure, researchRunStatusLabel, startResearch, watchResearchRuns, type ResearchRun } from "../lib/research";
import { researchHref, routes } from "../lib/routes";
import { editableSearchCriteria, fitLabels, searchLines } from "../lib/search-criteria";
import { AppErrorDialog } from "./app-error-dialog";
import { LeadRunList } from "./lead-run-list";
import { useResearchSession } from "./research-session";

const steps = ["queued", "researching", "validating", "completed"] as const;
const stepLabels = ["Queued", "Researching", "Checking results", "Complete"];
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const statusDetails = {
  queued: { detail: "Waiting to start.", Icon: Clock3 },
  researching: { detail: "Finding companies and contact evidence.", Icon: Search },
  validating: { detail: "Applying your filters and checking the evidence.", Icon: ListChecks },
  completed: { detail: "", Icon: Check },
  failed: { detail: "", Icon: CircleAlert },
};

export function LeadRunStatus() {
  const id = useSearchParams().get("run");
  const { session } = useResearchSession();

  if (!researchConfigured) return <p className="action-card action-content">Connect the workspace to see lead searches.</p>;
  if (!session) return null;
  if (id === null) return <LeadRunList key={session.user.id} ownerId={session.user.id} />;
  if (!isResearchRunId(id)) return (
    <div className="action-card empty-list">
      <p>This lead search is unavailable.</p>
      <Link className="text-link" href={routes.runStatus}>All searches</Link>
    </div>
  );
  return <RunView key={`${session.user.id}/${id}`} id={id} />;
}

function RunView({ id }: { id: string }) {
  const router = useRouter();
  const [run, setRun] = useState<ResearchRun | null>();
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [reload, setReload] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let active = true;
    let read = 0;

    async function load() {
      if (!active) return;
      const request = ++read;
      try {
        const snapshot = await readResearchRun(id);
        if (active && request === read) {
          setRun(snapshot);
          setLoadFailed(false);
        }
      } catch (error) {
        if (active && request === read) {
          setLoadFailed(true);
          setError(error instanceof Error ? error.message : "Could not load this run.");
        }
      }
    }

    const stopWatching = watchResearchRuns(`id=eq.${id}`, load, (live) => {
      if (active) setConnection(live ? "live" : "reconnecting");
    });
    void load();

    return () => {
      active = false;
      stopWatching();
    };
  }, [id, reload]);

  async function retry() {
    if (!run || retrying) return;
    setRetrying(true);
    try {
      const runId = await startResearch({ requestId: crypto.randomUUID(), retryOf: run.id });
      router.push(researchHref("runStatus", runId));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not retry this run.");
    } finally {
      setRetrying(false);
    }
  }

  const active = run && isActiveResearchRun(run.status);

  return (
    <div className="lead-run-page">
      <div className="lead-run-nav">
        <Link href={routes.runStatus} className="text-link"><ArrowLeft size={16} aria-hidden="true" />All searches</Link>
        {active && (
          <span role="status" className="lead-run-connection" data-live={connection === "live"}>
            <span className="badge-dot" aria-hidden="true" />
            {connection === "live" ? "Live updates" : connection === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </div>
      {run ? (
        <div className="lead-run-grid">
          <RunProgress run={run} onRetry={retry} retrying={retrying} />
          <RunCriteria criteria={run.criteria} />
        </div>
      ) : (
        <div className="action-card action-content lead-run-placeholder">
          {run === null ? <p>This lead search is unavailable.</p> :
            loadFailed ? <button className="button button-secondary" type="button" onClick={() => { setLoadFailed(false); setReload(reload + 1); }}>Try again</button> :
              <p role="status">Loading search…</p>}
        </div>
      )}
      <AppErrorDialog title={loadFailed ? "Couldn’t load search" : "Couldn’t retry search"} message={error}
        onClose={() => setError("")} onRetry={loadFailed ? () => setReload((value) => value + 1) : retry} />
    </div>
  );
}

function RunProgress({ run, onRetry, retrying }: { run: ResearchRun; onRetry: () => void; retrying: boolean }) {
  const configuration = statusDetails[run.status];
  const { Icon } = configuration;
  const finished = run.status === "completed";
  const hasResults = finished && run.saved_result_count > 0;
  const failed = run.status === "failed";
  const stage = run.status === "failed" ? -1 : steps.indexOf(run.status);
  const heading = researchRunStatusLabel(run);
  let detail = configuration.detail;
  if (failed) detail = researchFailure(run.failure_code).detail;
  if (finished && !hasResults && !run.results_cleared) detail = "No companies matched. Adjust your search to broaden the criteria.";

  return (
    <section className="action-card lead-run-progress" aria-labelledby="lead-run-stage">
      <header className="action-content lead-run-stage" data-status={run.status}>
        <span className="lead-run-icon lead-stage-change" key={run.status} aria-hidden="true"><Icon size={22} /></span>
        <div role="status" aria-atomic="true">
          <h2 id="lead-run-stage">{heading}</h2>
          {detail && <p>{detail}</p>}
          {hasResults && (
            <ul className="lead-result-counts">
              <li><strong>{run.saved_result_count}</strong> {run.saved_result_count === 1 ? "company saved" : "companies saved"}</li>
              <li><strong>{run.saved_contact_count}</strong> {run.saved_contact_count === 1 ? "named contact" : "named contacts"}</li>
              <li><strong>{run.saved_email_count}</strong> with work email</li>
            </ul>
          )}
        </div>
        {run.last_checked_at && (
          <p className="lead-run-check">Last checked <time dateTime={run.last_checked_at}>{dateTime.format(new Date(run.last_checked_at))}</time></p>
        )}
      </header>

      {!failed && (
        <ol className="lead-run-steps" aria-label="Research stages">
          {stepLabels.map((label, index) => (
            <li key={label} data-reached={index <= stage} aria-current={index === stage ? "step" : undefined}>
              <span className="lead-run-step-dot" aria-hidden="true">{(finished || index < stage) && <Check size={12} />}</span>
              {label}
            </li>
          ))}
        </ol>
      )}

      <dl className="lead-run-times action-content">
        <RunTime label="Submitted" value={run.created_at} />
        {run.started_at && <RunTime label="Started" value={run.started_at} />}
        {run.finished_at && <RunTime label="Finished" value={run.finished_at} />}
      </dl>

      <footer className="action-content lead-run-actions">
        <Link className="button button-secondary" href={researchHref("search", run.id)}>Adjust search</Link>
        {failed && (
          <button className="button button-primary" type="button" onClick={onRetry} disabled={retrying}>
            {retrying ? "Starting…" : "Retry search"}
          </button>
        )}
        {hasResults && (
          <Link className="button button-primary" href={researchHref("prospects", run.id)}>View prospects<ArrowRight size={16} aria-hidden="true" /></Link>
        )}
      </footer>
    </section>
  );
}

function RunTime({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd><time dateTime={value}>{dateTime.format(new Date(value))}</time></dd></div>;
}

function RunCriteria({ criteria }: { criteria: SearchCriteria }) {
  const { requiredSignals, preferredSignals, contactRoles, requiredSignalMode } = editableSearchCriteria(criteria);
  const required = searchLines(requiredSignals);
  const preferred = searchLines(preferredSignals);
  const contacts = searchLines(contactRoles);
  const exclusions = [...criteria.exclusions, ...searchLines(criteria.excludedDomains), ...searchLines(criteria.excludedKeywords)];

  return (
    <aside className="action-card action-content lead-run-criteria" aria-labelledby="lead-run-criteria">
      <h2 id="lead-run-criteria">Search criteria</h2>
      <dl>
        <div><dt>Industry</dt><dd>{criteria.industry}</dd></div>
        <div><dt>Location</dt><dd>{criteria.location}</dd></div>
        <div><dt>Evidence required</dt><dd>{fitLabels[criteria.minimumFit]}</dd></div>
        <div><dt>Max results</dt><dd>{criteria.limit}</dd></div>
        {required.length > 0 && <div><dt>{requiredSignalMode === "any" ? "Must match one" : "Must match"}</dt><dd>{required.join(" · ")}</dd></div>}
        {preferred.length > 0 && <div><dt>Prefer</dt><dd>{preferred.join(" · ")}</dd></div>}
        {contacts.length > 0 && <div><dt>Preferred contact</dt><dd>{contacts.join(" → ")}</dd></div>}
        {exclusions.length > 0 && <div><dt>Exclusions</dt><dd>{exclusions.join(", ")}</dd></div>}
      </dl>
    </aside>
  );
}
