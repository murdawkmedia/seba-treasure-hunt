import { generatedParticipationWaiver } from "../generated/participation-waiver";

export const privacyMediaDocument = Object.freeze({
  type: "privacy_media" as const,
  version: "2026.1",
  // SHA-256 of the published policy HTML, excluding decorative favicon and manifest links.
  hash: "5c7290339e22b35daaf08c7d561ff94ccb64dfd8d361e69b74ce738664b0c2ee"
});

export const participationWaiverDocument = generatedParticipationWaiver;

export const publicLegalState = () => ({
  privacyMediaVersion: privacyMediaDocument.version,
  privacyMediaHash: privacyMediaDocument.hash,
  waiverStatus: "active" as const,
  waiverVersion: participationWaiverDocument.version,
  waiverHash: participationWaiverDocument.hash,
  waiverEffectiveDate: participationWaiverDocument.effectiveDate
});
