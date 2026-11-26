"use client";

import { ArrowLeft, Check, FileText, RotateCw, Send } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { deliveryLabels, queueSend, readDraftReview, updateDraft, type DraftCampaign, type DraftCampaignSummary, type DraftRecipient, type SendTarget } from "../lib/outreach";
import { isResearchRunId, researchConfigured } from "../lib/research";
import { campaignHref, routes } from "../lib/routes";
import { activityDate } from "../lib/workspace";
import { AppErrorDialog } from "./app-error-dialog";
import { EvidenceExcerpt } from "./evidence-excerpt";
import { CampaignLink, CampaignTable, DeliveryStatus, OutreachEmpty } from "./outreach-campaign-view";
import { PreviewDialog } from "./preview-dialog";
import { useResearchSession } from "./research-session";
import { SourceDialog } from "./source-dialog";
import { useOutreachSnapshot } from "./use-outreach-snapshot";
import { WorkspaceLink, useWorkspaceNavigation, type DraftEdit } from "./workspace-navigation";

const reviewTables = ["outreach_recipients", "outreach_campaigns", "outreach_send_items"] as const;
type DraftAction = "saving" | "approving" | "regenerating" | "skipping";
type Confirmation = { items: SendTarget[]; remaining: number };
const errorTitles: Record<DraftAction, string> = {
  saving: "Couldn’t save the draft",
  approving: "Couldn’t update approval",
  regenerating: "Couldn’t regenerate the draft",
  skipping: "Couldn’t skip the draft",
};

export function OutreachReview() {
  const id = useSearchParams().get("campaign");
  const { session } = useResearchSession();
  if (!researchConfigured) return <OutreachEmpty message="Connect the workspace to see campaigns." href={routes.campaigns} action="View campaigns" />;
  if (!session) return null;
  if (id !== null && !isResearchRunId(id)) return <CampaignUnavailable />;
  return <LiveReview key={session.user.id + "/" + (id ?? "list")} ownerId={session.user.id} id={id} />;
}

function CampaignUnavailable() {
  return <OutreachEmpty message="Campaign unavailable" href={routes.review} action="View campaigns" />;
}

function LiveReview({ ownerId, id }: { ownerId: string; id: string | null }) {
  const load = useCallback(() => readDraftReview(id), [id]);
  const { snapshot, error, refresh } = useOutreachSnapshot(ownerId, reviewTables, load);
  const [dismissedError, setDismissedError] = useState("");

  function retry() {
    setDismissedError("");
    void refresh();
  }

  return (
    <>
      {!snapshot ? (
        <div className="outreach-page">
          <div className="action-card action-content lead-run-placeholder">
            {error ? <button className="button button-secondary" type="button" onClick={retry}>Try again</button> :
              <p role="status">Loading {id ? "campaign" : "campaigns"}…</p>}
          </div>
        </div>
      ) : "campaigns" in snapshot ? <ReviewCampaigns campaigns={snapshot.campaigns} /> : snapshot.campaign ? (
        <DraftReview campaign={snapshot.campaign} onRefresh={refresh} />
      ) : <CampaignUnavailable />}
      <AppErrorDialog title={id ? "Couldn’t load campaign" : "Couldn’t load campaigns"} message={error === dismissedError ? "" : error}
        onClose={() => setDismissedError(error)} onRetry={retry} />
    </>
  );
}

function ReviewCampaigns({ campaigns }: { campaigns: DraftCampaignSummary[] }) {
  if (!campaigns.length) return <OutreachEmpty message="No campaigns yet" href={routes.campaigns} action="Create a campaign" />;

  return (
    <CampaignTable caption="Campaigns" headers={["Created", "Drafts", "Status"]}>
      {campaigns.map((campaign) => {
        const drafts = campaign.outreach_recipients;
        const status = drafts.some((draft) => draft.draft_status === "pending") ? "Generating" :
          drafts.some((draft) => draft.draft_status === "failed" && !draft.approved_revision) ? "Needs attention" :
            drafts.some((draft) => draft.draft_status === "ready" && draft.approved_revision !== draft.revision) ? "In review" : "Reviewed";
        return (
          <tr key={campaign.id}>
            <th scope="row"><CampaignLink name={campaign.name} href={campaignHref("review", campaign.id)} /></th>
            <td><time dateTime={campaign.created_at}>{activityDate.format(new Date(campaign.created_at))}</time></td>
            <td>{drafts.length}</td>
            <td><DeliveryStatus status={status} /></td>
          </tr>
        );
      })}
    </CampaignTable>
  );
}

function draftStatus(draft: DraftRecipient) {
  const activeSend = draft.outreach_send_items?.find((item) => item.status !== "not_sent");
  if (activeSend) return deliveryLabels[activeSend.status];
  if (draft.draft_status === "pending") return "Generating";
  if (draft.draft_status === "skipped") return "Skipped";
  const { prospects } = draft;
  if (!prospects || prospects.stage !== "Generated" || prospects.contacted_at || prospects.replied_at || prospects.do_not_contact) return "Blocked";
  if (draft.approved_revision === draft.revision) return "Approved";
  return draft.draft_status === "failed" ? "Failed" : "Ready for review";
}

function sendLabel(count: number) {
  return count ? "Send " + count + (count === 1 ? " email" : " emails") : "Send approved";
}

function DraftReview({ campaign, onRefresh }: { campaign: DraftCampaign; onRefresh: () => Promise<void> }) {
  const router = useRouter();
  const { buffers, setDraftEdit } = useWorkspaceNavigation();
  const edits = buffers.get(campaign.id);
  const rows = campaign.outreach_recipients;
  const [draftId, setDraftId] = useState(rows[0]?.id);
  const [busy, setBusy] = useState<DraftAction>();
  const [error, setError] = useState<{ title: string; message: string }>();
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [sending, setSending] = useState(false);
  const sendInFlight = useRef(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const campaignHeading = useRef<HTMLHeadingElement>(null);
  const sendDescription = useId();

  const reviewable = rows.filter((draft) => ["Approved", "Ready for review", "Failed"].includes(draftStatus(draft)));
  const approved = reviewable.filter((draft) => draftStatus(draft) === "Approved" && !edits?.has(draft.id));
  const generating = rows.filter((draft) => draft.draft_status === "pending").length;
  const active = rows.find(({ id }) => id === draftId) ?? rows[0];

  useEffect(() => { campaignHeading.current?.focus(); }, []);

  async function perform(label: DraftAction, action: () => Promise<unknown>, success: string) {
    setBusy(label);
    setNotice("");
    setError(undefined);
    try {
      await action();
      setNotice(success);
    } catch (reason) {
      setError({ title: errorTitles[label], message: reason instanceof Error ? reason.message : "Try again in a moment." });
    } finally {
      await onRefresh();
      setBusy(undefined);
    }
  }

  async function confirmSend() {
    if (!confirmation || sendInFlight.current) return;
    const items = confirmation.items;
    const fingerprint = JSON.stringify(items);
    if (request.current?.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
    sendInFlight.current = true;
    setSending(true);
    try {
      await queueSend(campaign.id, items, request.current.id);
      setNotice("Emails queued.");
      setConfirmation(undefined);
      router.push(campaignHref("delivery", campaign.id));
    } catch (reason) {
      setConfirmation(undefined);
      setError({ title: "Couldn’t queue emails", message: reason instanceof Error ? reason.message : "Try again in a moment." });
      await onRefresh();
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  }

  if (!active) return <OutreachEmpty message="No drafts in this campaign" href={routes.review} action="View campaigns" />;
  return (
    <div className="outreach-page draft-review-page">
      <header className="outreach-context">
        <WorkspaceLink className="text-link" href={routes.review}><ArrowLeft size={15} aria-hidden="true" />All campaigns</WorkspaceLink>
        <h2 ref={campaignHeading} tabIndex={-1}>{campaign.name}</h2>
        <p className="stage-summary" role="status">
          {generating ? "Generating " + generating + (generating === 1 ? " draft…" : " drafts…") : ""}
        </p>
      </header>

      <div className="batch-review-grid">
        <section className="action-card batch-queue" aria-labelledby="batch-queue-title">
          <div className="outreach-card-header">
            <h3 id="batch-queue-title">Drafts</h3>
            <span className="record-count">{rows.length}</span>
          </div>
          <ul className="queue-list" aria-label="Campaign drafts">
            {rows.map((draft) => {
              const status = edits?.has(draft.id) ? "Unsaved changes" : draftStatus(draft);
              return (
                <li className="queue-row" key={draft.id} data-active={active.id === draft.id}>
                  <button className="queue-open" type="button" aria-current={active.id === draft.id ? "true" : undefined}
                    disabled={Boolean(busy)} onClick={() => { setDraftId(draft.id); setNotice(""); }}>
                    <span>{draft.research_snapshot.company}</span>
                    {status !== "Ready for review" && <DeliveryStatus status={status} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <DraftEditor key={active.id} draft={active} edit={edits?.get(active.id)} busy={busy} notice={notice} perform={perform}
          onEdit={(edit) => { setNotice(""); setDraftEdit(campaign.id, active.id, edit); }} />
        <DraftSources key={"sources-" + active.id} draft={active} />
      </div>

      <AppErrorDialog title={error?.title} message={error?.message ?? ""} onClose={() => setError(undefined)} />
      {reviewable.length > 0 && (
        <footer className="outreach-stage-footer outreach-approval-footer">
          <p className="stage-summary" role="status">{approved.length} of {reviewable.length} approved</p>
          <button className="button button-primary" type="button" disabled={Boolean(busy) || sending || !approved.length}
            onClick={() => setConfirmation({
              items: approved.map((draft) => ({ recipientId: draft.id, revision: draft.revision })),
              remaining: reviewable.length - approved.length,
            })}>
            <Send size={16} aria-hidden="true" />{sendLabel(approved.length)}
          </button>
        </footer>
      )}

      <PreviewDialog title={sendLabel(confirmation?.items.length ?? approved.length) + "?"} open={Boolean(confirmation)}
        onClose={() => setConfirmation(undefined)} onCancel={() => !sending} descriptionId={sendDescription} showClose={false}>
        <div className="confirm-send-summary" id={sendDescription}>
          <p>{campaign.name}</p>
          {Boolean(confirmation?.remaining) && (
            <p className="field-hint">{confirmation?.remaining} {confirmation?.remaining === 1 ? "draft stays" : "drafts stay"} in review.</p>
          )}
        </div>
        <div className="action-footer">
          <button type="button" className="button button-secondary" autoFocus disabled={sending} onClick={() => setConfirmation(undefined)}>Cancel</button>
          <button type="button" className="button button-primary" disabled={sending} onClick={() => void confirmSend()}>
            {sending ? "Queuing emails…" : "Send now"}
          </button>
        </div>
      </PreviewDialog>
    </div>
  );
}

function DraftSources({ draft }: { draft: DraftRecipient }) {
  const [open, setOpen] = useState(false);
  const { company, contact, evidence = [], emailEvidence, rationale } = draft.research_snapshot;
  const preview = evidence[0] ?? contact ?? emailEvidence;
  const domain = draft.prospects?.domain;
  const summary = rationale?.trim();

  return (
    <aside className="action-card draft-sources" aria-labelledby="draft-sources-title">
      <div className="outreach-card-header"><h3 id="draft-sources-title">Sources</h3></div>
      <div className="draft-sources-content">
        {preview ? (
          <>
            {domain && <p className="source-domain">{domain}</p>}
            {summary ? <p className="draft-source-snippet">{summary}</p> :
              <EvidenceExcerpt excerpt={preview.excerpt} sourceUrl={preview.url} compact />}
            <button className="text-link" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
              <FileText size={15} aria-hidden="true" />View full sources
            </button>
          </>
        ) : <p className="field-hint">No sources saved.</p>}
      </div>
      <SourceDialog prospect={open && preview ? {
        domain: domain ?? company,
        sources: evidence,
        excerpt: preview.excerpt,
        contact: contact ? { name: contact.name, title: contact.title, source: contact } : undefined,
        emailEvidence,
      } : null} onClose={() => setOpen(false)} />
    </aside>
  );
}

function DraftEditor({ draft, edit, busy, notice, perform, onEdit }: {
  draft: DraftRecipient;
  edit?: DraftEdit;
  busy?: DraftAction;
  notice: string;
  perform: (label: DraftAction, action: () => Promise<unknown>, success: string) => Promise<void>;
  onEdit: (edit: DraftEdit | null) => void;
}) {
  const regenerateRequest = useRef<{ revision: number; id: string } | null>(null);
  const status = draftStatus(draft);
  const editable = status === "Approved" || status === "Ready for review" || status === "Failed";
  const current = { revision: draft.revision, subject: draft.subject ?? "", message: draft.message ?? "" };
  const { subject, message } = edit ?? current;
  const stale = edit != null && edit.revision !== draft.revision;
  const valid = Boolean(subject.trim() && message.trim());
  const { company, contact } = draft.research_snapshot;
  const target = { recipientId: draft.id, revision: draft.revision };

  function change(field: "subject" | "message", value: string) {
    const next = { ...(edit ?? current), [field]: value };
    onEdit(!stale && next.subject === current.subject && next.message === current.message ? null : next);
  }

  function save() {
    if (!edit || stale || !valid || !editable || busy) return;
    void perform("saving", async () => {
      await updateDraft({ action: "edit_draft", ...target, subject, message });
      onEdit(null);
    }, "Draft saved.");
  }

  function approve() {
    const approved = status !== "Approved";
    void perform("approving", () => updateDraft({ ...target, action: "approve_draft", approved }),
      approved ? "Draft approved." : "Approval removed.");
  }

  function regenerate() {
    if (regenerateRequest.current?.revision !== draft.revision) {
      regenerateRequest.current = { revision: draft.revision, id: crypto.randomUUID() };
    }
    const requestId = regenerateRequest.current.id;
    void perform("regenerating", async () => {
      await updateDraft({ ...target, action: "regenerate", requestId });
      regenerateRequest.current = null;
    }, "Draft queued for regeneration.");
  }

  const actionStatus = busy ? {
    saving: "Saving…", approving: "Updating approval…", regenerating: "Starting regeneration…", skipping: "Skipping…",
  }[busy] : notice;

  return (
    <section className="action-card draft-review" aria-labelledby="draft-company">
      <header className="review-header draft-identity">
        <div className="review-identity">
          <h3 id="draft-company">{company}</h3>
          <p className="draft-contact">
            {contact ? <><strong>{contact.name}</strong>{contact.title && " · " + contact.title}</> : "Contact name unavailable"}
          </p>
        </div>
      </header>
      {status === "Generating" ? (
        <div className="draft-fields"><p className="field-hint" role="status">Generating this draft…</p></div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); save(); }}>
          <div className="draft-fields">
            {status === "Failed" && <p className="field-hint" role="status">Couldn’t generate this draft. Regenerate to try again.</p>}
            {stale && (
              <div className="draft-conflict">
                <p role="status">This draft changed elsewhere. Check the saved copy before applying your edits.</p>
                <details>
                  <summary>View saved draft</summary>
                  <strong>{current.subject}</strong>
                  <p className="saved-draft-copy">{current.message}</p>
                  <button className="button button-secondary" type="button" disabled={!editable || Boolean(busy)}
                    onClick={() => onEdit({ ...edit, revision: draft.revision })}>Keep my edits</button>
                </details>
              </div>
            )}
            <div className="form-field">
              <label htmlFor="outreach-subject">Subject</label>
              <input id="outreach-subject" value={subject} required maxLength={160} readOnly={!editable || Boolean(busy)} onChange={(event) => change("subject", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="outreach-message">Message</label>
              <textarea id="outreach-message" rows={10} value={message} required maxLength={8000} readOnly={!editable || Boolean(busy)} onChange={(event) => change("message", event.target.value)} />
            </div>
            <p className="draft-action-status" role="status">{actionStatus || (edit ? "Unsaved changes" : "")}</p>
          </div>
          {(editable || edit) && (
            <footer className="draft-footer">
              {edit ? (
                <>
                  <button className="text-link skip-draft" type="button" disabled={Boolean(busy)} onClick={() => onEdit(null)}>Discard edits</button>
                  <button className="button button-primary" type="submit" disabled={!editable || Boolean(busy) || stale || !valid}>Save changes</button>
                </>
              ) : (
                <>
                  <button className="text-link skip-draft" type="button" disabled={Boolean(busy)}
                    onClick={() => void perform("skipping", () => updateDraft({ ...target, action: "skip_draft" }), "Draft skipped.")}>Skip draft</button>
                  <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={regenerate}>
                    <RotateCw size={15} aria-hidden="true" />Regenerate draft
                  </button>
                  <button className="button button-secondary draft-approve" type="button" disabled={Boolean(busy) || !valid} onClick={approve}>
                    {status === "Approved" ? "Undo approval" : <><Check size={15} aria-hidden="true" />Approve draft</>}
                  </button>
                </>
              )}
            </footer>
          )}
        </form>
      )}
    </section>
  );
}
