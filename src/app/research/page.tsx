import { Suspense } from "react";
import { SearchWorkspace } from "../../components/search-workspace";
import { leadGenerationLabels } from "../../lib/routes";

export const metadata = { title: leadGenerationLabels.search + " | Prospect Desk" };

export default function SearchPage() {
  return <Suspense><SearchWorkspace /></Suspense>;
}
