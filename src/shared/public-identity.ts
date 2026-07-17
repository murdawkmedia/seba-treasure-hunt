export interface PublicIdentityProfile {
  participationBasis?: string | null;
  publicDisplayName?: string | null;
  publicHandle?: string | null;
}

const trimmedString = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function publicHunterIdentity(profile: PublicIdentityProfile): string {
  if (profile.participationBasis === "minor_guardian_permission") return "Young Hunter";
  return trimmedString(profile.publicDisplayName) || trimmedString(profile.publicHandle) || "Community Hunter";
}

export function privateAccountIdentity(profile: PublicIdentityProfile): string {
  return trimmedString(profile.publicDisplayName) || trimmedString(profile.publicHandle) || "Hunter";
}
