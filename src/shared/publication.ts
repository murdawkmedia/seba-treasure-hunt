export const PUBLIC_ATTRIBUTION_KINDS = [
  "display_name",
  "hunter_handle",
  "community",
  "young_hunter"
] as const;

export type PublicAttributionKind = typeof PUBLIC_ATTRIBUTION_KINDS[number];

export const PUBLICATION_DESTINATIONS = ["private", "case_note", "official_update"] as const;
export type PublicationDestination = typeof PUBLICATION_DESTINATIONS[number];

export const OFFICIAL_UPDATE_STATES = ["draft", "scheduled", "published", "withdrawn"] as const;
export type OfficialUpdateState = typeof OFFICIAL_UPDATE_STATES[number];

export function isPublicAttributionKind(value: unknown): value is PublicAttributionKind {
  return typeof value === "string" && PUBLIC_ATTRIBUTION_KINDS.includes(value as PublicAttributionKind);
}

export function isPublicationDestination(value: unknown): value is PublicationDestination {
  return typeof value === "string" && PUBLICATION_DESTINATIONS.includes(value as PublicationDestination);
}

export function isOfficialUpdateState(value: unknown): value is OfficialUpdateState {
  return typeof value === "string" && OFFICIAL_UPDATE_STATES.includes(value as OfficialUpdateState);
}
