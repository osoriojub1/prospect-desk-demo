import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { deliveryLabels } from "../lib/outreach";
import { WorkspaceLink } from "./workspace-navigation";

export function CampaignTable({ caption, headers, children }: { caption: string; headers: string[]; children: ReactNode }) {
  return (
    <div className="outreach-page">
      <div className="action-card data-card">
        <table className="outreach-table">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th scope="col">Campaign</th>{headers.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function CampaignLink({ href, name }: { href: string; name: string }) {
  return <WorkspaceLink className="campaign-link" href={href}>{name}<ArrowRight size={14} aria-hidden="true" /></WorkspaceLink>;
}

export function OutreachEmpty({ message, href, action }: { message: string; href: string; action: string }) {
  return (
    <div className="outreach-page">
      <div className="action-card empty-list">
        <p>{message}</p>
        <WorkspaceLink className="button button-secondary" href={href}>{action}</WorkspaceLink>
      </div>
    </div>
  );
}

type Status = (typeof deliveryLabels)[keyof typeof deliveryLabels] | "Ready for review" | "Approved" | "Skipped"
  | "Blocked" | "In review" | "Reviewed" | "Generating" | "Failed" | "Needs attention" | "Unsaved changes";

export function DeliveryStatus({ status }: { status: Status }) {
  return <span className="badge delivery-status" data-status={status}>{status}</span>;
}
