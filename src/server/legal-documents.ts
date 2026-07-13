export const privacyMediaDocument = Object.freeze({
  type: "privacy_media" as const,
  version: "2026.1",
  // SHA-256 of the published policy HTML, excluding decorative favicon and manifest links.
  hash: "c385974ca255ef14161e89041908f4b4eda97c9e7f207288bd1db304a02925d9"
});

// The authoritative waiver has not been supplied. A missing document is a hard participation gate.
export const participationWaiverDocument: null = null;

export const publicLegalState = () => ({
  privacyMediaVersion: privacyMediaDocument.version,
  privacyMediaHash: privacyMediaDocument.hash,
  waiverStatus: participationWaiverDocument ? "active" as const : "pending" as const,
  waiverVersion: participationWaiverDocument
});
