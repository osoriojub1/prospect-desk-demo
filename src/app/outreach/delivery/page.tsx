import { Suspense } from "react";
import { OutreachActivity } from "../../../components/outreach-delivery";

export const metadata = { title: "Email activity | Prospect Desk" };

export default function EmailActivityPage() {
  return <Suspense><OutreachActivity /></Suspense>;
}
