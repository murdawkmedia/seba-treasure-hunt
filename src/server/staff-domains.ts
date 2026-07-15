const allowedStaffDomains = new Set([
  "sebahub.com",
  "businessasaforceforgood.ca",
]);

export function isAllowedStaffEmail(candidate: string | null): boolean {
  if (!candidate) return false;
  const normalized = candidate.trim().toLowerCase();
  if (normalized.length > 254) return false;
  const separator = normalized.lastIndexOf("@");
  if (separator < 1 || separator === normalized.length - 1) return false;
  if (normalized.indexOf("@") !== separator) return false;
  return allowedStaffDomains.has(normalized.slice(separator + 1));
}

export function staffDisplayName(candidate: string): string {
  const localPart = candidate.trim().split("@", 1)[0] ?? "Operator";
  return localPart || "Operator";
}
