import { FunctionsHttpError } from "@supabase/supabase-js";
import type { EmailKind, OutreachDraft, Prospect, SourceEvidence } from "./prospects";
import { readResearchProspects, researchClient } from "./research";
import type { CampaignFilters } from "./workspace";

export const campaignLimit = 50;

export const deliveryLabels = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  not_sent: "Not sent",
  uncertain: "Send unconfirmed",
} as const;

type SendStatus = keyof typeof deliveryLabels;
export type SendTarget = { recipientId: string; revision: number };

type DraftState = {
  draft_status: "pending" | "ready" | "failed" | "skipped";
  revision: number;
  approved_revision: number | null;
  outreach_send_items?: { status: SendStatus }[];
};

export type DraftRecipient = DraftState & {
  id: string;
  subject: string | null;
  message: string | null;
  research_snapshot: {
    company: string;
    contact: ({ name: string; title: string } & SourceEvidence) | null;
    evidence: SourceEvidence[];
    rationale?: string;
    emailKind?: EmailKind;
    emailEvidence?: SourceEvidence;
  };
  prospects: {
    domain: string;
    stage: Prospect["stage"];
    contacted_at: string | null;
    replied_at: string | null;
    do_not_contact: boolean;
  } | null;
};

type CampaignInfo = { id: string; name: string; created_at: string };
export type DraftCampaign = CampaignInfo & { outreach_recipients: DraftRecipient[] };
export type DraftCampaignSummary = CampaignInfo & { outreach_recipients: DraftState[] };
export type DraftReviewSnapshot = { campaign: DraftCampaign | null } | { campaigns: DraftCampaignSummary[] };

type DraftTarget = { recipientId: string; revision: number };
type DraftAction = DraftTarget & (
  { action: "edit_draft" } & OutreachDraft |
  { action: "approve_draft"; approved: boolean } |
  { action: "skip_draft" } |
  { action: "regenerate"; requestId: string }
);

async function invokeOutreach<Result>(body: object, fallback: string) {
  const { data, error } = await researchClient().functions.invoke<Result>("outreach", { body });
  if (error instanceof FunctionsHttpError) {
    const response = await error.context.json().catch(() => null);
    if (response?.code === "NOT_FOUND") throw new Error("The outreach service is not deployed.");
    if (typeof response?.error === "string") throw new Error(response.error);
  }
  if (error || !data) throw new Error(fallback);
  return data;
}

export async function startDraftCampaign(input: CampaignFilters & { name: string; offer: string; runId?: string; prospectIds: string[]; requestId: string }) {
  const result = await invokeOutreach<{ campaignId: string }>({ action: "create_campaign", ...input }, "Could not start draft generation. Try again.");
  if (!result.campaignId) throw new Error("Could not start draft generation. Try again.");
  return result.campaignId;
}

export function updateDraft(action: DraftAction) {
  return invokeOutreach<{ revision?: number }>(action, "Could not update the draft. Try again.");
}

export async function queueSend(campaignId: string, items: SendTarget[], requestId: string) {
  const result = await invokeOutreach<{ jobId: string }>({ action: "queue_send", campaignId, items, requestId }, "Could not queue the emails. Try again.");
  if (!result.jobId) throw new Error("Could not queue the emails. Try again.");
  return result.jobId;
}

export function markRepliesRead(sendItemId: string) {
  return invokeOutreach({ action: "read_replies", sendItemId }, "Could not mark replies as read. Try again.");
}

export function markLogsRead() {
  return invokeOutreach({ action: "read_logs" }, "Could not mark the events as read. Try again.");
}

export async function readCampaignAudience(runId: string | null) {
  const [prospects, reservations] = await Promise.all([
    readResearchProspects(runId),
    researchClient().from("outreach_recipients").select("prospect_id").is("released_at", null),
  ]);
  if (reservations.error) throw new Error("Could not check campaign eligibility. Try again.");
  return { prospects, reserved: new Set<string>(reservations.data.map((row) => row.prospect_id)) };
}

export async function readDraftReview(campaignId: string | null): Promise<DraftReviewSnapshot> {
  const client = researchClient();
  const fields = "id,name,created_at";
  const state = "draft_status,revision,approved_revision,outreach_send_items(status)";
  if (campaignId) {
    const { data, error } = await client.from("outreach_campaigns")
      .select(`${fields},outreach_recipients(id,subject,message,research_snapshot,${state},prospects(domain,stage,contacted_at,replied_at,do_not_contact))`)
      .eq("id", campaignId).order("id", { referencedTable: "outreach_recipients" }).maybeSingle<DraftCampaign>();
    if (error) throw new Error("Could not load the campaign. Try again.");
    return { campaign: data };
  }

  const { data, error } = await client.from("outreach_campaigns")
    .select(`${fields},outreach_recipients(${state})`).order("created_at", { ascending: false }).order("id", { ascending: false })
    .returns<DraftCampaignSummary[]>();
  if (error) throw new Error("Could not load campaigns. Try again.");
  return { campaigns: data };
}

type OutreachTable = "outreach_recipients" | "outreach_campaigns" | "outreach_send_items" | "outreach_replies" | "system_log_events" | "airtable_syncs";

export function watchOutreach(ownerId: string, tables: readonly OutreachTable[], refresh: () => void, onConnection?: (connected: boolean) => void) {
  const client = researchClient();
  const filter = "owner_id=eq." + ownerId;
  let connected = false;
  let queued: number | undefined;
  function scheduleRefresh() {
    if (queued !== undefined) return;
    queued = window.setTimeout(() => {
      queued = undefined;
      refresh();
    }, 150);
  }
  const channel = client.channel("outreach:" + crypto.randomUUID());
  for (const table of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table, filter }, scheduleRefresh);
  }
  channel.subscribe((status) => {
    connected = status === "SUBSCRIBED";
    onConnection?.(connected);
    if (connected) scheduleRefresh();
  });
  const fallback = window.setInterval(() => { if (!connected && !document.hidden) refresh(); }, 5000);
  return () => {
    window.clearInterval(fallback);
    window.clearTimeout(queued);
    void client.removeChannel(channel);
  };
}

export type ActivityCampaign = CampaignInfo & {
  emailCount: number;
  sent: number;
  queued: number;
  sending: number;
  notSent: number;
  uncertain: number;
  replies: number;
  unread: number;
};

type ActivityCampaignRow = CampaignInfo & {
  outreach_jobs: { outreach_send_items: { status: SendStatus; outreach_replies: { read_at: string | null }[] }[] }[];
};

export async function readActivityCampaigns(): Promise<ActivityCampaign[]> {
  const { data, error } = await researchClient().from("outreach_campaigns")
    .select("id,name,created_at,outreach_jobs!inner(outreach_send_items!inner(status,outreach_replies(read_at)))")
    .order("created_at", { ascending: false }).order("id")
    .returns<ActivityCampaignRow[]>();
  if (error) throw new Error("Could not load email activity. Try again.");

  return data.flatMap(({ outreach_jobs, ...campaign }) => {
    const sends = outreach_jobs.flatMap((job) => job.outreach_send_items);
    if (!sends.length) return [];
    const replies = sends.flatMap((send) => send.outreach_replies);
    return [{
      ...campaign,
      emailCount: sends.length,
      sent: sends.filter(({ status }) => status === "sent").length,
      queued: sends.filter(({ status }) => status === "queued").length,
      sending: sends.filter(({ status }) => status === "sending").length,
      notSent: sends.filter(({ status }) => status === "not_sent").length,
      uncertain: sends.filter(({ status }) => status === "uncertain").length,
      replies: replies.length,
      unread: replies.filter(({ read_at }) => !read_at).length,
    }];
  });
}

export type Reply = {
  id: string;
  sender: string;
  message: string;
  received_at: string;
  read_at: string | null;
  outcome: Prospect["triage"] | "Do not contact" | "No interest shown";
};

export type ActivityEmail = {
  id: string;
  address: string;
  subject: string;
  message: string;
  status: SendStatus;
  failure_code: string | null;
  attempted_at: string | null;
  finished_at: string | null;
  outreach_recipients: {
    prospect_id: string;
    research_snapshot: { company: string };
    prospects: { do_not_contact: boolean; triage: Prospect["triage"] };
  };
  outreach_replies: Reply[];
};

export async function readActivityEmails(campaignId: string) {
  const { data, error } = await researchClient().from("outreach_send_items")
    .select("id,address,subject,message,status,failure_code,attempted_at,finished_at,outreach_jobs!inner(campaign_id),outreach_recipients!inner(prospect_id,research_snapshot,prospects!inner(do_not_contact,triage)),outreach_replies(id,sender,message,received_at,read_at,outcome)")
    .eq("outreach_jobs.campaign_id", campaignId)
    .order("attempted_at", { ascending: false, nullsFirst: false }).order("id")
    .order("received_at", { referencedTable: "outreach_replies" }).order("id", { referencedTable: "outreach_replies" })
    .returns<ActivityEmail[]>();
  if (error) throw new Error("Could not load campaign emails. Try again.");
  return data;
}

export type AirtableStatus = "pending" | "syncing" | "synced" | "failed";

export async function readAirtableStatus(prospectId: string) {
  const { data, error } = await researchClient().from("airtable_syncs").select("status")
    .eq("prospect_id", prospectId).or("qualified_reply_id.not.is.null,airtable_record_id.not.is.null")
    .maybeSingle<{ status: AirtableStatus }>();
  // The hosted database can lag the workspace while the Airtable migration is being applied.
  if (error?.code === "42703") return undefined;
  if (error) throw new Error("Could not load Airtable status.");
  return data?.status;
}

export type SystemLog = {
  id: string;
  source: string;
  title: string;
  detail: string;
  campaign_id: string | null;
  research_run_id: string | null;
  occurred_at: string;
  read_at: string | null;
};

export async function readSystemLogs() {
  const client = researchClient();
  const [events, unread] = await Promise.all([
    client.from("system_log_events").select("id,source,title,detail,campaign_id,research_run_id,occurred_at,read_at")
      .order("occurred_at", { ascending: false }).order("id").limit(50).returns<SystemLog[]>(),
    client.from("system_log_events").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (events.error || unread.error) throw new Error("Could not load system logs. Try again.");
  return { events: events.data, unread: unread.count ?? 0 };
}

export async function readUnreadReplies() {
  const { count, error } = await researchClient().from("outreach_replies")
    .select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) throw new Error("Could not load the unread reply count.");
  return count ?? 0;
}
