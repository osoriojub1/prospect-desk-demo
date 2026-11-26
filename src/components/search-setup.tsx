import { ArrowRight, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { buyingSignals, exclusions, minimumFits, resultLimits, type SearchCriteria } from "../lib/prospects";
import { leadGenerationLabels, routes } from "../lib/routes";
import { fitLabels, searchLines, searchPresets, searchRequest, type EditableSearchCriteria } from "../lib/search-criteria";
import { AppErrorDialog } from "./app-error-dialog";

function Choices<Value extends string>({ values, selected, onChange }: {
  values: readonly Value[];
  selected: readonly Value[];
  onChange: (values: Value[]) => void;
}) {
  const groupId = useId();

  return (
    <div className="criteria-choices">
      {values.map((value, index) => {
        const id = groupId + "-" + index;
        const checked = selected.includes(value);
        return (
          <div className="criteria-option" key={value}>
            <input
              id={id}
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? selected.filter((item) => item !== value) : [...selected, value])}
            />
            <label htmlFor={id}>{value}</label>
          </div>
        );
      })}
    </div>
  );
}

export function SearchSetup({ criteria, onChange, onSearch }: {
  criteria: EditableSearchCriteria;
  onChange: (criteria: EditableSearchCriteria) => void;
  onSearch: (criteria: SearchCriteria) => Promise<void>;
}) {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [appliedPreset, setAppliedPreset] = useState(() =>
    criteria.presetId && searchPresets.find((preset) => preset.criteria.presetId === criteria.presetId)?.name,
  );
  const requiredCount = searchLines(criteria.requiredSignals).length;
  const activeFilters = 1 + Number(criteria.minimumFit !== "Any fit") + criteria.exclusions.length
    + Number(Boolean(criteria.excludedDomains.trim())) + Number(Boolean(criteria.excludedKeywords.trim()));

  function change(next: Partial<EditableSearchCriteria>) {
    onChange({ ...criteria, ...next });
  }

  async function runSearch() {
    if (searching) return;
    setSearching(true);
    try {
      await onSearch(searchRequest(criteria));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again in a moment.");
    } finally {
      setSearching(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <form className="criteria-form" onSubmit={submit}>
      <section className="action-card action-content">
        <fieldset className="criteria-group" disabled={searching}>
          <legend className="sr-only">Target market</legend>
          <div className="search-preset" role="group" aria-label="Search presets">
            {searchPresets.map((preset) => (
              <button className="button button-secondary" type="button" key={preset.name} onClick={() => {
                onChange(preset.criteria);
                setAppliedPreset(preset.name);
              }}>
                Use {preset.name} search
              </button>
            ))}
            <span className="field-hint" role="status">{appliedPreset && `${appliedPreset} preset applied`}</span>
          </div>
          <div className="target-fields">
            <div className="form-field">
              <label htmlFor="search-industry">Industry</label>
              <input
                id="search-industry"
                name="industry"
                type="text"
                value={criteria.industry}
                onChange={(event) => change({ industry: event.target.value })}
                maxLength={120}
                pattern=".*\S.*"
                title="Enter an industry"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="search-location">Location</label>
              <input
                id="search-location"
                name="location"
                type="text"
                value={criteria.location}
                onChange={(event) => change({ location: event.target.value })}
                maxLength={120}
                pattern=".*\S.*"
                title="Enter a location"
                required
              />
            </div>
          </div>
        </fieldset>
      </section>

      <section className="action-card action-content">
        <fieldset className="criteria-group" disabled={searching}>
          <legend>What to look for</legend>
          <p id="search-line-hint" className="field-hint search-line-hint">One item per line.</p>
          <div className="search-qualification">
            <div className="form-field">
              <label htmlFor="required-signals">Must match</label>
              <textarea id="required-signals" aria-describedby="search-line-hint" rows={4} maxLength={2000}
                value={criteria.requiredSignals} onChange={(event) => change({ requiredSignals: event.target.value })} />
              {requiredCount > 1 && (
                <select aria-label="How to match required signals" value={criteria.requiredSignalMode}
                  onChange={(event) => change({ requiredSignalMode: event.target.value as EditableSearchCriteria["requiredSignalMode"] })}>
                  <option value="all">Match all</option>
                  <option value="any">Match any</option>
                </select>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="preferred-signals">Prefer</label>
              <textarea id="preferred-signals" aria-describedby="search-line-hint" rows={4} maxLength={2000}
                value={criteria.preferredSignals} onChange={(event) => change({ preferredSignals: event.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor="contact-roles">Preferred contact</label>
              <textarea id="contact-roles" aria-describedby="search-line-hint" rows={4} maxLength={750}
                value={criteria.contactRoles} onChange={(event) => change({ contactRoles: event.target.value })} />
            </div>
          </div>
        </fieldset>
      </section>

      <details className="action-card search-options">
        <summary>
          <ChevronRight size={16} aria-hidden="true" />
          More filters <span className="record-count" aria-label={activeFilters + " active filters"}>{activeFilters}</span>
        </summary>
        <div className="action-content search-options-body">
          <fieldset className="criteria-group" disabled={searching}>
            <legend className="sr-only">Result filters</legend>
            <div className="target-fields">
              <div className="form-field">
                <label htmlFor="search-minimum-fit">Evidence required</label>
                <select id="search-minimum-fit" value={criteria.minimumFit}
                  onChange={(event) => change({ minimumFit: event.target.value as SearchCriteria["minimumFit"] })}>
                  {minimumFits.map((fit) => <option value={fit} key={fit}>{fitLabels[fit]}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="search-limit">Max results</label>
                <select id="search-limit" value={criteria.limit}
                  onChange={(event) => change({ limit: Number(event.target.value) as SearchCriteria["limit"] })}>
                  {resultLimits.map((limit) => <option key={limit}>{limit}</option>)}
                </select>
              </div>
            </div>
          </fieldset>
          <fieldset className="criteria-group" disabled={searching}>
            <legend>Signals to prefer</legend>
            <Choices values={buyingSignals} selected={searchLines(criteria.preferredSignals)}
              onChange={(signals) => change({ preferredSignals: signals.join("\n") })} />
          </fieldset>
          <fieldset className="criteria-group" disabled={searching}>
            <legend>Exclusions</legend>
            <Choices values={exclusions} selected={criteria.exclusions}
              onChange={(values) => change({ exclusions: values })} />
            <div className="target-fields criteria-text-fields">
              <div className="form-field">
                <label htmlFor="excluded-domains">Excluded domains</label>
                <textarea id="excluded-domains" aria-describedby="search-line-hint" rows={2} maxLength={2000}
                  value={criteria.excludedDomains} onChange={(event) => change({ excludedDomains: event.target.value })} />
              </div>
              <div className="form-field">
                <label htmlFor="excluded-keywords">Excluded keywords</label>
                <textarea id="excluded-keywords" aria-describedby="search-line-hint" rows={2} maxLength={2000}
                  value={criteria.excludedKeywords} onChange={(event) => change({ excludedKeywords: event.target.value })} />
              </div>
            </div>
          </fieldset>
        </div>
      </details>

      <div className="criteria-footer">
        <Link className="text-link" href={routes.runStatus}>{leadGenerationLabels.runStatus}<ArrowRight size={14} aria-hidden="true" /></Link>
        <button className="button button-primary" type="submit" disabled={searching}>
          <Search size={17} aria-hidden="true" />
          {searching ? "Starting search…" : leadGenerationLabels.search}
        </button>
      </div>
      <AppErrorDialog title="Couldn’t start search" message={error} onClose={() => setError("")} onRetry={() => void runSearch()} />
    </form>
  );
}
