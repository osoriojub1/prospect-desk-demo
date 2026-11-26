"use client";

import Link from "next/link";
import { useState } from "react";
import { markLogsRead, type SystemLog } from "../lib/outreach";
import { campaignHref, researchHref } from "../lib/routes";
import { activityDate } from "../lib/workspace";
import { AppErrorDialog } from "./app-error-dialog";
import { useWorkspaceEvents } from "./research-session";

function relatedPage(event: SystemLog) {
  if (event.research_run_id) return researchHref("runStatus", event.research_run_id);
  if (event.campaign_id) return campaignHref(event.title.startsWith("Draft") ? "review" : "delivery", event.campaign_id);
}

export function SystemLogs() {
  const { events, unreadEvents = 0, error, refreshLogs } = useWorkspaceEvents();
  const [dismissedError, setDismissedError] = useState("");
  const [actionError, setActionError] = useState("");
  const [marking, setMarking] = useState(false);

  function retry() {
    setDismissedError("");
    void refreshLogs();
  }

  async function markAll() {
    if (marking) return;
    setMarking(true);
    try {
      await markLogsRead();
      await refreshLogs();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Try again in a moment.");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="outreach-page">
      <section className="action-card data-card" aria-label="System events">
        <header className="outreach-card-header">
          <p className="stage-summary" role="status">{events ? unreadEvents + (unreadEvents === 1 ? " new event" : " new events") : ""}</p>
          <button className="button button-secondary" type="button" disabled={!unreadEvents || marking} onClick={markAll}>
            {marking ? "Marking as read…" : "Mark all as read"}
          </button>
        </header>
        <table className="outreach-table log-table">
          <caption className="sr-only">Workflow and infrastructure events</caption>
          <thead><tr><th scope="col">Event</th><th scope="col">Source</th><th scope="col">Time</th></tr></thead>
          <tbody>
            {events?.map((event) => {
              const href = relatedPage(event);
              return (
                <tr key={event.id}>
                  <th scope="row">
                    <span className="log-event-title">
                      {href ? <Link className="subject-link" href={href}>{event.title}</Link> : event.title}
                      {!event.read_at && <span className="badge read-reply">New</span>}
                    </span>
                    <span className="log-detail">{event.detail}</span>
                  </th>
                  <td>{event.source}</td>
                  <td><time dateTime={event.occurred_at}>{activityDate.format(new Date(event.occurred_at))}</time></td>
                </tr>
              );
            })}
            {!events?.length && (
              <tr><td colSpan={3}>{events ? "No system events" : error ?
                <button className="button button-secondary" type="button" onClick={retry}>Try again</button> :
                <p role="status">Loading system events…</p>}</td></tr>
            )}
          </tbody>
        </table>
      </section>
      <AppErrorDialog title="Couldn’t load system logs" message={error === dismissedError ? "" : error}
        onClose={() => setDismissedError(error)} onRetry={retry} />
      <AppErrorDialog title="Couldn’t mark events as read" message={actionError} onClose={() => setActionError("")} onRetry={markAll} />
    </div>
  );
}
