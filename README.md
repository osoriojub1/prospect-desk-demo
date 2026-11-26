# Prospect Desk

Prospect Desk is a desktop workspace for lead research and email outreach. Sales teams can find companies, review the evidence behind personalized drafts, and follow interested replies in Airtable.

## Demo workflow

1. Search by industry, location, and qualification criteria. Follow the search as results arrive.
2. Review companies, contacts, and source evidence. Select recipients and define an offer in Campaigns.
3. Edit or regenerate personalized drafts alongside their source summaries. Approve the drafts you want to send and confirm the batch.
4. Follow delivery status and Gmail replies in Email Activity. A qualifying reply creates an Airtable lead with a contact name when available, the company domain, and notes. System Logs records workflow failures.

## How it works

Next.js serves the desktop app. Hosted Supabase handles sign-in, lead and campaign data, Edge Functions, and live status updates. n8n Cloud coordinates Firecrawl research, OpenAI drafting and reply classification, Gmail, and Airtable.

## Run locally

Use Node.js 20.9 or newer. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key. The demo uses an account created in Supabase Auth.

```sh
npm ci
npm run dev
```

Open the workspace in a desktop browser. [Local app](http://127.0.0.1:3000)

## Integration setup

1. Apply the Supabase migrations and deploy the `lead-research` and `outreach` Edge Functions.
2. Copy `n8n/workflows.env.example` to `n8n/workflows.env`. Set the Supabase project URL and, for Airtable sync, the base and table IDs. Generate the import files with the command below.

   ```sh
   node --env-file=n8n/workflows.env n8n/prepare-imports.mjs
   ```

3. Import the inactive workflows from `output/n8n-imports/`. If Airtable sync is new, import it first, set `PROSPECT_DESK_AIRTABLE_SYNC_WORKFLOW_ID` to its n8n workflow ID, and regenerate the files before importing reply detection.
4. Attach the worker, Firecrawl, OpenAI, Gmail, and Airtable credentials in n8n. Confirm the Airtable match column is `Lead ID` and select System Logs as the error workflow.
5. Publish the workflows and configure their production webhook URLs and worker keys in Supabase Edge Function secrets.

- [n8n workflow templates](n8n/)
- [Supabase migrations](supabase/migrations/)
- [Supabase Edge Functions](supabase/functions/)
