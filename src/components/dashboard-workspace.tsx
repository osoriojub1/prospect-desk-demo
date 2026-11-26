"use client";

import { ArrowRight, Building2, ChevronRight, CircleSlash, FileText, Inbox, MessageSquare, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { readDashboard } from "../lib/dashboard";
import { outreachStatusLabels } from "../lib/prospects";
import { researchConfigured, researchRunStatusLabel } from "../lib/research";
import { leadGenerationLabels, researchHref, routes } from "../lib/routes";
import { AppErrorDialog } from "./app-error-dialog";
import { DashboardCharts } from "./dashboard-charts";
import { useResearchSession, useWorkspaceEvents } from "./research-session";
import { useOutreachSnapshot } from "./use-outreach-snapshot";

const dashboardTables = ["research_runs", "outreach_send_items", "outreach_replies"] as const;
const number = new Intl.NumberFormat("en-AU");
const submittedAt = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" });
const metrics = [
  { key: "prospects", label: leadGenerationLabels.prospects, Icon: Building2, href: routes.prospects },
  { key: "contacted", label: outreachStatusLabels.Contacted, Icon: Send, href: routes.prospects + "?status=contacted" },
  { key: "replied", label: outreachStatusLabels.Replied, Icon: MessageSquare, href: routes.prospects + "?status=replied" },
  { key: "doNotContact", label: "Do not contact", Icon: CircleSlash, href: routes.prospects + "?do-not-contact=1" },
] as const;

export function DashboardWorkspace() {
  const { session } = useResearchSession();
  if (!researchConfigured) return <p className="action-card action-content">Connect the workspace to see your activity.</p>;
  return session && <Dashboard key={session.user.id} ownerId={session.user.id} />;
}

function Dashboard({ ownerId }: { ownerId: string }) {
  const { snapshot, error, refresh } = useOutreachSnapshot(ownerId, dashboardTables, readDashboard);
  const [dismissedError, setDismissedError] = useState("");
  const { unreadReplies, unreadEvents } = useWorkspaceEvents();

  function retry() {
    setDismissedError("");
    void refresh();
  }

  return (
    <>
      <section className="dashboard-metrics" aria-label="Prospect totals" aria-busy={!snapshot && !error}>
        {metrics.map(({ key, label, Icon, href }) => {
          const value = snapshot ? number.format(snapshot.totals[key]) : undefined;
          return (
            <Link key={key} href={href} className="dashboard-metric-link" aria-label={value ? label + " " + value : label}>
              <article className="action-card dashboard-metric">
                <header>
                  <Icon size={17} aria-hidden="true" />
                  <h2>{label}</h2>
                  <ArrowRight size={15} aria-hidden="true" className="dashboard-arrow" />
                </header>
                <p>{value ?? "—"}</p>
              </article>
            </Link>
          );
        })}
      </section>

      <DashboardCharts snapshot={snapshot} loading={!snapshot && !error} />

      <div className="dashboard-panels">
        <section className="action-card" aria-labelledby="dashboard-searches">
          <header className="dashboard-panel-header">
            <h2 id="dashboard-searches">Recent searches</h2>
            <Link href={routes.runStatus} className="text-link">All searches<ArrowRight size={14} aria-hidden="true" /></Link>
          </header>
          {snapshot?.recentSearches.length ? (
            <ul role="list" className="dashboard-list">
              {snapshot.recentSearches.map((run) => (
                <li key={run.id}>
                  <Link href={researchHref("runStatus", run.id)} className="dashboard-row dashboard-search">
                    <span className="dashboard-search-name">
                      <strong>{run.criteria.industry}</strong>
                      <small>{run.criteria.location} · <time dateTime={run.created_at}>{submittedAt.format(new Date(run.created_at))}</time></small>
                    </span>
                    <span className="badge lead-run-badge" data-status={run.status}>{researchRunStatusLabel(run)}</span>
                    <ChevronRight size={15} aria-hidden="true" className="dashboard-arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="action-content dashboard-empty">
              {snapshot ? <p>No searches yet.</p> : error ? (
                <button className="button button-secondary" type="button" onClick={retry}>Try again</button>
              ) : <p role="status">Loading searches…</p>}
            </div>
          )}
        </section>

        <section className="action-card" aria-labelledby="dashboard-updates">
          <header className="dashboard-panel-header"><h2 id="dashboard-updates">Updates</h2></header>
          <ul role="list" className="dashboard-list">
            <li>
              <Link href={routes.delivery} className="dashboard-row dashboard-update">
                <Inbox size={17} aria-hidden="true" />
                <span>Unread replies</span>
                <span className="record-count" data-new={Boolean(unreadReplies)}>{unreadReplies ?? "—"}</span>
                <ChevronRight size={15} aria-hidden="true" className="dashboard-arrow" />
              </Link>
            </li>
            <li>
              <Link href={routes.logs} className="dashboard-row dashboard-update">
                <FileText size={17} aria-hidden="true" />
                <span>New system events</span>
                <span className="record-count" data-new={Boolean(unreadEvents)}>{unreadEvents ?? "—"}</span>
                <ChevronRight size={15} aria-hidden="true" className="dashboard-arrow" />
              </Link>
            </li>
          </ul>
        </section>
      </div>
      <AppErrorDialog title="Couldn’t load dashboard" message={error === dismissedError ? "" : error}
        onClose={() => setDismissedError(error)} onRetry={retry} />
    </>
  );
}
