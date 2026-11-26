import { readActivityCampaigns } from "./outreach";
import { readResearchRuns, researchClient } from "./research";

export async function readDashboard() {
  const client = researchClient();
  const countProspects = () => client.from("prospects")
    .select("id,run_prospects!inner(prospect_id)", { count: "exact", head: true });
  const [notContacted, awaitingReply, replied, doNotContact, { runs }, campaigns] = await Promise.all([
    countProspects().eq("stage", "Generated"),
    countProspects().eq("stage", "Contacted"),
    countProspects().eq("stage", "Replied"),
    countProspects().eq("do_not_contact", true),
    readResearchRuns(0),
    readActivityCampaigns(),
  ]);

  if ([notContacted, awaitingReply, replied, doNotContact].some(({ error }) => error)) {
    throw new Error("Could not load prospect totals. Try again.");
  }

  const outreachProgress = {
    notContacted: notContacted.count ?? 0,
    awaitingReply: awaitingReply.count ?? 0,
    replied: replied.count ?? 0,
  };
  const contacted = outreachProgress.awaitingReply + outreachProgress.replied;

  return {
    totals: {
      prospects: outreachProgress.notContacted + contacted,
      contacted,
      replied: outreachProgress.replied,
      doNotContact: doNotContact.count ?? 0,
    },
    outreachProgress,
    recentCampaigns: campaigns.filter((campaign) => campaign.sent > 0).slice(0, 4),
    recentSearches: runs.slice(0, 5),
  };
}
