import { defaultSearchCriteria, type SearchCriteria } from "./prospects";

export type EditableSearchCriteria = SearchCriteria & Required<Pick<SearchCriteria,
  "requiredSignals" | "preferredSignals" | "requiredSignalMode" | "contactRoles"
>>;

export const fitLabels: Record<SearchCriteria["minimumFit"], string> = {
  "Any fit": "Any fit",
  "Possible match": "Include possible matches",
  Match: "Clear matches only",
};

export const atlantaPresetId = "atlanta-property-managers";
export const atlantaOffer = "Commercial grounds maintenance";

export function searchLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function editableSearchCriteria(criteria: SearchCriteria): EditableSearchCriteria {
  const prioritizing = criteria.signalRule === "Prioritize matches";
  const legacySignals = [...criteria.signals, criteria.customSignals].filter(Boolean).join("\n");
  return {
    ...criteria,
    requiredSignals: criteria.requiredSignals ?? (prioritizing ? "" : legacySignals),
    preferredSignals: criteria.preferredSignals ?? (prioritizing ? legacySignals : ""),
    requiredSignalMode: criteria.requiredSignalMode ?? (criteria.signalRule === "Require any signal" ? "any" : "all"),
    contactRoles: criteria.contactRoles ?? "",
  };
}

export const discoveryCriteria = editableSearchCriteria({
  ...defaultSearchCriteria,
  minimumFit: "Match",
  signalRule: "Require all signals",
  exclusions: ["Residential only", "Directory listings"],
});

const atlantaSearch: EditableSearchCriteria = {
  ...discoveryCriteria,
  presetId: atlantaPresetId,
  industry: "Commercial property management",
  location: "Metro Atlanta",
  requiredSignals: "Provides property management services\nManages an office or industrial property in the target area",
  preferredSignals: "Manages multiple local sites",
  contactRoles: "Local property management lead\nOperations contact\nFounder or CEO",
};

// The criteria travel through the existing search API without a new preset ID.
const warehouseSearch: EditableSearchCriteria = {
  ...discoveryCriteria,
  industry: "Warehousing and fulfillment services",
  location: "Metro Atlanta",
  requiredSignals: "Provides warehousing or order fulfillment services\nOperates a warehouse or fulfillment center in Metro Atlanta",
  preferredSignals: "Operates multiple local warehouses or fulfillment centers",
  contactRoles: "Facilities manager\nWarehouse operations manager\nFounder or CEO",
  exclusions: ["Directory listings", "Missing work email"],
};

export const searchPresets = [
  { name: "Atlanta property manager", criteria: atlantaSearch },
  { name: "Atlanta warehouse", criteria: warehouseSearch },
];

export function searchRequest(criteria: EditableSearchCriteria): SearchCriteria {
  const required = searchLines(criteria.requiredSignals).join("\n");
  const preferred = searchLines(criteria.preferredSignals).join("\n");
  return {
    ...criteria,
    industry: criteria.industry.trim(),
    location: criteria.location.trim(),
    requiredSignals: required,
    preferredSignals: preferred,
    contactRoles: searchLines(criteria.contactRoles).join("\n"),
    // Project required filters to the earlier workflow contract during rollout.
    signals: [],
    customSignals: required || preferred,
    signalRule: required ? (criteria.requiredSignalMode === "any" ? "Require any signal" : "Require all signals") : "Prioritize matches",
  };
}
