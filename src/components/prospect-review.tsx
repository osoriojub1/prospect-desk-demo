import {
  ArrowUpRight,
  Building2,
  CircleSlash,
  FileText,
  MapPin,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { emailKindLabels, outreachDate, outreachStatusLabels, type Prospect, type Stage, type Triage } from "../lib/prospects";
import { EvidenceExcerpt } from "./evidence-excerpt";

export function CompanyMark({ prospect }: { prospect: Prospect }) {
  return (
    <span className={`company-mark tone-${prospect.tone}`} aria-hidden="true">
      {prospect.initials}
    </span>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`badge stage-${stage.toLowerCase()}`}>
      <span className="badge-dot" aria-hidden="true" />
      {outreachStatusLabels[stage]}
    </span>
  );
}

export function FitLabel({ fit }: { fit: Prospect["fit"] }) {
  return (
    <span className="fit-label" data-fit={fit}>
      <span className="fit-dot" aria-hidden="true" />
      {fit === "Insufficient evidence" ? (
        <>
          <span aria-hidden="true">Insufficient</span>
          <span className="sr-only">Insufficient evidence</span>
        </>
      ) : fit}
    </span>
  );
}

export function TriageBadge({ triage }: { triage: Triage }) {
  return <span className="badge triage-badge" data-triage={triage}>{triage}</span>;
}

export function ContactFlag({ label = "Do not contact" }: { label?: "Do not contact" | "Flagged" }) {
  return (
    <span className="badge contact-flag">
      <CircleSlash size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ProspectEvidence({ prospect, onEvidence }: { prospect: Prospect; onEvidence: () => void }) {
  return (
    <>
      <section className="review-section">
        <div className="review-section-heading">
          <h3><Sparkles size={16} aria-hidden="true" />Why this company fits</h3>
          <FitLabel fit={prospect.fit} />
        </div>
        <p>{prospect.rationale}</p>
      </section>

      <section className="review-section">
        <div className="review-section-heading">
          <h3>Source evidence</h3>
        </div>
        <div className="evidence-card">
          <EvidenceExcerpt excerpt={prospect.excerpt} sourceUrl={prospect.sources?.[0]?.url ?? `https://${prospect.domain}`} heading="h4" />
          <button className="evidence-link" type="button" onClick={onEvidence}>
            <FileText size={14} aria-hidden="true" />
            {prospect.sources ? "View sources" : "View website excerpt"}
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </div>
      </section>
    </>
  );
}

type ReviewProps = {
  prospect: Prospect;
  headingId: string;
  onClose: () => void;
  onEvidence: () => void;
};

export function ProspectReview({ prospect, headingId, onClose, onEvidence }: ReviewProps) {
  const hasReply = prospect.stage === "Replied";
  const signals = prospect.signals ?? [];

  return (
    <>
      <header className="review-header">
        <CompanyMark prospect={prospect} />
        <div className="review-identity">
          <h2 id={headingId}>{prospect.name}</h2>
          <span>{prospect.domain}</span>
        </div>
        <button className="icon-button close-review" type="button" onClick={onClose} aria-label="Close prospect">
          <X size={17} aria-hidden="true" />
        </button>
      </header>

      <div className="review-body">
        <div className="company-metadata">
          <span><MapPin size={15} aria-hidden="true" />{prospect.location}</span>
          <span><Building2 size={15} aria-hidden="true" />{prospect.industry}</span>
          {prospect.contact && <span><UserRound size={15} aria-hidden="true" />{prospect.contact.name} · {prospect.contact.title}</span>}
          <div className="prospect-email">
            <strong>{prospect.contactEmail ? emailKindLabels[prospect.emailKind ?? "unattributed"] : "No published work email"}</strong>
            {prospect.contactEmail && <span>{prospect.contactEmail}</span>}
          </div>
        </div>

        <ProspectEvidence prospect={prospect} onEvidence={onEvidence} />

        {signals.length > 0 && (
          <section className="review-section">
            <div className="review-section-heading"><h3>Signals</h3></div>
            <ul className="signal-list">
              {signals.map((signal) => <li key={signal}>{signal}</li>)}
            </ul>
          </section>
        )}

        <section className="review-section outreach-section">
          <div className="review-section-heading">
            <h3>Outreach status</h3>
            <StageBadge stage={prospect.stage} />
          </div>
          {prospect.contactedAt && (
            <div className="outreach-line">
              <span>First contact</span>
              <time dateTime={prospect.contactedAt}>{outreachDate.format(new Date(prospect.contactedAt))}</time>
            </div>
          )}
          {prospect.repliedAt && (
            <div className="outreach-line">
              <span>Reply received</span>
              <time dateTime={prospect.repliedAt}>{outreachDate.format(new Date(prospect.repliedAt))}</time>
            </div>
          )}
          {hasReply && (
            <>
              <div className="outreach-line">
                <span>Reply outcome</span>
                {prospect.triage ? <TriageBadge triage={prospect.triage} /> : "—"}
              </div>
              {prospect.replyExcerpt && <blockquote className="reply-excerpt">“{prospect.replyExcerpt}”</blockquote>}
              {prospect.doNotContact && <ContactFlag />}
            </>
          )}
        </section>
      </div>
    </>
  );
}
