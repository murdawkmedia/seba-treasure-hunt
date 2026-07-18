export const REPORT_REVIEW_STATES = [
  "received",
  "reviewing",
  "contacted",
  "escalated",
  "verified",
  "rejected",
  "resolved",
] as const;

export type ReportReviewState = typeof REPORT_REVIEW_STATES[number];
export type HunterReportState = "Received" | "Under review" | "Verified" | "Closed";

export interface ReportStateCopy {
  operatorLabel: string;
  operatorExplanation: string;
  hunterLabel: HunterReportState;
}

const COPY: Record<ReportReviewState, ReportStateCopy> = {
  received: {
    operatorLabel: "Received",
    operatorExplanation: "Waiting for an operator to assess it.",
    hunterLabel: "Received",
  },
  reviewing: {
    operatorLabel: "Reviewing",
    operatorExplanation: "An operator is assessing the report.",
    hunterLabel: "Under review",
  },
  contacted: {
    operatorLabel: "Contacted",
    operatorExplanation: "The reporter has been contacted for more information.",
    hunterLabel: "Under review",
  },
  escalated: {
    operatorLabel: "Escalated",
    operatorExplanation: "The report needs additional operational or safety attention.",
    hunterLabel: "Under review",
  },
  verified: {
    operatorLabel: "Verified",
    operatorExplanation: "The relevant facts have been confirmed. An Official Update may now be prepared.",
    hunterLabel: "Verified",
  },
  rejected: {
    operatorLabel: "Rejected",
    operatorExplanation: "The report is invalid, unsafe, duplicate or spam.",
    hunterLabel: "Closed",
  },
  resolved: {
    operatorLabel: "Resolved",
    operatorExplanation: "Internal work on the report is complete.",
    hunterLabel: "Closed",
  },
};

const TRANSITIONS: Record<ReportReviewState, readonly ReportReviewState[]> = {
  received: ["reviewing", "rejected"],
  reviewing: ["contacted", "escalated", "verified", "rejected"],
  contacted: ["reviewing", "escalated", "verified", "rejected"],
  escalated: ["reviewing", "contacted", "verified", "rejected"],
  verified: ["reviewing", "resolved"],
  rejected: ["reviewing"],
  resolved: ["reviewing"],
};

export function isReportReviewState(value: unknown): value is ReportReviewState {
  return typeof value === "string" && REPORT_REVIEW_STATES.includes(value as ReportReviewState);
}

export function nextReportStates(value: unknown): readonly ReportReviewState[] {
  return isReportReviewState(value) ? TRANSITIONS[value] : [];
}

export function reportStateCopy(value: ReportReviewState): ReportStateCopy {
  return COPY[value];
}

export function hunterReportState(value: ReportReviewState): HunterReportState {
  return COPY[value].hunterLabel;
}

export function reportTransitionRequiresReason(from: ReportReviewState, to: ReportReviewState): boolean {
  return to === "rejected" || to === "resolved" || (to === "reviewing" && from !== "received");
}

export function reportTransitionRequiresConfirmation(from: ReportReviewState, to: ReportReviewState): boolean {
  return reportTransitionRequiresReason(from, to);
}
