import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const integrationOwner = Deno.env.get("OUTREACH_OWNER_ID")?.trim().toLowerCase();
const mailbox = Deno.env.get("OUTREACH_GMAIL_ADDRESS")?.trim().toLowerCase();
const workerKey = Deno.env.get("N8N_OUTREACH_WORKER_KEY") ?? "";
const draftWebhook = Deno.env.get("N8N_OUTREACH_DRAFT_WEBHOOK_URL") ?? "";
const sendWebhook = Deno.env.get("N8N_OUTREACH_SEND_WEBHOOK_URL") ?? "";
const airtableRetryWebhook = Deno.env.get("N8N_OUTREACH_AIRTABLE_RETRY_WEBHOOK_URL") ?? "";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const userActions = new Set(["create_campaign", "regenerate", "queue_send", "edit_draft", "approve_draft", "skip_draft", "read_replies", "read_logs", "retry_airtable_sync"]);
const integrationUserActions = new Set(["queue_send", "retry_airtable_sync"]);
const queueActions = new Set(["create_campaign", "regenerate", "queue_send"]);
const jobActions = new Set(["claim_job", "record_draft", "claim_send", "record_send", "finish_job"]);
const jobWorkflowKinds = new Map([
  ["Prospect Desk - Draft outreach", "draft"],
  ["Prospect Desk - Send outreach", "send"],
]);
const airtableActions = new Set(["claim_airtable_sync", "record_airtable_sync"]);
const airtableErrors = new Set([
  "airtable_access", "airtable_target", "airtable_fields", "airtable_rate_limit", "airtable_unconfirmed",
]);
const workerActions = new Set([...jobActions, ...airtableActions, "match_reply", "record_reply", "triage_reply", "report_error"]);

function json(body: object, status = 200) {
  return Response.json(body, { headers, status });
}

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function workflowErrorOwner(workflow: unknown, executionId: unknown) {
  if (typeof workflow !== "string" || !text(executionId, 100)) return;
  const kind = jobWorkflowKinds.get(workflow);
  if (!kind && workflow !== "Prospect Desk - Lead discovery") return;

  const lookup = admin.from(kind ? "outreach_jobs" : "research_runs").select("owner_id").eq("execution_id", executionId);
  const { data, error } = await (kind ? lookup.eq("kind", kind) : lookup)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.owner_id;
}

function validWorkerInput(action: string, body: Record<string, unknown>) {
  if (airtableActions.has(action)) {
    if (!text(body.executionId, 100)) return false;
    if (action === "claim_airtable_sync") return typeof body.retryFailed === "boolean";
    const results = body.results;
    if (!Array.isArray(results) || results.length < 1 || results.length > 10) return false;
    return results.every((item) => isRecord(item) && isUuid(item.prospectId) &&
      typeof item.revision === "number" && Number.isInteger(item.revision) && item.revision > 0 && item.revision <= 2_147_483_647 &&
      (typeof item.recordId === "string" && /^rec[A-Za-z0-9]{14}$/.test(item.recordId) && item.errorCode === undefined ||
        item.recordId === undefined && typeof item.errorCode === "string" && airtableErrors.has(item.errorCode))) &&
      new Set(results.map((item) => item.prospectId)).size === results.length;
  }
  if (jobActions.has(action) && (!isUuid(body.jobId) || !text(body.executionId, 100))) return false;
  if (action === "claim_job") return body.kind === "draft" || body.kind === "send";
  if (action === "record_draft") {
    return isUuid(body.recipientId) && Number.isInteger(body.revision) &&
      (body.outcome === "failed" || (body.outcome === "ready" && text(body.subject, 160) && text(body.message, 8000)));
  }
  if (action === "claim_send") return isUuid(body.sendItemId);
  if (action === "record_send") {
    return isUuid(body.sendItemId) && (body.outcome === "not_sent" || body.outcome === "uncertain" ||
      (body.outcome === "sent" && text(body.messageId, 150) && text(body.threadId, 150)));
  }
  if (action === "match_reply" || action === "record_reply") {
    if (!text(body.messageId, 150) || !text(body.threadId, 150) || !text(body.sender, 254)) return false;
    return action === "match_reply" || (isUuid(body.sendItemId) && text(body.message, 12000) &&
      text(body.receivedAt, 40) && Number.isFinite(Date.parse(body.receivedAt)));
  }
  if (action === "triage_reply") return isUuid(body.replyId) && text(body.outcome, 30);
  if (action === "report_error") return text(body.workflow, 100) &&
    (body.executionId === null || text(body.executionId, 100)) && text(body.occurredAt, 40);
  return action === "finish_job";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers, status: 204 });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.action !== "string") return json({ error: "Invalid outreach request." }, 400);
  const { action, ...input } = body;
  const fromWorkflow = workerActions.has(action);
  if (!fromWorkflow && !userActions.has(action)) return json({ error: "Unknown outreach action." }, 400);
  let owner = integrationOwner;

  if (fromWorkflow) {
    if (!workerKey || request.headers.get("x-outreach-key") !== workerKey) {
      return json({ error: "Unauthorized workflow request." }, 401);
    }
    if (!validWorkerInput(action, input)) return json({ error: "Invalid workflow data." }, 400);
  } else {
    const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json({ error: "Sign in to use outreach." }, 401);
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user || user.is_anonymous) return json({ error: "Sign in to use outreach." }, 401);
    owner = user.id;
    if (integrationUserActions.has(action)) {
      if (!isUuid(integrationOwner)) return json({ error: "Configure the outreach account first." }, 503);
      if (owner !== integrationOwner) return json({ error: "Connect outreach to this workspace account first." }, 403);
    }
    if (action === "create_campaign" &&
      ((input.offer !== undefined && !text(input.offer, 500)) || (input.runId != null && !isUuid(input.runId)))) {
      return json({ error: "Check the outreach offer and lead search." }, 400);
    }
  }

  if (["queue_send", "match_reply", "record_reply"].includes(action) &&
      (!mailbox || !/^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(mailbox))) {
    return json({ error: "Connect the Gmail mailbox first." }, 503);
  }

  try {
    if (fromWorkflow && jobActions.has(action)) {
      const { data: job, error } = await admin.from("outreach_jobs").select("owner_id,kind").eq("id", input.jobId).maybeSingle();
      if (error) throw error;
      if (!job) return json({ error: "This outreach action is unavailable." }, 409);
      if (job.kind === "send" && (action === "claim_job" || action === "claim_send") && job.owner_id !== integrationOwner) {
        return json({ error: "This account is no longer connected for sending." }, 403);
      }
      owner = job.owner_id;
    } else if (fromWorkflow && action === "report_error") {
      owner = await workflowErrorOwner(input.workflow, input.executionId) ?? owner;
    }
    if (!isUuid(owner)) return json({ error: "Configure the outreach account first." }, 503);

    const fields = { p_owner: owner, p_action: action, p_data: input, p_mailbox: mailbox ?? null };
    if (action === "retry_airtable_sync") {
      if (!airtableRetryWebhook || !workerKey) return json({ error: "Connect the Airtable retry workflow first." }, 503);
      const receipt = await fetch(airtableRetryWebhook, {
        method: "POST",
        headers: { "content-type": "application/json", "x-outreach-key": workerKey },
        body: "{}",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (receipt?.ok) return json({ queued: true }, 202);

      console.error("Airtable retry dispatch failed", receipt?.status ?? "request_failed");
      const { error: logError } = await admin.rpc("outreach_worker_action", {
        ...fields,
        p_action: "report_error",
        p_data: { workflow: "Prospect Desk - Sync Airtable leads", executionId: null, occurredAt: new Date().toISOString() },
      });
      if (logError) console.error("Could not record Airtable retry failure", logError.code);
      return json({ error: "Could not start Airtable retry." }, 502);
    }
    const { data, error } = airtableActions.has(action)
      ? await admin.rpc("outreach_airtable_action", { p_owner: owner, p_action: action, p_data: input })
      : fromWorkflow ? await admin.rpc("outreach_worker_action", fields) : await admin.rpc("outreach_user_action", {
        ...fields,
        p_webhook_url: action === "queue_send" ? sendWebhook : draftWebhook,
        p_worker_key: workerKey,
      });
    if (error) {
      if (error.code === "22023") return json({ error: error.message }, 400);
      if (error.code === "22P02") return json({ error: "Invalid outreach data." }, 400);
      console.error("Outreach request failed", action, error.code);
      return json({ error: "Could not complete the outreach request." }, 500);
    }
    if (!data) return json({ error: "This outreach action is unavailable." }, 409);
    return json(data, queueActions.has(action) ? 202 : 200);
  } catch (error) {
    console.error("Outreach request failed", action, error instanceof Error ? error.name : "Unknown error");
    return json({ error: "Could not complete the outreach request." }, 500);
  }
});
