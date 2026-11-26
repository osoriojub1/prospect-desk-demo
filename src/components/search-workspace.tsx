"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SearchCriteria } from "../lib/prospects";
import { isResearchRunId, readResearchRun, researchConfigured, startResearch } from "../lib/research";
import { researchHref, routes } from "../lib/routes";
import { discoveryCriteria, editableSearchCriteria } from "../lib/search-criteria";
import { AppErrorDialog } from "./app-error-dialog";
import { useResearchSession } from "./research-session";
import { SearchSetup } from "./search-setup";

export function SearchWorkspace() {
  const runId = useSearchParams().get("run");
  const { session } = useResearchSession();

  if (!researchConfigured) return <p className="action-card action-content">Connect the workspace to find companies.</p>;
  if (runId === null) return <LiveSearch initialCriteria={discoveryCriteria} />;
  if (!isResearchRunId(runId)) return <SavedSearchUnavailable />;
  return session && <SavedSearch key={`${session.user.id}/${runId}`} runId={runId} />;
}

function SavedSearch({ runId }: { runId: string }) {
  const [loaded, setLoaded] = useState<{ criteria: SearchCriteria | null; failed?: boolean }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    readResearchRun(runId).then((run) => {
      if (current) setLoaded({ criteria: run?.criteria ?? null });
    }).catch(() => {
      if (!current) return;
      setLoaded({ criteria: null, failed: true });
      setError("Could not load the saved search. Try again.");
    });
    return () => { current = false; };
  }, [attempt, runId]);

  if (!loaded) return <div className="action-card action-content lead-run-placeholder"><p role="status">Loading saved search…</p></div>;
  if (loaded.criteria) return <LiveSearch initialCriteria={loaded.criteria} />;

  return (
    <>
      <SavedSearchUnavailable onRetry={loaded.failed ? () => { setLoaded(undefined); setAttempt((value) => value + 1); } : undefined} />
      <AppErrorDialog title="Couldn’t load saved search" message={error} onClose={() => setError("")}
        onRetry={() => { setLoaded(undefined); setAttempt((value) => value + 1); }} />
    </>
  );
}

function SavedSearchUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="action-card empty-list">
      <p>{onRetry ? "Could not load the saved search." : "Saved search unavailable."}</p>
      <div className="search-recovery-actions">
        {onRetry && <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button>}
        <Link className="button button-secondary" href={routes.search}>New search</Link>
      </div>
    </div>
  );
}

function LiveSearch({ initialCriteria }: { initialCriteria: SearchCriteria }) {
  const router = useRouter();
  const [criteria, setCriteria] = useState(() => editableSearchCriteria(initialCriteria));
  const pending = useRef<{ criteria: string; requestId: string } | null>(null);

  async function submit(criteria: SearchCriteria) {
    const serialized = JSON.stringify(criteria);
    if (pending.current?.criteria !== serialized) {
      pending.current = { criteria: serialized, requestId: crypto.randomUUID() };
    }
    const runId = await startResearch({ requestId: pending.current.requestId, criteria });
    pending.current = null;
    router.push(researchHref("runStatus", runId));
  }

  return <SearchSetup criteria={criteria} onChange={setCriteria} onSearch={submit} />;
}
