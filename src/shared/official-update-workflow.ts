export type OfficialUpdateStatus = "draft" | "scheduled" | "published" | "withdrawn";

export type OfficialUpdateStage =
  | "write"
  | "processing"
  | "verification"
  | "preview"
  | "ready"
  | "scheduled"
  | "published"
  | "withdrawn";

export type OfficialUpdatePrimaryAction =
  | "save_draft"
  | "wait_for_media"
  | "go_to_review"
  | "review_preview"
  | "publish_now"
  | "open_scheduled"
  | "open_published"
  | "open_withdrawn";

export interface OfficialUpdateGuidanceInput {
  hasDraft: boolean;
  status: OfficialUpdateStatus | null;
  sourceReportStatus: string | null;
  selectedCount: number;
  processingSelectedCount: number;
  confirmed: boolean;
}

export interface OfficialUpdateGuidance {
  stage: OfficialUpdateStage;
  primaryAction: OfficialUpdatePrimaryAction;
  heading: string;
  explanation: string;
  selectedLabel: string;
  uploadBlocker: string | null;
  scheduleBlocker: string | null;
  publishBlocker: string | null;
}

const guidance = (
  input: OfficialUpdateGuidanceInput,
  output: Omit<OfficialUpdateGuidance, "selectedLabel">,
): OfficialUpdateGuidance => ({
  ...output,
  selectedLabel: `${Math.max(0, input.selectedCount)} of 3 images selected`,
});

export function officialUpdateGuidance(
  input: OfficialUpdateGuidanceInput,
): OfficialUpdateGuidance {
  if (!input.hasDraft) {
    return guidance(input, {
      stage: "write",
      primaryAction: "save_draft",
      heading: "1. Write the Update",
      explanation: "Save a private draft before adding images. Nothing will be published.",
      uploadBlocker: "A saved private draft is required before adding images.",
      scheduleBlocker: "Save and review the draft before scheduling.",
      publishBlocker: "Save and review the draft before publishing.",
    });
  }

  if (input.status === "scheduled") {
    return guidance(input, {
      stage: "scheduled",
      primaryAction: "open_scheduled",
      heading: "Scheduled",
      explanation: "This Update remains private until its scheduled Edmonton time.",
      uploadBlocker: "Return the scheduled Update to draft before changing images.",
      scheduleBlocker: null,
      publishBlocker: "Return this Update to draft before publishing it now.",
    });
  }

  if (input.status === "published") {
    return guidance(input, {
      stage: "published",
      primaryAction: "open_published",
      heading: "Published",
      explanation: "This exact Update is public.",
      uploadBlocker: "Published media cannot be changed silently.",
      scheduleBlocker: "Published Updates cannot be scheduled.",
      publishBlocker: null,
    });
  }

  if (input.status === "withdrawn") {
    return guidance(input, {
      stage: "withdrawn",
      primaryAction: "open_withdrawn",
      heading: "Withdrawn",
      explanation: "This Update is no longer public and remains in the audit history.",
      uploadBlocker: "Withdrawn Updates are read-only.",
      scheduleBlocker: "Withdrawn Updates are read-only.",
      publishBlocker: "Withdrawn Updates are read-only.",
    });
  }

  if (input.processingSelectedCount > 0) {
    return guidance(input, {
      stage: "processing",
      primaryAction: "wait_for_media",
      heading: "2. Images are processing",
      explanation: "Wait, retry, remove, or deselect the affected image before publishing.",
      uploadBlocker: null,
      scheduleBlocker: "Selected images must finish processing.",
      publishBlocker: "Selected images must finish processing.",
    });
  }

  if (input.sourceReportStatus && input.sourceReportStatus !== "verified") {
    return guidance(input, {
      stage: "verification",
      primaryAction: "go_to_review",
      heading: "Verification required",
      explanation: "Complete the private review before releasing this as an Official Update.",
      uploadBlocker: null,
      scheduleBlocker: "Locked until this report is Verified.",
      publishBlocker: "Locked until this report is Verified.",
    });
  }

  if (!input.confirmed) {
    return guidance(input, {
      stage: "preview",
      primaryAction: "review_preview",
      heading: "3. Review the exact public preview",
      explanation: "Confirm the exact copy and checked images before release.",
      uploadBlocker: null,
      scheduleBlocker: "Review and confirm the exact public preview.",
      publishBlocker: "Review and confirm the exact public preview.",
    });
  }

  return guidance(input, {
    stage: "ready",
    primaryAction: "publish_now",
    heading: "Ready to publish",
    explanation: "Choose Publish now or select a future Edmonton time.",
    uploadBlocker: null,
    scheduleBlocker: null,
    publishBlocker: null,
  });
}
