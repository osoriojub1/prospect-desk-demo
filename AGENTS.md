# Lead Gen project rules

## Project preferences

When the user points out a project preference, record it in this file as part of the current task. Add it under the relevant heading or update the existing rule when the user refines it. Apply the saved rules to future work in Lead Gen.

- Check incoming requests against the active project before starting work. If a request appears meant for a different project, flag the mismatch before looking up that project's files or backlog. Proceed when the user explicitly asks to switch projects or work across them.
- Use the project owner's verified personal GitHub account for Prospect Desk. Set the commit identity for this repository only.
- Use concise, product-focused commit subjects.
- Use browser skills for browser work. Keep native desktop mouse and keyboard control with the user.
- Keep `AGENTS.md` and `README.md` at the repository root. Keep internal Markdown under `docs/` and ignore it in Git.
- Use generic labels for clients and account identities in shared project rules.

## Frontend workflow

- Design and verify this web app for desktop use only.
- Use Modern Web Guidance when building or revising the web UI.
- Use a persistent, collapsible sidebar with actions grouped in workflow order. Keep the navigation available as an icon rail when collapsed.
- Give campaign setup, draft review, email activity, and system logs separate pages. Put back navigation on the left.
- Show concurrent lead searches in a live run list. Open an individual run for its progress and saved criteria. Adjust Search should prefill an editable copy of that run's full configuration.
- Show saved workspace records and use empty states when there are no records to display.
- Render scraped source evidence as Markdown in the prospect preview and source dialog.
- Show a compact source summary by default in Draft Review. Open the full evidence through **View full sources**.

## Automation workflow

- Keep Prospect Review read-only. Show qualification, evidence, and outcomes there.
- Personalize lead-generation controls around the client's target buyers, the evidence that makes them a fit, and the people the operator wants to reach.
- Use free-text fields for industry and location in Search Setup. Start both fields and Custom signals blank. Omit Existing clients from the preset exclusions.
- Let users configure lead signals and exclusions. Automate research and qualification, and save leads for campaigns. Extract the available founder, CEO, or contact name and title with supporting evidence. Use that contact to personalize outreach.
- Apply exclusions during Firecrawl discovery before counting companies toward the requested lead total. Have the same search replace excluded candidates within its budget, then save up to the requested number after n8n validates the evidence.
- Let campaigns filter saved leads by business category and location. Automatically exclude previously contacted leads, replies, and opt-outs from draft generation.
- Let users name each campaign, see which companies match, and select its recipients. Generate drafts only for the selected eligible companies.
- List the named campaigns in Draft Review. Show the business and contact without an avatar or recipient line. Let users regenerate the selected draft in place and explicitly approve each draft. Editing or regenerating clears that draft's approval. Send only approved drafts in one batch after confirmation.
- Keep skipped drafts in their campaign history and make their uncontacted prospects eligible for other campaigns. Carry that rule into the backend.
- Start Email Activity with the same campaign table pattern as Draft Review. Within a campaign, use a paginated campaign list, per-email delivery statuses, and an unread reply indicator. Open each thread to show the outreach and inbound replies together.
- Include System Logs in the backend scope for discovery and outreach. Show relevant workflow and infrastructure failures and indicate new events in the sidebar. Present app action and view errors in dialogs.
- Confirmed delivery updates each lead. Use a dedicated n8n Gmail Trigger workflow to detect outreach replies. Keep reply triage and Do not contact in Prospect Desk.
- Send a lead to Airtable only after its reply expresses interest in the offer or explicitly invites follow-up. Use the native n8n Airtable node. Populate Contact from the qualifying draft's saved research whenever a name is available, including for shared inboxes. Save the company Domain and Notes with the outreach offer, research summary, and qualifying reply. Keep Stage manually managed and hide the stable Lead ID used to match retries.
- Keep Airtable sync in a dedicated n8n sub-workflow. Gmail reply detection hands off qualified leads after saving triage. Retry saved syncs through a webhook called by the outreach Edge Function.
- Use an Airtable Kanban view called Pipeline as the primary CRM view. Stack cards by the existing Stage field and move cards between columns to update Stage. Use Company as the card title and show Contact and Email.
- Generate drafts, submit reviews, and send approved emails in batches to minimize n8n triggers.

## Backend workflow

- Run the demo frontend on localhost with `npm run dev`. Revisit Vercel after the client demo.
- Use hosted Supabase for Auth, RLS, data, REST reads, Edge Functions, asynchronous job handoff, and Realtime. Use n8n Cloud for automation and third-party integrations. Store importable workflow JSON in `n8n/`.
- Assign lead searches, campaigns, and draft jobs to the signed-in workspace account. Resolve n8n job callbacks from saved job ownership.
- Keep deployed Edge Function source in `supabase/functions/` and update the project’s `n8n/` exports whenever the live workflows change.
- Reuse existing workflow patterns when available. Keep MVP drafting and delivery as direct workflows for the actions in Prospect Desk.
- Use native n8n AI nodes for outreach drafts and reply triage. Start with a low-cost model suited to short copy and classification.
- Use the published workflows as the source for checked-in n8n exports. Keep credentials and pinned execution data out of the files. Prepare imports with values from the ignored `n8n/workflows.env` file. Attach credentials and link imported workflows in the target personal workspace.
- Run discovery and contact extraction in n8n. Call Firecrawl `/agent` through the HTTP Request node so the workflow can set the API parameters directly. Keep Alexandria optional for contact gaps.
- Open a dedicated Lead Run Status page when Generate Leads starts. Show the saved stage, last provider check, and outcome through a Supabase Realtime subscription.
- Keep the first backend milestone focused on saving a discovery run, processing it asynchronously, and displaying sourced companies and contacts through Realtime.

## Client demo

- Use a dedicated email and password sign-in page for the hosted demo. Create demo users in the Supabase Auth dashboard and direct them to the workspace after sign-in.

Use available client research from the local planning notes to ground Firecrawl discovery, evidence review, and the CRM handoff.

## UI copy

- Keep visible copy short and useful: labels, validation, status, and consequences users need before acting.
- Skip redundant headings, subtitles, and explanations that repeat what the controls already say. Put developer-only context in a nearby code comment.
- Keep accessible names and essential warnings, errors, and instructions.
- Use language a nontechnical sales operator can act on. Use visible status indicators and purposeful motion to communicate the progress and outcome of automated work.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
