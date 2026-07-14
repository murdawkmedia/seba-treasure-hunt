export const privacyMediaDocument = Object.freeze({
  type: "privacy_media" as const,
  version: "2026.1",
  // SHA-256 of the published policy HTML, excluding decorative favicon and manifest links.
  hash: "5c7290339e22b35daaf08c7d561ff94ccb64dfd8d361e69b74ce738664b0c2ee"
});

// The authoritative waiver has not been supplied. A missing document is a hard participation gate.
export const participationWaiverDocument: null = null;

export const publicLegalState = () => ({
  privacyMediaVersion: privacyMediaDocument.version,
  privacyMediaHash: privacyMediaDocument.hash,
  waiverStatus: participationWaiverDocument ? "active" as const : "pending" as const,
  waiverVersion: participationWaiverDocument
});
