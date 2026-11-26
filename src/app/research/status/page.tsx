import { Suspense } from "react";
import { LeadRunStatus } from "../../../components/lead-run-status";

export const metadata = { title: "Lead searches | Prospect Desk" };

export default function LeadRunStatusPage() {
  return <Suspense><LeadRunStatus /></Suspense>;
}
