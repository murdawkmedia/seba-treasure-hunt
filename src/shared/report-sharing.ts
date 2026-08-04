export const FINDER_SHARING_NOTICE_VERSION = "2026.1";

export const PUBLICATION_PREFERENCES = ["share_after_review", "private"] as const;
export type PublicationPreference = typeof PUBLICATION_PREFERENCES[number];

export const normalizePublicationPreference = (value: unknown): PublicationPreference | null =>
  value === "share_after_review" || value === "private" ? value : null;
