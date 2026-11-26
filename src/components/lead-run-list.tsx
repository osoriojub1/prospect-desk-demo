"use client";

import { ArrowRight, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isActiveResearchRun, readResearchRuns, researchRunStatusLabel, watchResearchRuns } from "../lib/research";
import { leadGenerationLabels, researchHref, routes } from "../lib/routes";
import { AppErrorDialog } from "./app-error-dialog";

const submittedTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function LeadRunList({ ownerId }: { ownerId: string }) {
  const [page, setPage] = useState(0);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readResearchRuns>> & { page: number }>();
  const [failedPage, setFailedPage] = useState<number>();
  const [live, setLive] = useState<boolean>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    let latestRequest = 0;

    async function load() {
      if (!current) return;
      const request = ++latestRequest;
      try {
        const result = await readResearchRuns(page);
        if (!current || request !== latestRequest) return;
        if (page > 0 && result.runs.length === 0) {
          setPage(page - 1);
          return;
        }
        setSnapshot({ ...result, page });
        setFailedPage(undefined);
      } catch (error) {
        if (!current || request !== latestRequest) return;
        setFailedPage(page);
        setError(error instanceof Error ? error.message : "Could not load searches.");
      }
    }

    const stopWatching = watchResearchRuns(`owner_id=eq.${ownerId}`, load, (connected) => {
      if (current) setLive(connected);
    });
    void load();
    return () => { current = false; stopWatching(); };
  }, [attempt, ownerId, page]);

  const visible = snapshot?.page === page ? snapshot : undefined;
  const hasActiveRuns = visible?.runs.some((run) => isActiveResearchRun(run.status));
  const showPages = page > 0 || Boolean(snapshot && (snapshot.page > 0 || snapshot.hasMore));

  return (
    <div className="lead-run-page">
      <div className="lead-runs-toolbar">
        {hasActiveRuns && (
          <span className="lead-run-connection" role="status" data-live={live === true}>
            <span className="badge-dot" aria-hidden="true" />
            {live ? "Live updates" : live === undefined ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
        <Link className="button button-primary" href={routes.search}><Plus size={16} aria-hidden="true" />New search</Link>
      </div>

      <div className="action-card data-card">
        {visible?.runs.length ? (
          <div className="lead-runs-scroll" role="region" aria-labelledby="lead-runs-caption" tabIndex={0}>
            <table className="outreach-table lead-runs-table">
              <caption id="lead-runs-caption" className="sr-only">{leadGenerationLabels.runStatus}</caption>
              <thead>
                <tr><th scope="col">Search</th><th scope="col">Status</th><th scope="col">Prospects</th><th scope="col">Submitted</th></tr>
              </thead>
              <tbody>
                {visible.runs.map((run) => {
                  const submitted = submittedTime.format(new Date(run.created_at));
                  return (
                    <tr key={run.id}>
                      <th scope="row">
                        <Link className="campaign-link lead-run-link" href={researchHref("runStatus", run.id)}>
                          <span className="lead-run-target">
                            <span>{run.criteria.industry}</span><small>{run.criteria.location}</small>
                            <span className="sr-only">, submitted {submitted}</span>
                          </span>
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      </th>
                      <td><span className="badge lead-run-badge" data-status={run.status}>{researchRunStatusLabel(run)}</span></td>
                      <td>{run.status === "completed" ? run.saved_result_count : "—"}</td>
                      <td><time dateTime={run.created_at}>{submitted}</time></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="action-content lead-run-placeholder">
            {visible ? <p>No searches yet.</p> : failedPage === page ? (
              <button className="button button-secondary" type="button" onClick={() => { setFailedPage(undefined); setAttempt((value) => value + 1); }}>Try again</button>
            ) : <p role="status">Loading searches…</p>}
          </div>
        )}

        {showPages && (
          <footer className="list-footer">
            <span>Page {page + 1}</span>
            <nav className="pagination" aria-label="Search pages">
              <button className="icon-button" type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button className="icon-button" type="button" aria-label="Next page" disabled={!visible?.hasMore} onClick={() => setPage((value) => value + 1)}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </nav>
          </footer>
        )}
      </div>
      <AppErrorDialog title="Couldn’t load searches" message={error} onClose={() => setError("")}
        onRetry={() => setAttempt((value) => value + 1)} />
    </div>
  );
}
