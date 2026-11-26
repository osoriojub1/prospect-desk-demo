"use client";

import { MailPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { campaignLimit, readCampaignAudience, startDraftCampaign } from "../lib/outreach";
import { researchConfigured } from "../lib/research";
import { campaignHref, routes } from "../lib/routes";
import { atlantaOffer, atlantaPresetId } from "../lib/search-criteria";
import { activityDate, getCampaignAudience, type CampaignFilters } from "../lib/workspace";
import { AppErrorDialog } from "./app-error-dialog";
import { useResearchSession } from "./research-session";
import { useOutreachSnapshot } from "./use-outreach-snapshot";

const audienceTables = ["research_runs", "outreach_recipients", "outreach_send_items", "outreach_replies"] as const;
const allCompanies: CampaignFilters = { industry: "", location: "" };

export function OutreachCampaigns() {
  const { session } = useResearchSession();
  if (!researchConfigured) return <p className="action-card action-content">Connect the workspace to see eligible prospects.</p>;
  return session && <CampaignSetup key={session.user.id} ownerId={session.user.id} />;
}

function CampaignSetup({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const [runId, setRunId] = useState("");
  const [filters, setFilters] = useState(allCompanies);
  const [offer, setOffer] = useState("");
  const [draftError, setDraftError] = useState("");
  const [dismissedLoadError, setDismissedLoadError] = useState("");
  const [excludedIds, setExcludedIds] = useState(() => new Set<string>());
  const [submitting, setSubmitting] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);

  const loadAudience = useCallback(async () => ({ ...await readCampaignAudience(runId || null), runId }), [runId]);
  const { snapshot, error: loadError, refresh } = useOutreachSnapshot(ownerId, audienceTables, loadAudience);
  const searches = snapshot?.searches ?? [];
  const runUnavailable = Boolean(runId && snapshot?.runId === runId && !searches.some((search) => search.id === runId));
  const current = !loadError && !runUnavailable && snapshot?.runId === runId ? snapshot : undefined;
  const saved = current?.prospects ?? [];
  const campaignByProspect = current?.campaignByProspect ?? new Map();
  const audience = getCampaignAudience(saved, campaignByProspect, allCompanies);
  const industries = [...new Set(audience.eligible.map(({ prospect }) => prospect.industry))].sort();
  const locations = [...new Set(audience.eligible.map(({ prospect }) => prospect.location))].sort();
  const { eligible, excluded, existingDrafts } = filters.industry || filters.location
    ? getCampaignAudience(saved, campaignByProspect, filters) : audience;
  const selected = eligible.filter(({ prospect }) => !excludedIds.has(prospect.id));
  const allSelected = selected.length === eligible.length;
  const partiallySelected = selected.length > 0 && !allSelected;
  const overLimit = selected.length > campaignLimit;
  const excludedSummary = [
    excluded.missingEmail && excluded.missingEmail + " without a published work email",
    excluded.contacted && excluded.contacted + " already contacted",
    excluded.optedOut && excluded.optedOut + " marked Do not contact",
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  function retryLoad() {
    setDismissedLoadError("");
    void refresh();
  }

  function chooseRun(id: string) {
    setRunId(id);
    setFilters(allCompanies);
    setExcludedIds(new Set());
    const search = searches.find((entry) => entry.id === id);
    if (search?.criteria.presetId === atlantaPresetId) setOffer((value) => value.trim() ? value : atlantaOffer);
  }

  function includeProspects(ids: string[], include: boolean) {
    setExcludedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (include) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || submitting || !selected.length || overLimit) return;
    const name = String(new FormData(event.currentTarget).get("campaignName") ?? "").trim();
    if (!name || !offer.trim()) return;

    const input = { name, offer: offer.trim(), ...filters, runId: runId || undefined, prospectIds: selected.map(({ prospect }) => prospect.id).sort() };
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };

    setSubmitting(true);
    try {
      const id = await startDraftCampaign({ ...input, requestId: request.current.id });
      router.push(campaignHref("review", id));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Try again in a moment.";
      setDraftError(message);
      if (message.startsWith("The audience changed.") || message.startsWith("Choose an available lead search.")) void refresh();
      setSubmitting(false);
    }
  }

  return (
    <div className="outreach-page">
      <form className="action-card audience-card" aria-label="Campaign setup" onSubmit={generate}>
        <div className="audience-body">
          <fieldset className="criteria-group" disabled={submitting}>
            <legend className="sr-only">Campaign setup</legend>
            <div className="target-fields">
              <div className="form-field">
                <label htmlFor="campaign-name">Campaign name</label>
                <input id="campaign-name" name="campaignName" type="text" pattern=".*\S.*" required maxLength={120} />
              </div>
              <div className="form-field">
                <label htmlFor="campaign-offer">Outreach offer</label>
                <input id="campaign-offer" value={offer} onChange={(event) => setOffer(event.target.value)} pattern=".*\S.*" required maxLength={500} />
              </div>
            </div>
            <div className="campaign-fields campaign-filters">
              <div className="form-field">
                <label htmlFor="campaign-search">Lead search</label>
                <select id="campaign-search" value={runId} onChange={(event) => chooseRun(event.target.value)} disabled={!searches.length || Boolean(loadError)}>
                  <option value="">{loadError ? "Searches unavailable" : !snapshot ? "Loading searches…" : searches.length ? "All searches" : "No saved searches"}</option>
                  {runUnavailable && <option value={runId} disabled>Search no longer available</option>}
                  {searches.map((search) => (
                    <option key={search.id} value={search.id}>
                      {search.criteria.industry} · {search.criteria.location} · {activityDate.format(new Date(search.created_at))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="campaign-industry">Industry</label>
                <select id="campaign-industry" value={filters.industry} disabled={!industries.length}
                  onChange={(event) => setFilters({ ...filters, industry: event.target.value })}>
                  <option value="">All industries</option>
                  {filters.industry && !industries.includes(filters.industry) && <option disabled>{filters.industry}</option>}
                  {industries.map((industry) => <option key={industry}>{industry}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="campaign-location">Location</label>
                <select id="campaign-location" value={filters.location} disabled={!locations.length}
                  onChange={(event) => setFilters({ ...filters, location: event.target.value })}>
                  <option value="">All locations</option>
                  {filters.location && !locations.includes(filters.location) && <option disabled>{filters.location}</option>}
                  {locations.map((location) => <option key={location}>{location}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <p className="audience-count" role="status">
            {loadError ? "Audience unavailable" : runUnavailable ? "This search is no longer available." : !current ? "Loading saved prospects…" :
              eligible.length ? eligible.length + " eligible " + (eligible.length === 1 ? "company" : "companies") :
                audience.eligible.length ? "No eligible companies match these filters." : "No companies available for new drafts."}
            {eligible.length > 0 && <span> · {selected.length} selected</span>}
          </p>
          {loadError && <button className="button button-secondary" type="button" onClick={retryLoad}>Try again</button>}
          {excludedSummary && <p className="field-hint audience-excluded">{excludedSummary}</p>}
          {existingDrafts.map(({ campaign, count }) => (
            <p className="field-hint audience-excluded" key={campaign.id}>
              {count} {count === 1 ? "company" : "companies"} in{" "}
              <Link className="text-link" href={campaignHref("review", campaign.id)}>
                {campaign.name} · {activityDate.format(new Date(campaign.created_at))}
              </Link>
            </p>
          ))}
          {(current || runUnavailable) && !audience.eligible.length && !audience.existingDrafts.length && !loadError &&
            <Link className="text-link" href={routes.search}>Find companies</Link>}
          {eligible.length > 0 && (
            <div className="table-scroll audience-roster" role="region" aria-labelledby="audience-caption" tabIndex={0}>
              <table className="outreach-table audience-table">
                <caption className="sr-only" id="audience-caption">Eligible companies</caption>
                <thead>
                  <tr>
                    <th scope="col" className="audience-select-cell">
                      <label className="audience-check">
                        <input type="checkbox" ref={selectAll} checked={allSelected} disabled={submitting}
                          onChange={(event) => includeProspects(eligible.map(({ prospect }) => prospect.id), event.target.checked)} />
                        <span className="sr-only">Select all eligible companies</span>
                      </label>
                    </th>
                    <th scope="col">Company</th>
                    <th scope="col">Industry</th>
                    <th scope="col">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {eligible.map(({ prospect }) => (
                    <tr key={prospect.id}>
                      <td className="audience-select-cell">
                        <label className="audience-check">
                          <input type="checkbox" checked={!excludedIds.has(prospect.id)} disabled={submitting}
                            onChange={(event) => includeProspects([prospect.id], event.target.checked)} />
                          <span className="sr-only">Include {prospect.name}</span>
                        </label>
                      </td>
                      <th scope="row">{prospect.name}</th>
                      <td>{prospect.industry}</td>
                      <td>{prospect.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <footer className="action-footer audience-footer">
          <p className="field-hint" id="draft-generation-status" role="status">
            {overLimit ? "Select up to " + campaignLimit + " companies." : ""}
          </p>
          <button type="submit" className="button button-primary" aria-describedby={overLimit ? "draft-generation-status" : undefined} disabled={submitting || !selected.length || overLimit}>
            <MailPlus size={16} aria-hidden="true" />
            {submitting ? "Generating drafts…" : selected.length ? "Generate " + selected.length + (selected.length === 1 ? " draft" : " drafts") : "Generate drafts"}
          </button>
        </footer>
      </form>
      <AppErrorDialog title={draftError ? "Couldn’t generate drafts" : "Couldn’t load the audience"}
        message={draftError || (loadError === dismissedLoadError ? "" : loadError)}
        onClose={() => { if (draftError) setDraftError(""); else setDismissedLoadError(loadError); }}
        onRetry={draftError ? undefined : retryLoad} />
    </div>
  );
}
