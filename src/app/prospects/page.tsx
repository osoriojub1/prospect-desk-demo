import { Suspense } from "react";
import { ProspectWorkspace } from "../../components/prospect-workspace";

export const metadata = { title: "Prospect review | Prospect Desk" };

export default function ProspectsPage() {
  return <Suspense><ProspectWorkspace /></Suspense>;
}
