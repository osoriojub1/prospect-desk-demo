import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { readDashboard } from "../lib/dashboard";
import { outreachStatusLabels } from "../lib/prospects";
import { campaignHref, routes } from "../lib/routes";

type DashboardSnapshot = Awaited<ReturnType<typeof readDashboard>>;

const outreachStages = [
  { key: "notContacted", label: outreachStatusLabels.Generated },
  { key: "awaitingReply", label: "Awaiting reply" },
  { key: "replied", label: outreachStatusLabels.Replied },
] as const;
const number = new Intl.NumberFormat("en-AU");
const percent = new Intl.NumberFormat("en-AU", { style: "percent", maximumFractionDigits: 1 });

export function DashboardCharts({ snapshot, loading }: { snapshot?: DashboardSnapshot; loading: boolean }) {
  const unavailable = loading ? "Loading…" : "Unavailable";

  return (
    <div className="dashboard-panels dashboard-charts">
      <section className="action-card">
        <header className="dashboard-panel-header"><h2>Outreach progress</h2></header>
        <div className="dashboard-chart-content">
          {snapshot?.totals.prospects ? (
            <>
              <div className="dashboard-outreach-bar" aria-hidden="true">
                {outreachStages.map(({ key }) => (
                  <span key={key} data-stage={key} style={{ flexGrow: snapshot.outreachProgress[key] }} />
                ))}
              </div>
              <ul role="list" className="dashboard-chart-legend">
                {outreachStages.map(({ key, label }) => (
                  <li key={key}>
                    <span className="dashboard-chart-key" data-stage={key} aria-hidden="true" />
                    <span>{label}</span>
                    <strong>{number.format(snapshot.outreachProgress[key])}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="dashboard-chart-empty">{snapshot ? "No prospects yet." : unavailable}</p>}
        </div>
      </section>

      <section className="action-card">
        <header className="dashboard-panel-header">
          <h2>Reply rate by campaign</h2>
          <Link href={routes.delivery} className="text-link">Email activity<ArrowRight size={14} aria-hidden="true" /></Link>
        </header>
        <div className="dashboard-chart-content">
          {snapshot?.recentCampaigns.length ? (
            <ul role="list" className="dashboard-rate-chart">
              {snapshot.recentCampaigns.map((campaign) => {
                const rate = campaign.repliedEmails / campaign.sent;
                return (
                  <li key={campaign.id}>
                    <Link className="dashboard-rate-row" href={campaignHref("delivery", campaign.id)}>
                      <span className="dashboard-rate-campaign">
                        <strong>{campaign.name}</strong>
                        <small>{number.format(campaign.repliedEmails)} of {number.format(campaign.sent)} replied</small>
                      </span>
                      <span className="dashboard-rate-bar" aria-hidden="true">
                        <span style={{ inlineSize: rate * 100 + "%" }} />
                      </span>
                      <strong className="dashboard-rate-value">{percent.format(rate)}</strong>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <p className="dashboard-chart-empty">{snapshot ? "No campaigns with sent emails." : unavailable}</p>}
        </div>
      </section>
    </div>
  );
}
