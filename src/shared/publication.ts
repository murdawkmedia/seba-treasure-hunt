export const PUBLIC_ATTRIBUTION_KINDS = [
  "display_name",
  "hunter_handle",
  "community",
  "young_hunter"
] as const;

export type PublicAttributionKind = typeof PUBLIC_ATTRIBUTION_KINDS[number];

export type RequestedPublicAttributionKind = Exclude<PublicAttributionKind, "young_hunter">;

export interface AttributionProfile {
  participationBasis?: string | null;
  publicDisplayName?: string | null;
  publicHandle?: string | null;
}

export interface ResolvedPublicAttribution {
  kind: PublicAttributionKind;
  label: string;
}

export interface ReportPublicAttributionSnapshot {
  hunterSubject: string | null;
  publicAttribution: unknown;
  attributionKind: unknown;
  protectsMinor: boolean;
}

export {
  REPORT_REVIEW_STATES,
  hunterReportState,
  isReportReviewState,
  nextReportStates,
  reportStateCopy,
  reportTransitionRequiresConfirmation,
  reportTransitionRequiresReason,
  type HunterReportState,
  type ReportReviewState,
} from "./report-workflow";

export const PUBLICATION_DESTINATIONS = ["private", "case_note", "official_update"] as const;
export type PublicationDestination = typeof PUBLICATION_DESTINATIONS[number];

export const OFFICIAL_UPDATE_STATES = ["draft", "scheduled", "published", "withdrawn"] as const;
export type OfficialUpdateState = typeof OFFICIAL_UPDATE_STATES[number];

export function isPublicAttributionKind(value: unknown): value is PublicAttributionKind {
  return typeof value === "string" && PUBLIC_ATTRIBUTION_KINDS.includes(value as PublicAttributionKind);
}

export function isRequestedPublicAttributionKind(value: unknown): value is RequestedPublicAttributionKind {
  return value === "display_name" || value === "hunter_handle" || value === "community";
}

export function publicDisplayNameError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length < 2 || trimmed.length > 40) {
    return "Public display names must be 2 to 40 characters, or left blank.";
  }
  if (trimmed.includes("@") || /(?:\+?\d[\s().-]*){7,}/.test(trimmed)) {
    return "Use a public name without an email address or phone number.";
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .&'’_-]*[\p{L}\p{N}.]$/u.test(trimmed)) {
    return "Use letters, numbers, spaces, periods, apostrophes, ampersands, hyphens, or underscores.";
  }
  return null;
}

export function resolvePublicAttribution(
  profile: AttributionProfile | null,
  requested: RequestedPublicAttributionKind,
): ResolvedPublicAttribution {
  if (profile?.participationBasis === "minor_guardian_permission") {
    return { kind: "young_hunter", label: "Young Hunter" };
  }
  if (!profile) return { kind: "community", label: "Community Hunter" };
  const displayName = profile.publicDisplayName?.trim() ?? "";
  if (requested === "display_name" && displayName && !publicDisplayNameError(displayName)) {
    return { kind: "display_name", label: displayName };
  }
  const handle = profile.publicHandle?.trim() ?? "";
  if (requested === "hunter_handle" && handle) {
    return { kind: "hunter_handle", label: handle };
  }
  return { kind: "community", label: "Community Hunter" };
}

export function publicAttributionFromReportSnapshot(
  snapshot: ReportPublicAttributionSnapshot
): string | null {
  if (snapshot.protectsMinor) return "Young Hunter";
  if (!snapshot.hunterSubject) return "Community Hunter";

  const label = typeof snapshot.publicAttribution === "string"
    ? snapshot.publicAttribution.trim()
    : "";
  if (!label) return null;
  if (
    (snapshot.attributionKind === "display_name" || snapshot.attributionKind === "hunter_handle") &&
    !publicDisplayNameError(label)
  ) {
    return label;
  }
  if (snapshot.attributionKind === "community" && label === "Community Hunter") {
    return label;
  }
  if (snapshot.attributionKind === "young_hunter" && label === "Young Hunter") {
    return label;
  }
  return null;
}

export function isPublicationDestination(value: unknown): value is PublicationDestination {
  return typeof value === "string" && PUBLICATION_DESTINATIONS.includes(value as PublicationDestination);
}

export function isOfficialUpdateState(value: unknown): value is OfficialUpdateState {
  return typeof value === "string" && OFFICIAL_UPDATE_STATES.includes(value as OfficialUpdateState);
}
