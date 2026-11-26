import type { Prospect } from "./prospects";

export type CampaignFilters = {
  industry: Prospect["industry"] | "";
  location: Prospect["location"] | "";
};

export const activityDate = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Shanghai",
});

export function getCampaignAudience(prospects: Prospect[], reserved: ReadonlySet<string>, filters: CampaignFilters) {
  const eligible: { prospect: Prospect; recipient: string }[] = [];
  const excluded = { optedOut: 0, contacted: 0, reserved: 0, missingEmail: 0 };

  for (const prospect of prospects) {
    if ((filters.industry && filters.industry !== prospect.industry) ||
        (filters.location && filters.location !== prospect.location)) continue;
    const recipient = prospect.contactEmail?.trim();
    if (prospect.doNotContact) excluded.optedOut++;
    else if (prospect.stage !== "Generated" || prospect.contactedAt || prospect.repliedAt) excluded.contacted++;
    else if (reserved.has(prospect.id)) excluded.reserved++;
    else if (!recipient || recipient.length > 254 || !/^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(recipient)) excluded.missingEmail++;
    else eligible.push({ prospect, recipient });
  }

  return { eligible, excluded };
}
