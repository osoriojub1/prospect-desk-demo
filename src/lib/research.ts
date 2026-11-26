import { createClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import type { EmailKind, Prospect, SearchCriteria, SourceEvidence } from "./prospects";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const researchConfigured = Boolean(projectUrl && publicKey);
let browserClient: SupabaseClient | undefined;

export function researchClient() {
  if (!projectUrl || !publicKey) throw new Error("Connect the hosted research workspace first.");
  browserClient ??= createClient(projectUrl, publicKey);
  return browserClient;
}

export type RunStatus = "queued" | "researching" | "validating" | "completed" | "failed";
export type ResearchRun = {
  id: string;
  criteria: SearchCriteria;
  status: RunStatus;
  failure_code: string | null;
  result_count: number;
  contact_count: number;
  email_count: number;
  created_at: string;
  started_at: string | null;
  last_checked_at: string | null;
  finished_at: string | null;
};

const runFields = "id,criteria,status,failure_code,result_count,contact_count,email_count,created_at,started_at,last_checked_at,finished_at";
const runPageSize = 10;
const runIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const runStatusLabels: Record<RunStatus, string> = {
  queued: "Queued",
  researching: "Researching",
  validating: "Checking results",
  completed: "Complete",
  failed: "Failed",
};

export type ResearchRunListItem = Pick<ResearchRun, "id" | "criteria" | "status" | "result_count" | "created_at">;

export function isResearchRunId(id: string) {
  return runIdPattern.test(id);
}

export function isActiveResearchRun(status: RunStatus) {
  return status !== "completed" && status !== "failed";
}

export function researchRunStatusLabel(run: Pick<ResearchRun, "status" | "result_count">) {
  return run.status === "completed" && run.result_count === 0 ? "No matches" : runStatusLabels[run.status];
}

const failures: Record<string, { source: string; detail: string }> = {
  workflow_unconfigured: { source: "n8n", detail: "Connect the n8n Cloud workflow to start research." },
  workflow_dispatch: { source: "n8n", detail: "The research workflow did not start." },
  workflow_timeout: { source: "n8n", detail: "The research workflow stopped reporting progress." },
  firecrawl_start: { source: "Firecrawl", detail: "Firecrawl could not start the search." },
  firecrawl_status: { source: "Firecrawl", detail: "Firecrawl did not return a search status." },
  firecrawl_failed: { source: "Firecrawl", detail: "Firecrawl stopped the search before completion." },
  firecrawl_credit_limit: { source: "Firecrawl", detail: "The search reached its Firecrawl credit limit." },
  firecrawl_timeout: { source: "Firecrawl", detail: "The search exceeded the research time limit." },
  invalid_results: { source: "Firecrawl", detail: "The search returned results in an unexpected format." },
  save_failed: { source: "Supabase", detail: "The workflow could not save the results." },
};

export function researchFailure(code: string | null) {
  return failures[code ?? ""] ?? { source: "n8n", detail: "Lead research could not finish." };
}

export async function startResearch(input: { requestId: string; criteria: SearchCriteria } | { requestId: string; retryOf: string }) {
  const { data, error } = await researchClient().functions.invoke<{ runId: string }>("lead-research", {
    body: { action: "start", ...input },
  });
  if (error instanceof FunctionsHttpError) {
    const response = await error.context.json().catch(() => null);
    if (typeof response?.error === "string") throw new Error(response.error);
  }
  if (error || !data?.runId) throw new Error("Could not start lead research. Try again.");
  return data.runId;
}

export async function readResearchRun(id: string) {
  const { data, error } = await researchClient().from("research_runs").select(runFields).eq("id", id)
    .maybeSingle<ResearchRun>();
  if (error) throw new Error("Could not load the lead run. Try again.");
  return data;
}

export async function readResearchRuns(page: number) {
  const start = page * runPageSize;
  const { data, error } = await researchClient().from("research_runs")
    .select("id,criteria,status,result_count,created_at")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(start, start + runPageSize).returns<ResearchRunListItem[]>();
  if (error) throw new Error("Could not load lead runs. Try again.");
  return { runs: data.slice(0, runPageSize), hasMore: data.length > runPageSize };
}

export async function readCompletedResearchRuns() {
  const { data, error } = await researchClient().from("research_runs")
    .select("id,criteria,created_at").eq("status", "completed").gt("result_count", 0)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .returns<Pick<ResearchRun, "id" | "criteria" | "created_at">[]>();
  if (error) throw new Error("Could not load lead searches. Try again.");
  return data;
}

export function watchResearchRuns(filter: string, refresh: () => void, onConnection: (live: boolean) => void) {
  const client = researchClient();
  const channel = client.channel(`research-runs:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "research_runs", filter }, refresh)
    .subscribe((status) => {
      const live = status === "SUBSCRIBED";
      onConnection(live);
      if (live) refresh();
    });
  return () => { void client.removeChannel(channel); };
}

type ResearchResult = {
  industry: string;
  location: string;
  fit: Prospect["fit"];
  rationale: string;
  evidence: SourceEvidence[];
  matched_signals: string[];
  contact: ({ name: string; title: string } & SourceEvidence) | null;
  contact_email: string | null;
  email_kind: EmailKind | null;
  email_evidence: SourceEvidence | null;
  prospects: {
    id: string;
    name: string;
    domain: string;
    stage: Prospect["stage"];
    contacted_at: string | null;
    replied_at: string | null;
    triage: Prospect["triage"];
    do_not_contact: boolean;
  };
};

export async function readResearchProspects(runId: string | null) {
  const query = researchClient().from("run_prospects").select(`
    industry,location,fit,rationale,evidence,matched_signals,contact,contact_email,email_kind,email_evidence,
    prospects!inner(id,name,domain,stage,contacted_at,replied_at,triage,do_not_contact)
  `).order("recorded_at", { ascending: false }).order("prospect_id").order("run_id", { ascending: false });
  if (runId) query.eq("run_id", runId);
  const { data, error } = await query.returns<ResearchResult[]>();
  if (error) throw new Error("Could not load the saved prospects. Try again.");

  const saved = new Map<string, Prospect>();
  for (const row of data) {
    const { id, name, domain, stage, contacted_at, replied_at, triage, do_not_contact } = row.prospects;
    if (saved.has(id)) continue;
    const contact = row.contact && {
      name: row.contact.name,
      title: row.contact.title,
      source: { url: row.contact.url, excerpt: row.contact.excerpt },
    };
    saved.set(id, {
      id, name, domain, stage, triage,
      contactedAt: contacted_at,
      repliedAt: replied_at,
      doNotContact: do_not_contact,
      initials: name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
      tone: "mint",
      industry: row.industry,
      location: row.location,
      fit: row.fit,
      rationale: row.rationale,
      excerpt: row.evidence[0].excerpt,
      sources: row.evidence,
      contact: contact ?? undefined,
      contactEmail: row.contact_email,
      emailKind: row.contact_email ? row.email_kind ?? "unattributed" : undefined,
      emailEvidence: row.email_evidence ?? undefined,
      signals: row.matched_signals,
    });
  }
  return [...saved.values()];
}
