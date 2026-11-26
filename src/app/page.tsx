import { Suspense } from "react";
import { SearchWorkspace } from "../components/search-workspace";

export default function Home() {
  return <Suspense><SearchWorkspace /></Suspense>;
}
