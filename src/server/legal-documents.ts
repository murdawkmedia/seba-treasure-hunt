export const privacyMediaDocument = Object.freeze({
  type: "privacy_media" as const,
  version: "2026.1",
  // SHA-256 of the published policy HTML, excluding decorative favicon and manifest links.
  hash: "1e1684d783d499e416b2e2cd049f15bf57d17cb08a882ab3a5cbc268b5662223"
});

// The authoritative waiver has not been supplied. A missing document is a hard participation gate.
export const participationWaiverDocument: null = null;

export const publicLegalState = () => ({
  privacyMediaVersion: privacyMediaDocument.version,
  privacyMediaHash: privacyMediaDocument.hash,
  waiverStatus: participationWaiverDocument ? "active" as const : "pending" as const,
  waiverVersion: participationWaiverDocument
});
