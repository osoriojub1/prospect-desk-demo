export const routes = {
  dashboard: "/",
  search: "/research/",
  runStatus: "/research/status/",
  prospects: "/prospects/",
  campaigns: "/outreach/campaigns/",
  review: "/outreach/review/",
  delivery: "/outreach/delivery/",
  logs: "/system/logs/",
} as const;

export const dashboardLabel = "Dashboard";

export const leadGenerationLabels = {
  search: "Find companies",
  runStatus: "Search activity",
  prospects: "Prospects",
} as const;

export const signInRoute = "/sign-in/";

export function workspaceDestination(next: string | null) {
  const path = next?.split(/[?#]/, 1)[0];
  return next && Object.values(routes).some((route) => route === path) ? next : routes.dashboard;
}

export function researchHref(page: "search" | "runStatus" | "prospects", runId: string) {
  return `${routes[page]}?run=${encodeURIComponent(runId)}`;
}

export function campaignHref(step: "review" | "delivery", id: string) {
  return `${routes[step]}?campaign=${encodeURIComponent(id)}`;
}

export function threadHref(campaignId: string, prospectId: string) {
  return `${campaignHref("delivery", campaignId)}&thread=${encodeURIComponent(prospectId)}`;
}
