export const stages = ["Generated", "Contacted", "Replied"] as const;
export const triageOptions = ["Hot", "Warm", "Needs nurture"] as const;
export const resultLimits = [1, 2, 3, 4, 5, 10, 25, 50] as const;
export const buyingSignals = [
  "Commercial projects",
  "Multiple locations",
  "Recent expansion",
  "Sales hiring",
  "Published case studies",
] as const;
export const exclusions = ["Residential only", "Directory listings", "Missing work email"] as const;
export const signalRules = ["Prioritize matches", "Require any signal", "Require all signals"] as const;
export const minimumFits = ["Any fit", "Possible match", "Match"] as const;

export type Stage = (typeof stages)[number];
export const contactedStages: readonly Stage[] = ["Contacted", "Replied"];
export const outreachStatusLabels: Record<Stage, string> = {
  Generated: "Not contacted",
  Contacted: "Contacted",
  Replied: "Replied",
};

export type Triage = (typeof triageOptions)[number];
export type Fit = "Match" | "Possible match" | "Insufficient evidence";
export type BuyingSignal = (typeof buyingSignals)[number];
export type Exclusion = (typeof exclusions)[number];
export type SourceEvidence = { url: string; excerpt: string };
export type EmailKind = "direct" | "shared" | "unattributed";
export const emailKindLabels: Record<EmailKind, string> = {
  direct: "Direct work email",
  shared: "Shared inbox",
  unattributed: "Company work email",
};
type Tone = "mint" | "lilac" | "blue" | "sand" | "rose" | "slate";

export type Prospect = {
  id: string;
  name: string;
  domain: string;
  initials: string;
  tone: Tone;
  location: string;
  industry: string;
  fit: Fit;
  rationale: string;
  excerpt: string;
  contactEmail?: string | null;
  emailKind?: EmailKind;
  emailEvidence?: SourceEvidence;
  contact?: { name: string; title: string; source?: SourceEvidence };
  sources?: SourceEvidence[];
  signals?: string[];
  stage: Stage;
  contactedAt: string | null;
  repliedAt: string | null;
  triage: Triage | null;
  doNotContact: boolean;
  replyExcerpt?: string;
};

export type SearchCriteria = {
  industry: string;
  location: string;
  limit: (typeof resultLimits)[number];
  minimumFit: (typeof minimumFits)[number];
  signals: BuyingSignal[];
  customSignals: string;
  signalRule: (typeof signalRules)[number];
  exclusions: Exclusion[];
  excludedDomains: string;
  excludedKeywords: string;
  presetId?: "atlanta-property-managers";
  requiredSignals?: string;
  preferredSignals?: string;
  requiredSignalMode?: "all" | "any";
  contactRoles?: string;
};

export type OutreachDraft = { subject: string; message: string };

export const defaultSearchCriteria: SearchCriteria = {
  industry: "",
  location: "",
  limit: 5,
  minimumFit: "Possible match",
  signals: [],
  customSignals: "",
  signalRule: "Prioritize matches",
  exclusions: [...exclusions],
  excludedDomains: "",
  excludedKeywords: "",
};

export const outreachDate = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Shanghai",
});
