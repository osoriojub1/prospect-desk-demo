import type { Prospect } from "./prospects";

export type CampaignFilters = {
  industry: Prospect["industry"] | "";
  location: Prospect["location"] | "";
};

export type CampaignInfo = { id: string; name: string; created_at: string };

export const activityDate = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Shanghai",
});

export function getCampaignAudience(prospects: Prospect[], campaignByProspect: ReadonlyMap<string, CampaignInfo>, filters: CampaignFilters) {
  const eligible: { prospect: Prospect; recipient: string }[] = [];
  const excluded = { optedOut: 0, contacted: 0, missingEmail: 0 };
  const existingDrafts = new Map<string, { campaign: CampaignInfo; count: number }>();

  for (const prospect of prospects) {
    if ((filters.industry && filters.industry !== prospect.industry) ||
        (filters.location && filters.location !== prospect.location)) continue;
    const campaign = campaignByProspect.get(prospect.id);
    const recipient = prospect.contactEmail?.trim();
    if (prospect.doNotContact) excluded.optedOut++;
    else if (prospect.stage !== "Generated" || prospect.contactedAt || prospect.repliedAt) excluded.contacted++;
    else if (campaign) {
      const draftGroup = existingDrafts.get(campaign.id);
      existingDrafts.set(campaign.id, { campaign, count: (draftGroup?.count ?? 0) + 1 });
    } else if (!recipient || recipient.length > 254 || !/^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(recipient)) excluded.missingEmail++;
    else eligible.push({ prospect, recipient });
  }

  return {
    eligible, excluded,
    existingDrafts: [...existingDrafts.values()].sort((a, b) => b.campaign.created_at.localeCompare(a.campaign.created_at)),
  };
}
