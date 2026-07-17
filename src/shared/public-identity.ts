export interface PublicIdentityProfile {
  participationBasis?: string | null;
  publicDisplayName?: string | null;
  publicHandle?: string | null;
}

export function publicHunterIdentity(profile: PublicIdentityProfile): string {
  if (profile.participationBasis === "minor_guardian_permission") return "Young Hunter";
  return profile.publicDisplayName?.trim() || profile.publicHandle?.trim() || "Community Hunter";
}

export function privateAccountIdentity(profile: PublicIdentityProfile): string {
  return profile.publicDisplayName?.trim() || profile.publicHandle?.trim() || "Hunter";
}
