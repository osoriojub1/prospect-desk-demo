import { ArrowUpRight } from "lucide-react";
import type { Prospect, SourceEvidence } from "../lib/prospects";
import { EvidenceExcerpt } from "./evidence-excerpt";
import { PreviewDialog } from "./preview-dialog";

export function SourceDialog({ prospect, onClose }: {
  prospect: Pick<Prospect, "domain" | "sources" | "excerpt" | "contact" | "emailEvidence"> | null;
  onClose: () => void;
}) {
  return (
    <PreviewDialog title={prospect?.sources ? "Source evidence" : "Website excerpt"} open={Boolean(prospect)} onClose={onClose}>
      {prospect && (
          <div className="source-dialog-body">
            <p className="source-domain">{prospect.domain}</p>
            {prospect.sources ? (
              <>
                {prospect.sources.map((source) => <SourceQuote key={`${source.url}/${source.excerpt}`} source={source} />)}
                {prospect.contact?.source && (
                  <section className="contact-source" aria-label="Contact evidence">
                    <h3>{prospect.contact.name} · {prospect.contact.title}</h3>
                    <SourceQuote source={prospect.contact.source} heading="h4" />
                  </section>
                )}
                {prospect.emailEvidence && (
                  <section className="contact-source" aria-label="Work email evidence">
                    <h3>Work email</h3>
                    <SourceQuote source={prospect.emailEvidence} heading="h4" />
                  </section>
                )}
              </>
            ) : (
              <EvidenceExcerpt excerpt={prospect.excerpt} sourceUrl={`https://${prospect.domain}`} />
            )}
          </div>
      )}
    </PreviewDialog>
  );
}

function SourceQuote({ source, heading }: { source: SourceEvidence; heading?: "h3" | "h4" }) {
  return (
    <div className="source-quote">
      <EvidenceExcerpt excerpt={source.excerpt} sourceUrl={source.url} heading={heading} />
      {source.url.startsWith("https://") && <a className="text-link" href={source.url} target="_blank" rel="noreferrer" aria-label={`Open source at ${source.url}`}>Open source<ArrowUpRight size={14} aria-hidden="true" /></a>}
    </div>
  );
}
