"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsUpDown, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { stages, type Prospect } from "../lib/prospects";
import { readResearchProspects, researchConfigured } from "../lib/research";
import { researchHref } from "../lib/routes";
import { AppErrorDialog } from "./app-error-dialog";
import { CompanyMark, ContactFlag, FitLabel, ProspectReview, StageBadge, TriageBadge } from "./prospect-review";
import { useResearchSession } from "./research-session";
import { SourceDialog } from "./source-dialog";

const pageSize = 8;
const stageFilters = ["All prospects", ...stages] as const;
const companyOrder = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });

type StageFilter = (typeof stageFilters)[number];
type Sort = "ascending" | "descending";

export function ProspectWorkspace() {
  const runId = useSearchParams().get("run");
  const { session } = useResearchSession();

  if (!researchConfigured) return <p className="action-card action-content">Connect the hosted research workspace to see prospects.</p>;
  return session && <LiveProspects key={`${session.user.id}/${runId ?? "all"}`} runId={runId} />;
}

function LiveProspects({ runId }: { runId: string | null }) {
  const [prospects, setProspects] = useState<Prospect[]>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void readResearchProspects(runId).then((results) => {
      if (!cancelled) setProspects(results);
    }, (error: Error) => {
      if (!cancelled) {
        setLoadFailed(true);
        setError(error.message);
      }
    });
    return () => { cancelled = true; };
  }, [runId, reload]);

  return (
    <>
      {runId && <div className="lead-run-nav"><Link className="text-link" href={researchHref("runStatus", runId)}><ArrowLeft size={16} aria-hidden="true" />Lead run status</Link></div>}
      {prospects ? (
        <ProspectList prospects={prospects} selectedId={selectedId} onSelect={setSelectedId} />
      ) : (
        <div className="action-card action-content lead-run-placeholder">
          {loadFailed ? <button className="button button-secondary" type="button" onClick={() => { setLoadFailed(false); setReload(reload + 1); }}>Try again</button> : <p role="status">Loading prospects…</p>}
        </div>
      )}
      <AppErrorDialog title="Couldn’t load prospects" message={error} onClose={() => setError("")}
        onRetry={() => { setLoadFailed(false); setReload(reload + 1); }} />
    </>
  );
}

function ProspectList({ prospects, selectedId, onSelect }: {
  prospects: Prospect[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [stage, setStage] = useState<StageFilter>("All prospects");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>();
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<Prospect | null>(null);
  const [notice, setNotice] = useState("");

  const selected = prospects.find((prospect) => prospect.id === selectedId);
  const searchText = query.trim().toLowerCase();
  const matches = prospects.filter((prospect) => {
    const matchesStage = stage === "All prospects" || prospect.stage === stage;
    const matchesQuery = [prospect.name, prospect.domain, prospect.location]
      .some((value) => value.toLowerCase().includes(searchText));
    return matchesStage && matchesQuery;
  });

  if (sort) {
    const direction = sort === "ascending" ? 1 : -1;
    matches.sort((a, b) => direction * companyOrder.compare(a.name, b.name));
  }

  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * pageSize;
  const visibleProspects = matches.slice(offset, offset + pageSize);

  function closeReview() {
    const focusTarget = document.querySelector(".company-button[aria-current='true']") ??
      document.getElementById("prospect-search");
    onSelect(null);
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
  }

  function filterStage(value: StageFilter) {
    setStage(value);
    setPage(1);
  }

  function sortCompanies() {
    const direction = sort === "ascending" ? "descending" : "ascending";
    setSort(direction);
    setPage(1);
    setNotice(`Company sorted ${direction}`);
  }

  return (
    <>
      <div className={selected ? "workspace-grid has-review" : "workspace-grid"}>
        <section className="lead-list">
          <div className="list-toolbar">
            <div className="stage-filters" role="group" aria-label="Lead stage">
              {stageFilters.map((value) => {
                const count = value === "All prospects"
                  ? prospects.length
                  : prospects.filter((prospect) => prospect.stage === value).length;
                return (
                  <button
                    className="stage-filter"
                    key={value}
                    type="button"
                    aria-pressed={stage === value}
                    onClick={() => filterStage(value)}
                  >
                    {value}
                    <span className="filter-count">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="list-search">
              <Search size={17} aria-hidden="true" />
              <label className="sr-only" htmlFor="prospect-search">Search prospects</label>
              <input
                id="prospect-search"
                type="search"
                placeholder="Search prospects"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              />
            </div>
          </div>

          {visibleProspects.length > 0 ? (
            <div className="table-scroll" role="region" aria-label="Saved prospects" tabIndex={0}>
              <table>
                <caption className="sr-only">Prospects</caption>
                <thead>
                  <tr>
                    <th className="company-column" scope="col" aria-sort={sort}>
                      <button className="sort-button" type="button" onClick={sortCompanies}>
                        Company
                        <ChevronsUpDown size={13} className="sort-neutral" aria-hidden="true" />
                        <ChevronRight size={13} className="sort-direction" aria-hidden="true" />
                      </button>
                    </th>
                    <th scope="col">Location</th>
                    <th scope="col">AI fit</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Reply outcome</th>
                    <th scope="col">Do not contact</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProspects.map((prospect) => (
                    <tr key={prospect.id} data-selected={prospect.id === selectedId}>
                      <th scope="row" className="company-column">
                        <button
                          className="company-button"
                          type="button"
                          onClick={() => onSelect(prospect.id)}
                          aria-current={prospect.id === selectedId ? "true" : undefined}
                        >
                          <CompanyMark prospect={prospect} />
                          <span className="company-title">
                            <span>{prospect.name}</span>
                            <small>{prospect.domain}</small>
                          </span>
                        </button>
                      </th>
                      <td className="location-cell">{prospect.location}</td>
                      <td><FitLabel fit={prospect.fit} /></td>
                      <td><StageBadge stage={prospect.stage} /></td>
                      <td>{prospect.triage ? <TriageBadge triage={prospect.triage} /> : <span className="empty-value">—</span>}</td>
                      <td>{prospect.doNotContact ? <ContactFlag label="Flagged" /> : <span className="empty-value">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-list">
              <span className="empty-icon"><SearchX size={23} aria-hidden="true" /></span>
              <p>{prospects.length ? "No prospects match" : "No saved prospects yet"}</p>
              {prospects.length > 0 && <button className="button button-secondary" type="button" onClick={() => {
                setQuery("");
                filterStage("All prospects");
              }}>
                Clear filters
              </button>}
            </div>
          )}

          <footer className="list-footer">
            <span>{matches.length ? `Showing ${offset + 1}–${offset + visibleProspects.length} of ${matches.length}` : "0 prospects"}</span>
            <nav className="pagination" aria-label="Prospect pages">
              <button
                className="icon-button"
                type="button"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <span className="page-number">{currentPage} / {pageCount}</span>
              <button
                className="icon-button"
                type="button"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </nav>
          </footer>
        </section>

        {selected && (
          <aside className="review-card" aria-labelledby="review-company">
            <ProspectReview
              prospect={selected}
              headingId="review-company"
              onClose={closeReview}
              onEvidence={() => setSource(selected)}
            />
          </aside>
        )}
      </div>
      <SourceDialog prospect={source} onClose={() => setSource(null)} />
      <div role="status" className="sr-only">{notice}</div>
    </>
  );
}
