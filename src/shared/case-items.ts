export const caseItemCollections = ["case", "fresh_drops"] as const;
export const caseItemAudiences = ["public", "hunter_only"] as const;
export const caseItemMediaAudiences = ["public", "hunter_only"] as const;

export type CaseItemCollection = (typeof caseItemCollections)[number];
export type CaseItemAudience = (typeof caseItemAudiences)[number];
export type CaseItemMediaAudience = (typeof caseItemMediaAudiences)[number];

export const isCaseItemCollection = (value: unknown): value is CaseItemCollection =>
  typeof value === "string" && caseItemCollections.includes(value as CaseItemCollection);

export const isCaseItemAudience = (value: unknown): value is CaseItemAudience =>
  typeof value === "string" && caseItemAudiences.includes(value as CaseItemAudience);

export const isCaseItemMediaAudience = (value: unknown): value is CaseItemMediaAudience =>
  typeof value === "string" && caseItemMediaAudiences.includes(value as CaseItemMediaAudience);
