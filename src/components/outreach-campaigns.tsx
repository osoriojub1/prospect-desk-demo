"use client";

import { MailPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { campaignLimit, readCampaignAudience, startDraftCampaign } from "../lib/outreach";
import { readCompletedResearchRuns, researchConfigured } from "../lib/research";
import { campaignHref, routes } from "../lib/routes";
import { atlantaOffer, atlantaPresetId } from "../lib/search-criteria";
import { activityDate, getCampaignAudience, type CampaignFilters } from "../lib/workspace";
import { AppErrorDialog } from "./app-error-dialog";
import { useResearchSession } from "./research-session";

export function OutreachCampaigns() {
  const { session } = useResearchSession();
  if (!researchConfigured) return <p className="action-card action-content">Connect the workspace to see eligible prospects.</p>;
  return session && <CampaignSetup key={session.user.id} />;
}

function CampaignSetup() {
  const router = useRouter();
  const [searches, setSearches] = useState<Awaited<ReturnType<typeof readCompletedResearchRuns>>>();
  const [runId, setRunId] = useState("");
  const [savedAudience, setSavedAudience] = useState<Awaited<ReturnType<typeof readCampaignAudience>> & { runId: string }>();
  const [filters, setFilters] = useState<CampaignFilters>({ industry: "", location: "" });
  const [offer, setOffer] = useState("");
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<{ title: string; message: string; retry?: boolean }>();
  const [failedAudience, setFailedAudience] = useState<string>();
  const [excludedIds, setExcludedIds] = useState(() => new Set<string>());
  const [submitting, setSubmitting] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);

  const current = savedAudience?.runId === runId ? savedAudience : undefined;
  const saved = current?.prospects ?? [];
  const industries = [...new Set(saved.map((prospect) => prospect.industry))].sort();
  const locations = [...new Set(saved.map((prospect) => prospect.location))].sort();
  const campaignFilters = {
    industry: industries.includes(filters.industry) ? filters.industry : "",
    location: locations.includes(filters.location) ? filters.location : "",
  };
  const { eligible, excluded } = getCampaignAudience(saved, current?.reserved ?? new Set(), campaignFilters);
  const selected = eligible.filter(({ prospect }) => !excludedIds.has(prospect.id));
  const allSelected = selected.length === eligible.length;
  const partiallySelected = selected.length > 0 && !allSelected;
  const overLimit = selected.length > campaignLimit;
  const excludedSummary = [
    excluded.missingEmail && excluded.missingEmail + " without a published work email",
    excluded.contacted && excluded.contacted + " already contacted",
    excluded.optedOut && excluded.optedOut + " marked Do not contact",
    excluded.reserved && excluded.reserved + " in another campaign",
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  useEffect(() => {
    let active = true;
    void readCompletedResearchRuns().then((result) => {
      if (active) setSearches(result);
    }, (reason: Error) => {
      if (active) setError({ title: "Couldn’t load lead searches", message: reason.message, retry: true });
    });
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    let active = true;
    void readCampaignAudience(runId || null).then((results) => {
      if (active) {
        setSavedAudience({ ...results, runId });
        setFailedAudience(undefined);
      }
    }, (reason: Error) => {
      if (active) {
        setFailedAudience(runId);
        setError({ title: "Couldn’t load the audience", message: reason.message, retry: true });
      }
    });
    return () => { active = false; };
  }, [reload, runId]);

  function retryLoad() {
    setFailedAudience(undefined);
    setReload((value) => value + 1);
  }

  function chooseRun(id: string) {
    setRunId(id);
    setFilters({ industry: "", location: "" });
    setExcludedIds(new Set());
    const search = searches?.find((entry) => entry.id === id);
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

    const input = { name, offer: offer.trim(), ...campaignFilters, runId: runId || undefined, prospectIds: selected.map(({ prospect }) => prospect.id).sort() };
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };

    setSubmitting(true);
    try {
      const id = await startDraftCampaign({ ...input, requestId: request.current.id });
      router.push(campaignHref("review", id));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Try again in a moment.";
      setError({ title: "Couldn’t generate drafts", message });
      if (message.startsWith("The audience changed.")) setReload((value) => value + 1);
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
                <select id="campaign-search" value={runId} onChange={(event) => chooseRun(event.target.value)} disabled={!searches}>
                  <option value="">All searches</option>
                  {searches?.map((search) => (
                    <option key={search.id} value={search.id}>
                      {search.criteria.industry} · {search.criteria.location} · {activityDate.format(new Date(search.created_at))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="campaign-industry">Industry</label>
                <select id="campaign-industry" value={campaignFilters.industry} disabled={!current}
                  onChange={(event) => setFilters({ ...filters, industry: event.target.value })}>
                  <option value="">All industries</option>
                  {industries.map((industry) => <option key={industry}>{industry}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="campaign-location">Location</label>
                <select id="campaign-location" value={campaignFilters.location} disabled={!current}
                  onChange={(event) => setFilters({ ...filters, location: event.target.value })}>
                  <option value="">All locations</option>
                  {locations.map((location) => <option key={location}>{location}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <p className="audience-count" role="status">
            {!current ? (failedAudience === runId ? "Audience unavailable" : "Loading saved prospects…") :
              eligible.length ? eligible.length + " eligible " + (eligible.length === 1 ? "company" : "companies") :
                saved.length ? "No eligible companies match these filters." : "No saved companies yet."}
            {eligible.length > 0 && <span> · {selected.length} selected</span>}
          </p>
          {!current && failedAudience === runId && <button className="button button-secondary" type="button" onClick={retryLoad}>Try again</button>}
          {excludedSummary && <p className="field-hint audience-excluded">{excludedSummary}</p>}
          {current && !saved.length && !runId && <Link className="text-link" href={routes.search}>Find companies</Link>}
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
      <AppErrorDialog title={error?.title} message={error?.message ?? ""} onClose={() => setError(undefined)}
        onRetry={error?.retry ? retryLoad : undefined} />
    </div>
  );
}
