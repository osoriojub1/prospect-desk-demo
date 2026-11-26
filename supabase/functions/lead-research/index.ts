import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const webhookUrl = Deno.env.get("N8N_LEAD_RESEARCH_WEBHOOK_URL") ?? "";
const workerKey = Deno.env.get("N8N_RESEARCH_WORKER_KEY") ?? "";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const resultLimits = [1, 2, 3, 4, 5, 10, 25, 50];
const failureCodes = new Set([
  "firecrawl_start", "firecrawl_status", "firecrawl_failed", "firecrawl_credit_limit", "firecrawl_timeout", "invalid_results", "save_failed",
]);

function json(body: object, status = 200) {
  return Response.json(body, { headers, status });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function textList(value: unknown) {
  return Array.isArray(value) && value.length <= 15 && value.every((item) => boundedText(item, 120));
}

function searchCriteria(value: unknown) {
  if (!record(value)) return null;
  const { industry, location, limit, minimumFit, signals, customSignals, signalRule, exclusions, excludedDomains, excludedKeywords } = value;
  if (!boundedText(industry, 120) || !industry.trim() || !boundedText(location, 120) || !location.trim() ||
    typeof limit !== "number" || !resultLimits.includes(limit) ||
    !["Any fit", "Possible match", "Match"].some((fit) => fit === minimumFit) ||
    !["Prioritize matches", "Require any signal", "Require all signals"].some((rule) => rule === signalRule) ||
    !textList(signals) || !textList(exclusions) ||
    !boundedText(customSignals, 2000) || !boundedText(excludedDomains, 2000) || !boundedText(excludedKeywords, 2000)) {
    return null;
  }

  const base = { industry, location, limit, minimumFit, signals, customSignals, signalRule, exclusions, excludedDomains, excludedKeywords };
  const { presetId, requiredSignals, preferredSignals, requiredSignalMode, contactRoles } = value;
  if ([presetId, requiredSignals, preferredSignals, requiredSignalMode, contactRoles].every((field) => field === undefined)) return base;
  if ((presetId !== undefined && presetId !== "atlanta-property-managers") ||
      !boundedText(requiredSignals, 2000) || !boundedText(preferredSignals, 2000) ||
      (requiredSignalMode !== "all" && requiredSignalMode !== "any") || !boundedText(contactRoles, 750)) return null;
  return { ...base, presetId, requiredSignals, preferredSignals, requiredSignalMode, contactRoles };
}

async function startRun(request: Request, body: Record<string, unknown>) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json({ error: "Sign in to generate leads." }, 401);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user || user.is_anonymous) return json({ error: "Sign in to generate leads." }, 401);

  const { requestId, retryOf } = body;
  const criteria = retryOf ? null : searchCriteria(body.criteria);
  if (!isUuid(requestId) || (retryOf ? !isUuid(retryOf) : !criteria)) {
    return json({ error: "Check the search criteria and try again." }, 400);
  }

  const { data, error } = await admin.rpc("create_research_run", {
    p_owner_id: user.id,
    p_request_id: requestId,
    p_criteria: criteria,
    p_retry_of: retryOf ?? null,
    p_webhook_url: webhookUrl,
    p_worker_key: workerKey,
  });
  if (error) {
    console.error("Could not create research run", error.code);
    return json({ error: "Could not start lead research. Try again." }, 500);
  }
  if (!data) return json({ error: "This run is unavailable for retry." }, 409);
  return json({ runId: data }, 202);
}

async function updateRun(request: Request, body: Record<string, unknown>) {
  if (!workerKey || request.headers.get("x-research-key") !== workerKey) {
    return json({ error: "Unauthorized workflow request." }, 401);
  }

  const { action, runId, executionId } = body;
  if (!isUuid(runId) || !boundedText(executionId, 100) || !executionId.length) {
    return json({ error: "Invalid run or execution ID." }, 400);
  }

  const identity = { p_run_id: runId, p_execution_id: executionId };
  if (action === "claim") {
    const { data, error } = await admin.rpc("claim_research_run", identity);
    if (error) {
      console.error("Could not claim research run", error.code);
      return json({ error: "Could not claim research run." }, 500);
    }
    return json(data ? { claimed: true, ...data } : { claimed: false });
  }

  if (action === "report") {
    const { status, providerJobId, failureCode, polled } = body;
    if ((status !== "researching" && status !== "validating" && status !== "failed") ||
      (providerJobId != null && (!boundedText(providerJobId, 150) || !providerJobId.length)) ||
      (status === "failed" && (typeof failureCode !== "string" || !failureCodes.has(failureCode)))) {
      return json({ error: "Invalid run status update." }, 400);
    }

    const { data, error } = await admin.rpc("report_research_run", {
      ...identity,
      p_status: status,
      p_provider_job_id: providerJobId ?? null,
      p_polled: polled === true,
      p_failure_code: failureCode ?? null,
    });
    if (error) {
      console.error("Could not report research status", error.code);
      return json({ error: "Could not update research status." }, 500);
    }
    return data ? json({ updated: true, providerJobId: providerJobId ?? null, failureCode: failureCode ?? null }) :
      json({ error: "This execution no longer owns the run." }, 409);
  }

  if (action === "complete") {
    if (!Array.isArray(body.matches) || body.matches.length > 50) return json({ error: "Invalid results." }, 400);
    const { data, error } = await admin.rpc("complete_research_run", { ...identity, p_matches: body.matches });
    if (error) {
      console.error("Could not save research results", error.code);
      return json({ error: "Could not save research results." }, 500);
    }
    return data ? json({ updated: true }) : json({ error: "This execution no longer owns the run." }, 409);
  }

  return json({ error: "Unknown research action." }, 400);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers, status: 204 });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  const body: unknown = await request.json().catch(() => null);
  if (!record(body)) return json({ error: "Invalid request." }, 400);

  try {
    return await (body.action === "start" ? startRun(request, body) : updateRun(request, body));
  } catch (error) {
    console.error("Lead research request failed", error instanceof Error ? error.name : "Unknown error");
    return json({ error: "Lead research is unavailable. Try again." }, 500);
  }
});
