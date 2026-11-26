import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";

function resolveEvidenceLink(url: string, sourceUrl?: string) {
  if (!url.trim()) return undefined;
  try {
    const resolved = new URL(url, sourceUrl);
    if (resolved.protocol === "mailto:") return resolved.href;
    if ((resolved.protocol === "https:" || resolved.protocol === "http:") && !resolved.username && !resolved.password) {
      return resolved.href;
    }
  } catch {
    // A malformed destination leaves the link label as text.
  }
  return undefined;
}

function EvidenceLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <>{children}</>;
  if (href.startsWith("mailto:")) return <a href={href}>{children}</a>;
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

function EvidenceImageText({ alt }: { alt?: string }) {
  return alt ?? null;
}

export function EvidenceExcerpt({ excerpt, sourceUrl, heading = "h3", compact = false }: {
  excerpt: string;
  sourceUrl?: string;
  heading?: "h3" | "h4";
  compact?: boolean;
}) {
  const components: Components = {
    a: EvidenceLink,
    h1: heading,
    h2: heading,
    h3: heading,
    h4: heading,
    h5: heading,
    h6: heading,
    img: EvidenceImageText,
  };

  return (
    <blockquote className={compact ? "evidence-excerpt evidence-excerpt-compact" : "evidence-excerpt"} cite={sourceUrl}>
      <Markdown
        skipHtml
        components={components}
        allowedElements={compact ? ["strong", "em", "code", "img"] : undefined}
        unwrapDisallowed={compact}
        urlTransform={(url, key) => key === "href" ? resolveEvidenceLink(url, sourceUrl) : undefined}
      >
        {excerpt}
      </Markdown>
    </blockquote>
  );
}
