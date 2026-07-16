import { generatedParticipationWaiver } from "../generated/participation-waiver";
import { generatedPrivacyMediaDocument } from "../generated/privacy-media";

export const privacyMediaDocument = generatedPrivacyMediaDocument;

export const participationWaiverDocument = generatedParticipationWaiver;

export const publicLegalState = () => ({
  privacyMediaVersion: privacyMediaDocument.version,
  privacyMediaHash: privacyMediaDocument.hash,
  waiverStatus: "active" as const,
  waiverVersion: participationWaiverDocument.version,
  waiverHash: participationWaiverDocument.hash,
  waiverEffectiveDate: participationWaiverDocument.effectiveDate
});
