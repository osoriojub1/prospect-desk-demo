import { DashboardWorkspace } from "../components/dashboard-workspace";
import { dashboardLabel } from "../lib/routes";

export const metadata = { title: dashboardLabel + " | Prospect Desk" };

export default function Home() {
  return <DashboardWorkspace />;
}
