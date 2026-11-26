import { Suspense } from "react";
import { OutreachReview } from "../../../components/outreach-review";

export const metadata = { title: "Draft review | Prospect Desk" };

export default function ReviewPage() {
  return <Suspense><OutreachReview /></Suspense>;
}
