import { Suspense } from "react";
import { ProspectWorkspace } from "../../components/prospect-workspace";
import { leadGenerationLabels } from "../../lib/routes";

export const metadata = { title: leadGenerationLabels.prospects + " | Prospect Desk" };

export default function ProspectsPage() {
  return <Suspense><ProspectWorkspace /></Suspense>;
}
