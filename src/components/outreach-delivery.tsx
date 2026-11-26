"use client";

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { deliveryLabels, markRepliesRead, readActivityCampaigns, readActivityEmails, readAirtableStatus, type ActivityCampaign, type ActivityEmail } from "../lib/outreach";
import { isResearchRunId, researchConfigured } from "../lib/research";
import { campaignHref, routes, threadHref } from "../lib/routes";
import { activityDate } from "../lib/workspace";
import { AppErrorDialog } from "./app-error-dialog";
import { CampaignLink, CampaignTable, DeliveryStatus, OutreachEmpty } from "./outreach-campaign-view";
import { ContactFlag, TriageBadge } from "./prospect-review";
import { useResearchSession, useWorkspaceEvents } from "./research-session";
import { useOutreachSnapshot } from "./use-outreach-snapshot";

const activityTables = ["outreach_send_items", "outreach_replies"] as const;
const syncTables = ["airtable_syncs"] as const;
const campaignsPerPage = 5;
const airtableLabels = {
  pending: "Airtable sync queued",
  syncing: "Syncing to Airtable",
  synced: "Synced to Airtable",
  failed: "Airtable sync failed",
} as const;
const sendFailureDetails: Record<string, string> = {
  ineligible: "The recipient is no longer eligible.",
  gmail_rejected: "Gmail rejected this email.",
  gmail_unconfirmed: "Check Gmail before trying to send again.",
  workflow_interrupted: "Email delivery stopped. Check System Logs for details.",
};

export function OutreachActivity() {
  const { session } = useResearchSession();
  const params = useSearchParams();
  const campaignId = params.get("campaign");
  const threadId = params.get("thread");
  if (!researchConfigured) return <OutreachEmpty message="Connect the workspace to see email activity." href={routes.review} action="Go to draft review" />;
  if (!session) return null;
  if (campaignId !== null && !isResearchRunId(campaignId)) return <NoCampaignActivity />;
  return <ActivityView key={session.user.id + "/" + (campaignId ?? "list")} ownerId={session.user.id}
    campaignId={campaignId} threadId={threadId} />;
}

function NoCampaignActivity() {
  return <OutreachEmpty message="No email activity for this campaign" href={routes.delivery} action="View campaigns" />;
}

function ActivityView({ ownerId, campaignId, threadId }: { ownerId: string; campaignId: string | null; threadId: string | null }) {
  const load = useCallback(async () => {
    const [campaigns, emails] = await Promise.all([
      readActivityCampaigns(),
      campaignId ? readActivityEmails(campaignId) : Promise.resolve([]),
    ]);
    return { campaigns, emails };
  }, [campaignId]);
  const { snapshot, error, live, refresh } = useOutreachSnapshot(ownerId, activityTables, load);
  const [dismissedError, setDismissedError] = useState("");

  function retry() {
    setDismissedError("");
    void refresh();
  }

  const campaign = snapshot?.campaigns.find(({ id }) => id === campaignId);
  const selected = snapshot?.emails.find(({ id }) => id === threadId) ??
    snapshot?.emails.find(({ outreach_recipients }) => outreach_recipients.prospect_id === threadId);
  const inProgress = campaign ? campaign.queued + campaign.sending : 0;

  return (
    <>
      {!snapshot ? (
        <div className="outreach-page">
          <div className="action-card action-content lead-run-placeholder">
            {error ? <button className="button button-secondary" type="button" onClick={retry}>Try again</button> :
              <p role="status">Loading email activity…</p>}
          </div>
        </div>
      ) : campaignId ? (
        campaign ? (
          <div className="outreach-page">
            <header className="outreach-context">
              <Link className="text-link" href={routes.delivery}><ArrowLeft size={15} aria-hidden="true" />All campaigns</Link>
              <h2>{campaign.name}</h2>
              <p className="stage-summary" role="status">
                {inProgress > 0 && (inProgress + (inProgress === 1 ? " email" : " emails") + (campaign.sending ? " in progress" : " queued"))}
                {live === false ? (inProgress > 0 ? " · Reconnecting…" : "Reconnecting…") : ""}
              </p>
            </header>
            <div className="activity-grid">
              <ActivityCampaigns campaigns={snapshot.campaigns} activeId={campaign.id} />
              {selected ? <EmailThread key={selected.id} ownerId={ownerId} campaignId={campaign.id} email={selected} onRefresh={refresh} />
                : <CampaignEmails campaignId={campaign.id} emails={snapshot.emails} />}
            </div>
          </div>
        ) : <NoCampaignActivity />
      ) : (
        snapshot.campaigns.length ? <ActivityList campaigns={snapshot.campaigns} /> :
          <OutreachEmpty message="No email activity yet" href={routes.review} action="Go to draft review" />
      )}
      <AppErrorDialog title="Couldn’t load email activity" message={error === dismissedError ? "" : error}
        onClose={() => setDismissedError(error)} onRetry={retry} />
    </>
  );
}

function ActivityList({ campaigns }: { campaigns: ActivityCampaign[] }) {
  return (
    <CampaignTable caption="Campaign email activity" headers={["Emails", "In progress", "Sent", "Not sent", "Unconfirmed", "Replies"]}>
      {campaigns.map((campaign) => (
        <tr key={campaign.id}>
          <th scope="row"><CampaignLink href={campaignHref("delivery", campaign.id)} name={campaign.name} /></th>
          <td>{campaign.emailCount}</td>
          <td>{campaign.queued + campaign.sending}</td>
          <td>{campaign.sent}</td>
          <td>{campaign.notSent}</td>
          <td>{campaign.uncertain}</td>
          <td><span className="reply-count">{campaign.replies}{campaign.unread > 0 && <span className="badge new-reply">{campaign.unread} new</span>}</span></td>
        </tr>
      ))}
    </CampaignTable>
  );
}

function ActivityCampaigns({ campaigns, activeId }: { campaigns: ActivityCampaign[]; activeId: string }) {
  const [browse, setBrowse] = useState<{ activeId: string; page: number }>();
  const pageCount = Math.ceil(campaigns.length / campaignsPerPage);
  const activePage = Math.floor(campaigns.findIndex(({ id }) => id === activeId) / campaignsPerPage);
  const page = browse?.activeId === activeId ? Math.min(browse.page, pageCount - 1) : activePage;
  const visible = campaigns.slice(page * campaignsPerPage, (page + 1) * campaignsPerPage);

  return (
    <nav className="action-card batch-queue activity-campaigns" aria-labelledby="activity-campaign-list">
      <div className="outreach-card-header"><h3 id="activity-campaign-list">Campaigns</h3></div>
      <ul className="queue-list">
        {visible.map(({ id, name, unread }) => (
          <li key={id} className="queue-row" data-active={id === activeId}>
            <Link className="queue-open activity-campaign-link" href={campaignHref("delivery", id)} aria-current={id === activeId ? "page" : undefined}>
              <span>{name}</span>
              {unread > 0 && <span className="badge new-reply">{unread} new</span>}
            </Link>
          </li>
        ))}
      </ul>
      {pageCount > 1 && (
        <div className="pagination campaign-pages" role="group" aria-label="Campaign pages">
          <button type="button" className="icon-button" aria-label="Previous campaign page" disabled={page === 0} onClick={() => setBrowse({ activeId, page: page - 1 })}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="page-number" role="status">{page + 1} / {pageCount}</span>
          <button type="button" className="icon-button" aria-label="Next campaign page" disabled={page >= pageCount - 1} onClick={() => setBrowse({ activeId, page: page + 1 })}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  );
}

function CampaignEmails({ campaignId, emails }: { campaignId: string; emails: ActivityEmail[] }) {
  return (
    <section className="action-card data-card" aria-label="Campaign emails">
      <table className="outreach-table activity-table">
        <caption className="sr-only">Campaign emails</caption>
        <thead><tr><th scope="col">Recipient</th><th scope="col">Subject</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {emails.map((email) => {
            const unread = email.outreach_replies.some(({ read_at }) => !read_at);
            return (
              <tr key={email.id}>
                <th scope="row"><span className="email-recipient">{email.outreach_recipients.research_snapshot.company}<small>{email.address}</small></span></th>
                <td><Link className="subject-link" href={threadHref(campaignId, email.id)}>{email.subject}</Link></td>
                <td>
                  <div className="email-thread-status">
                    <DeliveryStatus status={deliveryLabels[email.status]} />
                    {unread ? <span className="badge new-reply">New reply</span> :
                      email.outreach_replies.length > 0 && <span className="badge read-reply">Replied</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function EmailThread({ ownerId, campaignId, email, onRefresh }: {
  ownerId: string; campaignId: string; email: ActivityEmail; onRefresh: () => Promise<void>;
}) {
  const { refreshReplies } = useWorkspaceEvents();
  const [readError, setReadError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const unreadKey = email.outreach_replies.filter(({ read_at }) => !read_at).map(({ id }) => id).join(",");
  const recipient = email.outreach_recipients;
  const time = email.finished_at ?? email.attempted_at;
  const failureDetail = email.failure_code && sendFailureDetails[email.failure_code];
  const markRead = useCallback(async () => {
    setReadError("");
    try {
      await markRepliesRead(email.id);
      await Promise.all([onRefresh(), refreshReplies()]);
    } catch (reason) {
      setReadError(reason instanceof Error ? reason.message : "Try again in a moment.");
    }
  }, [email.id, onRefresh, refreshReplies]);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (unreadKey) void markRead(); }, [unreadKey, markRead]);

  return (
    <section className="action-card email-thread" aria-labelledby="email-thread-subject">
      <header className="thread-heading">
        <Link className="text-link" href={campaignHref("delivery", campaignId)}><ArrowLeft size={15} aria-hidden="true" />Back to emails</Link>
        <h3 id="email-thread-subject" tabIndex={-1} ref={heading}>{email.subject}</h3>
        <div className="thread-recipient">
          <strong>{recipient.research_snapshot.company}</strong><span>{email.address}</span>
          {recipient.prospects.triage && <TriageBadge triage={recipient.prospects.triage} />}
          {recipient.prospects.do_not_contact && <ContactFlag />}
          {email.outreach_replies.length > 0 && <AirtableSync ownerId={ownerId} prospectId={recipient.prospect_id} />}
        </div>
      </header>
      <ol className="thread-messages" aria-label="Email thread">
        <li>
          <div className="thread-message-meta">
            <h4>Outreach</h4><DeliveryStatus status={deliveryLabels[email.status]} />
            {time && <time dateTime={time}>{activityDate.format(new Date(time))}</time>}
          </div>
          {failureDetail && <p className="field-hint">{failureDetail}</p>}
          <p>{email.message}</p>
        </li>
        {email.outreach_replies.map((reply) => (
          <li key={reply.id}>
            <div className="thread-message-meta">
              <h4>Reply</h4>
              <span>{reply.sender}</span>
              {reply.outcome === "Do not contact" ? <ContactFlag /> :
                reply.outcome && reply.outcome !== "No interest shown" ? <TriageBadge triage={reply.outcome} /> :
                  <span className="badge read-reply">{reply.outcome ?? "Outcome pending"}</span>}
              <time dateTime={reply.received_at}>{activityDate.format(new Date(reply.received_at))}</time>
            </div>
            <p>{reply.message}</p>
          </li>
        ))}
      </ol>
      <AppErrorDialog title="Couldn’t mark replies as read" message={readError} onClose={() => setReadError("")} onRetry={markRead} />
    </section>
  );
}

function AirtableSync({ ownerId, prospectId }: { ownerId: string; prospectId: string }) {
  const load = useCallback(() => readAirtableStatus(prospectId), [prospectId]);
  const { snapshot, error } = useOutreachSnapshot(ownerId, syncTables, load);
  return (
    <span className="airtable-state" data-sync={snapshot} role="status">
      {snapshot ? airtableLabels[snapshot] : error ? "Airtable status unavailable" : ""}
    </span>
  );
}
