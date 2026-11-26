import { Suspense } from "react";
import { LeadRunStatus } from "../../../components/lead-run-status";
import { leadGenerationLabels } from "../../../lib/routes";

export const metadata = { title: leadGenerationLabels.runStatus + " | Prospect Desk" };

export default function LeadRunStatusPage() {
  return <Suspense><LeadRunStatus /></Suspense>;
}
