import type { Clerk } from "@clerk/clerk-js";
import type { SignInResource, SignUpResource } from "@clerk/shared/types";
import { createSerializedSubmission } from "./identity-submission";
import { isAllowedStaffEmail } from "../server/staff-domains";
import { routeOrder, stopLabel, waypointId } from "../shared/waypoints";
import { nextReportStates, type ReportReviewState } from "../shared/publication";
import { prepareReportImages, ReportImagePreparationError } from "./report-image-preparation";
import { initializeApprovedMediaViewer } from "./approved-media-viewer";

type OpsView = "command" | "updates" | "reports" | "sponsors" | "moderation" | "zones" | "rules" | "subscribers" | "access" | "audit" | "production-snapshot";

type OpsSponsorState = "new" | "contacted" | "qualified" | "accepted" | "closed";
type OpsSponsorSupportType = "community" | "lead" | "prize_in_kind" | "other";

export interface OpsDashboard {
  status: {
    state: string;
    updatedAt: string;
    nextClue: string;
    version: number | null;
  } | null;
  counts: {
    pendingNotes: number | null;
    receivedReports: number | null;
    receivedFlags: number | null;
    activeHunters: number | null;
  };
  killSwitches: {
    boardVisible: boolean;
    notesEnabled: boolean;
    repliesEnabled: boolean;
  } | null;
}

interface OpsStaffRecord {
  subject: string;
  email: string;
  displayName: string;
  status: string;
  invitedAt: string;
  lastLoginAt: string;
  sessionCount: number | null;
  actions: string[];
}

export interface OpsReportRecord {
  id: string;
  createdAt: string;
  type: string;
  waypointId: string;
  waypointRouteOrder: number | null;
  waypointName: string | null;
  mediaCount: number;
  status: string;
}

export interface OpsReportMedia {
  id: string;
  contentType: string;
  size: number;
  status: string;
}

export interface OpsUpdateUpload extends OpsReportMedia {
  altText: string | null;
  caption: string | null;
  position: number | null;
}

export interface OpsReportDetail extends OpsReportRecord {
  updatedAt: string;
  hunterSubject: string | null;
  name: string;
  email: string;
  phone: string | null;
  publicAttribution: string | null;
  publicationEligible: boolean;
  publicationEligibilityReason: string;
  publication: {
    published: boolean;
    updateId: string | null;
    status: "draft" | "scheduled" | "published" | "withdrawn" | null;
    scheduledFor: string | null;
    title: string | null;
    body: string | null;
    mediaIds: string[];
    uploads: OpsUpdateUpload[];
  };
  caseNote: {
    published: boolean;
    noteId: string | null;
    status: string | null;
  };
  locationDescription: string;
  latitude: number | null;
  longitude: number | null;
  details: string;
  assignedTo: string | null;
  media: OpsReportMedia[];
}

export interface OpsSponsorRecord {
  id: string;
  referenceCode: string;
  contactName: string;
  organization: string;
  email: string;
  phone: string | null;
  supportType: OpsSponsorSupportType;
  contributionRange: string | null;
  desiredOutcome: string;
  acknowledgementVersion: string;
  state: OpsSponsorState;
  createdAt: string;
  updatedAt: string;
}

export interface OpsSponsorLedger {
  counts: Record<OpsSponsorState, number | null>;
  items: OpsSponsorRecord[];
  nextCursor: string | null;
}

interface OpsModerationRecord {
  id: string;
  createdAt: string;
  authorHandle: string;
  waypointId: string;
  waypointRouteOrder: number | null;
  waypointName: string | null;
  mediaCount: number;
  media: OpsModerationMedia[];
  body: string;
}

interface OpsModerationMedia {
  id: string;
  contentType: string;
  size: number;
  status: string;
}

export interface OpsModerationReply {
  id: string;
  noteId: string;
  noteExcerpt: string;
  waypointRouteOrder: number | null;
  waypointName: string | null;
  body: string;
  authorHandle: string;
  status: "published" | "hidden";
  flagCount: number;
  createdAt: string;
  moderatedAt: string | null;
}

export interface OpsContentFlag {
  id: string;
  targetId: string;
  targetExcerpt: string;
  authorHandle: string;
  targetStatus: "published" | "hidden";
  noteExcerpt: string;
  waypointRouteOrder: number | null;
  waypointName: string | null;
  reason: string;
  status: "received" | "reviewing";
  createdAt: string;
}

interface OpsAuditRecord {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  target: string;
  result: string;
}

export interface OpsSubscriberRecord {
  id: string;
  verifiedEmail: string;
  accountState: string;
  profileComplete: boolean;
  fullName: string;
  publicHandle: string;
  townArea: string;
  privacyMediaVersion: string;
  waiverStatus: string;
  waiverVersion: string;
  acceptedAt: string;
  minorCount: number;
  receiptStatus: string;
  participationUnlocked: boolean;
  consents: {
    huntEmail: boolean;
    marketing: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OpsWaiverDetail {
  id: string;
  subject: string;
  documentVersion: string;
  documentHash: string;
  acceptedAt: string;
  referenceCode: string;
  participants: Array<{
    role: "adult" | "minor";
    participationBasis?: "adult" | "minor_guardian_permission" | undefined;
    fullName: string;
    birthYear: number | null;
    guardianAttested: boolean;
  }>;
  receipt: {
    status: "pending" | "sent" | "failed" | "uncertain";
    attempts: number;
    sentAt: string;
  };
}

export interface OpsSubscriberLedger {
  counts: {
    verifiedAccounts: number | null;
    completedProfiles: number | null;
    huntEmail: number | null;
    marketing: number | null;
  };
  items: OpsSubscriberRecord[];
  nextCursor: string | null;
}

export interface ProductionSnapshotSummary {
  snapshotId: string;
  verifiedAt: string;
  sourceUpdatedAt: string;
  counts: { reports: number; players: number; staff: number; audit: number; media: number };
}

export interface ProductionSnapshotReport {
  id: string;
  reportType: string;
  reporterName: string;
  reporterEmail: string;
  reporterPhone: string | null;
  waypointRouteOrder: number | null;
  waypointName: string | null;
  status: string;
  createdAt: string;
}

const views: readonly OpsView[] = ["command", "updates", "reports", "sponsors", "moderation", "zones", "rules", "subscribers", "access", "audit", "production-snapshot"];
const sponsorStates: readonly OpsSponsorState[] = ["new", "contacted", "qualified", "accepted", "closed"];
const visibleSponsorMetricStates = ["new", "contacted", "qualified", "accepted"] as const;
const sponsorSupportTypes: readonly OpsSponsorSupportType[] = ["community", "lead", "prize_in_kind", "other"];

let staffClerk: Clerk | null = null;
let signInAttempt: SignInResource | null = null;
let signUpAttempt: SignUpResource | null = null;
let latestDashboard: OpsDashboard | null = null;
let loadedSubscribers: OpsSubscriberRecord[] = [];
let subscriberNextCursor: string | null = null;
let subscribersLoaded = false;
let subscribersLoading = false;
let sponsorsLoaded = false;
let sponsorLoadVersion = 0;
const sponsorMutations = new Set<string>();
let productionSnapshotLoaded = false;
let productionSnapshotLoading = false;
let productionSnapshotAvailable = false;
let productionSnapshotAbortController: AbortController | null = null;
let productionSnapshotTrigger: HTMLButtonElement | null = null;
let productionSnapshotObjectUrls: string[] = [];
let moderationRepliesController: ModerationPaginationController<OpsModerationReply> | null = null;
let moderationFlagsController: ModerationPaginationController<OpsContentFlag> | null = null;

export interface ReportReviewIntent {
  generation: number;
  reportId: string;
}

export function createReportReviewGuard(): {
  begin(reportId: string): ReportReviewIntent;
  capture(): ReportReviewIntent | null;
  close(): void;
  isCurrent(intent: ReportReviewIntent | null): intent is ReportReviewIntent;
} {
  let generation = 0;
  let reportId: string | null = null;
  return {
    begin(nextReportId) {
      generation += 1;
      reportId = nextReportId;
      return Object.freeze({ generation, reportId: nextReportId });
    },
    capture() {
      return reportId ? Object.freeze({ generation, reportId }) : null;
    },
    close() {
      generation += 1;
      reportId = null;
    },
    isCurrent(intent): intent is ReportReviewIntent {
      return Boolean(intent && reportId === intent.reportId && generation === intent.generation);
    },
  };
}

export function reportPublicationConfirmationAfterInput(
  confirmed: boolean,
  controlName: string
): boolean {
  return ["title", "body", "publishMedia", "scheduledFor"].includes(controlName) ? false : confirmed;
}

let reportReviewTrigger: HTMLButtonElement | null = null;
let activeReportDetail: OpsReportDetail | null = null;
let reportEvidenceObjectUrls: string[] = [];
const reportReviewGuard = createReportReviewGuard();
let reportReviewAbortController: AbortController | null = null;

export function escapeOpsHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function envelopeData(payload: unknown): unknown {
  return isRecord(payload) && "data" in payload ? payload.data : payload;
}

export function formatOpsTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Edmonton",
  }).format(date);
}

export function normalizeOpsDashboard(payload: unknown): OpsDashboard {
  const data = envelopeData(payload);
  const record = isRecord(data) ? data : {};
  const statusSource = isRecord(record.status) ? record.status : null;
  const countSource = isRecord(record.counts) ? record.counts : {};
  const switchSource = isRecord(record.killSwitches) ? record.killSwitches : null;
  const state = statusSource ? asString(statusSource.state).toLowerCase() : "";
  const updatedAt = statusSource ? asString(statusSource.updatedAt) : "";
  const status = ["open", "paused", "found"].includes(state) && updatedAt
    ? {
        state,
        updatedAt,
        nextClue: asString(statusSource?.nextClue),
        version: asNumber(statusSource?.version),
      }
    : null;
  const boardVisible = switchSource ? asBoolean(switchSource.boardVisible) : null;
  const notesEnabled = switchSource ? asBoolean(switchSource.notesEnabled) : null;
  const repliesEnabled = switchSource ? asBoolean(switchSource.repliesEnabled) : null;
  const killSwitches = boardVisible === null || notesEnabled === null || repliesEnabled === null
    ? null
    : { boardVisible, notesEnabled, repliesEnabled };
  return {
    status,
    counts: {
      pendingNotes: asNumber(countSource.pendingNotes),
      receivedReports: asNumber(countSource.receivedReports),
      receivedFlags: asNumber(countSource.receivedFlags),
      activeHunters: asNumber(countSource.activeHunters),
    },
    killSwitches,
  };
}

export function normalizeProductionSnapshotSummary(payload: unknown): ProductionSnapshotSummary | null {
  const value = envelopeData(payload);
  if (!isRecord(value) || value.kind !== "production-snapshot" || value.status !== "verified") return null;
  const counts = isRecord(value.counts) ? value.counts : {};
  const parsed = {
    reports: asNumber(counts.reports),
    players: asNumber(counts.players),
    staff: asNumber(counts.staff),
    audit: asNumber(counts.audit),
    media: asNumber(counts.media),
  };
  if (Object.values(parsed).some((count) => count === null)) return null;
  const snapshotId = asString(value.snapshotId);
  const verifiedAt = asString(value.verifiedAt);
  if (!snapshotId || !verifiedAt) return null;
  return {
    snapshotId,
    verifiedAt,
    sourceUpdatedAt: asString(value.sourceUpdatedAt),
    counts: parsed as ProductionSnapshotSummary["counts"],
  };
}

export function normalizeProductionSnapshotReports(payload: unknown): ProductionSnapshotReport[] {
  return asArray(envelopeData(payload)).flatMap((value): ProductionSnapshotReport[] => {
    if (!isRecord(value)) return [];
    const id = asString(value.id);
    const reportType = asString(value.reportType);
    const reporterName = asString(value.reporterName);
    const reporterEmail = asString(value.reporterEmail);
    if (!id || !reportType || !reporterName || !reporterEmail) return [];
    return [{
      id,
      reportType,
      reporterName,
      reporterEmail,
      reporterPhone: asString(value.reporterPhone) || null,
      waypointRouteOrder: asNumber(value.waypointRouteOrder),
      waypointName: asString(value.waypointName) || null,
      status: asString(value.status),
      createdAt: asString(value.createdAt),
    }];
  });
}

export function normalizeOpsStaff(payload: unknown): OpsStaffRecord[] {
  return asArray(envelopeData(payload)).flatMap((value) => {
    if (!isRecord(value)) return [];
    const subject = asString(value.id) || asString(value.subject);
    const email = asString(value.email);
    const status = asString(value.status);
    if (!subject || !email || !["invited", "active", "suspended", "revoked"].includes(status)) return [];
    const providedActions = asArray(value.actions).filter((action): action is string => typeof action === "string");
    const defaultActions: Record<string, string[]> = {
      invited: ["resend-invitation"],
      active: ["recovery", "revoke-sessions", "suspend"],
      suspended: ["recovery", "reactivate"],
      revoked: [],
    };
    const actionList = providedActions.length ? providedActions : (defaultActions[status] ?? []);
    return [{
      subject,
      email,
      displayName: asString(value.displayName) || "Invited operator",
      status,
      invitedAt: asString(value.invitedAt),
      lastLoginAt: asString(value.lastLoginAt),
      sessionCount: asNumber(value.sessionCount),
      actions: actionList,
    }];
  });
}

function normalizeWaypointId(value: unknown): string {
  const id = waypointId(value);
  return id === null ? "Not specified" : String(id);
}

function normalizeWaypointMetadata(value: Record<string, unknown>): {
  waypointRouteOrder: number | null;
  waypointName: string | null;
} {
  const id = waypointId(value.waypointId);
  const order = routeOrder(value.waypointRouteOrder);
  const name = asString(value.waypointName).trim();
  return id !== null && order !== null && name
    ? { waypointRouteOrder: order, waypointName: name }
    : { waypointRouteOrder: null, waypointName: null };
}

export function normalizeReports(payload: unknown): OpsReportRecord[] {
  const data = envelopeData(payload);
  const records = Array.isArray(data) ? data : isRecord(data) ? asArray(data.items ?? data.reports) : [];
  return records.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = asString(value.id);
    const type = asString(value.type);
    if (!id || !["find", "tip", "safety"].includes(type)) return [];
    return [{
      id,
      createdAt: asString(value.createdAt),
      type,
      waypointId: normalizeWaypointId(value.waypointId),
      ...normalizeWaypointMetadata(value),
      mediaCount: asNumber(value.mediaCount) ?? asArray(value.media).length,
      status: asString(value.status) || "received",
    }];
  });
}

export function normalizeOpsReportDetail(payload: unknown): OpsReportDetail | null {
  const value = envelopeData(payload);
  if (!isRecord(value)) return null;
  const id = asString(value.id).trim();
  const type = asString(value.type);
  const status = asString(value.status).trim();
  const name = asString(value.name).trim();
  const email = asString(value.email).trim();
  const details = asString(value.details).trim();
  const createdAt = asString(value.createdAt);
  if (!id || !["find", "tip", "safety"].includes(type) || !status || !name || !email || !details || !createdAt) {
    return null;
  }
  const latitudeValue = finiteNumber(value.latitude);
  const longitudeValue = finiteNumber(value.longitude);
  const coordinatesValid = latitudeValue !== null && longitudeValue !== null &&
    latitudeValue >= -90 && latitudeValue <= 90 && longitudeValue >= -180 && longitudeValue <= 180;
  const publicationEligible = asBoolean(value.publicationEligible);
  const publicationEligibilityReason = asString(value.publicationEligibilityReason).trim();
  const publicationValue = isRecord(value.publication) ? value.publication : null;
  const published = publicationValue ? asBoolean(publicationValue.published) : null;
  const publicationUpdateId = publicationValue?.updateId === null
    ? null
    : asString(publicationValue?.updateId).trim() || null;
  const rawPublicationStatus = asString(publicationValue?.status).trim();
  const publicationStatus = rawPublicationStatus
    ? (["draft", "scheduled", "published", "withdrawn"].includes(rawPublicationStatus)
      ? rawPublicationStatus as "draft" | "scheduled" | "published" | "withdrawn"
      : null)
    : published
      ? "published"
      : null;
  const publicationScheduledFor = publicationValue?.scheduledFor === null || !publicationValue
    ? null
    : asString(publicationValue.scheduledFor).trim() || null;
  const publicationTitle = publicationStatus ? asString(publicationValue?.title).trim() || null : null;
  const publicationBody = publicationStatus ? asString(publicationValue?.body).trim() || null : null;
  const publicationMediaIds = asArray(publicationValue?.mediaIds)
    .map((mediaId) => asString(mediaId).trim())
    .filter(Boolean);
  const publicationUploads = asArray(publicationValue?.uploads).flatMap((candidate): OpsUpdateUpload[] => {
    if (!isRecord(candidate)) return [];
    const uploadId = asString(candidate.id).trim();
    const contentType = asString(candidate.contentType).trim();
    const uploadStatus = asString(candidate.status).trim();
    const size = asNumber(candidate.size);
    if (!uploadId || !contentType || !uploadStatus || size === null) return [];
    return [{
      id: uploadId,
      contentType,
      size,
      status: uploadStatus,
      altText: asString(candidate.altText).trim() || null,
      caption: asString(candidate.caption).trim() || null,
      position: asNumber(candidate.position),
    }];
  });
  const caseNoteValue = isRecord(value.caseNote) ? value.caseNote : null;
  const caseNotePublished = caseNoteValue ? asBoolean(caseNoteValue.published) : false;
  const caseNoteId = caseNoteValue?.noteId === null || !caseNoteValue
    ? null
    : asString(caseNoteValue.noteId).trim() || null;
  const caseNoteStatus = caseNoteValue?.status === null || !caseNoteValue
    ? null
    : asString(caseNoteValue.status).trim() || null;
  const rawAttribution = value.publicAttribution === null ? "" : asString(value.publicAttribution).trim();
  const publicAttribution = rawAttribution && rawAttribution.length <= 80 && !rawAttribution.includes("@")
    ? rawAttribution
    : null;
  if (
    publicationEligible === null || !publicationEligibilityReason || published === null || caseNotePublished === null ||
    (publicationStatus === null ? publicationUpdateId !== null : !publicationUpdateId) ||
    (publicationStatus === "scheduled" ? !publicationScheduledFor : publicationScheduledFor !== null) ||
    (published && publicationStatus !== "published" && publicationStatus !== "scheduled") ||
    (caseNotePublished ? !caseNoteId || caseNoteStatus !== "published" : caseNoteId !== null) ||
    (publicationEligible && (!publicAttribution || publicationEligibilityReason !== "eligible"))
  ) return null;
  const media = asArray(value.media).flatMap((candidate): OpsReportMedia[] => {
    if (!isRecord(candidate)) return [];
    const mediaId = asString(candidate.id).trim();
    const contentType = asString(candidate.contentType).trim();
    const mediaStatus = asString(candidate.status).trim();
    const size = asNumber(candidate.size);
    if (!mediaId || !contentType || !mediaStatus || size === null) return [];
    return [{ id: mediaId, contentType, size, status: mediaStatus }];
  });
  if (media.length !== asArray(value.media).length) return null;
  return {
    id,
    type,
    status,
    createdAt,
    updatedAt: asString(value.updatedAt),
    waypointId: normalizeWaypointId(value.waypointId),
    ...normalizeWaypointMetadata(value),
    mediaCount: media.length,
    hunterSubject: asString(value.hunterSubject).trim() || null,
    name,
    email,
    phone: asString(value.phone).trim() || null,
    publicAttribution,
    publicationEligible,
    publicationEligibilityReason,
    publication: {
      published,
      updateId: publicationUpdateId,
      status: publicationStatus,
      scheduledFor: publicationScheduledFor,
      title: publicationTitle,
      body: publicationBody,
      mediaIds: publicationMediaIds,
      uploads: publicationUploads,
    },
    caseNote: { published: caseNotePublished, noteId: caseNoteId, status: caseNoteStatus },
    locationDescription: asString(value.locationDescription).trim(),
    latitude: coordinatesValid ? latitudeValue : null,
    longitude: coordinatesValid ? longitudeValue : null,
    details,
    assignedTo: asString(value.assignedTo).trim() || null,
    media,
  };
}

export function normalizeOpsSponsors(payload: unknown): OpsSponsorLedger {
  const outer = isRecord(payload) ? payload : {};
  const data = envelopeData(payload);
  const records = Array.isArray(data) ? data : isRecord(data) ? asArray(data.items) : [];
  const countSource = isRecord(data) && isRecord(data.counts) ? data.counts : {};
  const page = isRecord(outer.page) ? outer.page : isRecord(data) && isRecord(data.page) ? data.page : {};
  const items = records.flatMap((value): OpsSponsorRecord[] => {
    if (!isRecord(value)) return [];
    const id = asString(value.id);
    const referenceCode = asString(value.referenceCode);
    const contactName = asString(value.contactName);
    const organization = asString(value.organization);
    const email = asString(value.email);
    const supportType = asString(value.supportType) as OpsSponsorSupportType;
    const state = asString(value.state) as OpsSponsorState;
    if (
      !id || !referenceCode || !contactName || !organization || !email ||
      !sponsorSupportTypes.includes(supportType) || !sponsorStates.includes(state)
    ) return [];
    return [{
      id,
      referenceCode,
      contactName,
      organization,
      email,
      phone: asString(value.phone) || null,
      supportType,
      contributionRange: asString(value.contributionRange) || null,
      desiredOutcome: asString(value.desiredOutcome),
      acknowledgementVersion: asString(value.acknowledgementVersion),
      state,
      createdAt: asString(value.createdAt),
      updatedAt: asString(value.updatedAt)
    }];
  });
  const parsedCounts = sponsorStates.map((state) => {
    const count = countSource[state];
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
  });
  const countsValid = parsedCounts.every((count): count is number => count !== null);
  const counts = Object.fromEntries(
    sponsorStates.map((state, index) => [state, countsValid ? parsedCounts[index]! : null])
  ) as Record<OpsSponsorState, number | null>;
  return { counts, items, nextCursor: asString(page.nextCursor) || null };
}

export function sponsorMetricValues(ledger: OpsSponsorLedger): Array<number | null> {
  return visibleSponsorMetricStates.map((state) => ledger.counts[state]);
}

export function normalizeModeration(payload: unknown): OpsModerationRecord[] {
  const data = envelopeData(payload);
  const records = Array.isArray(data) ? data : isRecord(data) ? asArray(data.items ?? data.notes) : [];
  return records.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = asString(value.id);
    if (!id) return [];
    const media = asArray(value.media).flatMap((item) => {
      if (!isRecord(item)) return [];
      const mediaId = asString(item.id).trim();
      if (!mediaId) return [];
      return [{
        id: mediaId,
        contentType: asString(item.contentType) || "application/octet-stream",
        size: asNumber(item.size) ?? 0,
        status: asString(item.status) || "processing"
      }];
    });
    return [{
      id,
      createdAt: asString(value.createdAt),
      authorHandle: asString(value.authorHandle) || "Private hunter",
      waypointId: normalizeWaypointId(value.waypointId),
      ...normalizeWaypointMetadata(value),
      mediaCount: asNumber(value.mediaCount) ?? media.length,
      media,
      body: asString(value.body),
    }];
  });
}

function normalizeAudit(payload: unknown): OpsAuditRecord[] {
  const data = envelopeData(payload);
  const records = Array.isArray(data) ? data : isRecord(data) ? asArray(data.items ?? data.events) : [];
  return records.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = asString(value.id);
    if (!id) return [];
    return [{
      id,
      createdAt: asString(value.createdAt),
      actor: asString(value.actor) || "System",
      action: asString(value.action) || "Unknown action",
      target: asString(value.target) || "-",
      result: asString(value.result) || "recorded",
    }];
  });
}

export function normalizeOpsSubscribers(payload: unknown): OpsSubscriberLedger {
  const outer = isRecord(payload) ? payload : {};
  const dataValue = envelopeData(payload);
  const data = isRecord(dataValue) ? dataValue : {};
  const counts = isRecord(data.counts) ? data.counts : {};
  const page = isRecord(outer.page) ? outer.page : isRecord(data.page) ? data.page : {};
  const items = asArray(data.items).flatMap((value): OpsSubscriberRecord[] => {
    if (!isRecord(value)) return [];
    const verifiedEmail = asString(value.verifiedEmail).trim();
    const consents = isRecord(value.consents) ? value.consents : {};
    const huntEmail = asBoolean(consents.huntEmail);
    const marketing = asBoolean(consents.marketing);
    const profileComplete = asBoolean(value.profileComplete);
    const participationUnlocked = asBoolean(value.participationUnlocked);
    if (!verifiedEmail || !verifiedEmail.includes("@") || huntEmail === null || marketing === null || profileComplete === null || participationUnlocked === null) return [];
    return [{
      id: asString(value.id),
      verifiedEmail,
      accountState: asString(value.accountState) || "active",
      profileComplete,
      fullName: asString(value.fullName).trim(),
      publicHandle: asString(value.publicHandle).trim(),
      townArea: asString(value.townArea).trim(),
      privacyMediaVersion: asString(value.privacyMediaVersion),
      waiverStatus: asString(value.waiverStatus) || "pending",
      waiverVersion: asString(value.waiverVersion),
      acceptedAt: asString(value.acceptedAt),
      minorCount: asNumber(value.minorCount) ?? 0,
      receiptStatus: asString(value.receiptStatus),
      participationUnlocked,
      consents: { huntEmail, marketing },
      createdAt: asString(value.createdAt),
      updatedAt: asString(value.updatedAt),
    }];
  });
  const nextCursor = asString(page.nextCursor) || null;
  return {
    counts: {
      verifiedAccounts: asNumber(counts.verifiedAccounts),
      completedProfiles: asNumber(counts.completedProfiles),
      huntEmail: asNumber(counts.huntEmail),
      marketing: asNumber(counts.marketing),
    },
    items,
    nextCursor,
  };
}

export function normalizeOpsWaiverDetail(payload: unknown): OpsWaiverDetail | null {
  const value = envelopeData(payload);
  if (!isRecord(value) || !Array.isArray(value.participants) || !isRecord(value.receipt)) return null;
  const id = asString(value.id);
  const subject = asString(value.subject);
  const documentVersion = asString(value.documentVersion);
  const documentHash = asString(value.documentHash).toLowerCase();
  const acceptedAt = asString(value.acceptedAt);
  const referenceCode = asString(value.referenceCode);
  const receiptStatus = asString(value.receipt.status);
  const receiptAttempts = asNumber(value.receipt.attempts);
  if (
    !id || !subject || !documentVersion || !/^[a-f0-9]{64}$/.test(documentHash) ||
    !acceptedAt || !referenceCode || !["pending", "sent", "failed", "uncertain"].includes(receiptStatus) ||
    receiptAttempts === null
  ) return null;
  const participants = value.participants.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const role = asString(candidate.role);
    const participationBasis = candidate.participationBasis === undefined
      ? undefined
      : asString(candidate.participationBasis);
    const fullName = asString(candidate.fullName).trim();
    const guardianAttested = asBoolean(candidate.guardianAttested);
    const birthYear = candidate.birthYear === null ? null : asNumber(candidate.birthYear);
    if (
      !["adult", "minor"].includes(role) || !fullName || fullName.length > 100 ||
      guardianAttested === null ||
      (participationBasis !== undefined && !["adult", "minor_guardian_permission"].includes(participationBasis)) ||
      (participationBasis === "adult" && (role !== "adult" || birthYear !== null || guardianAttested)) ||
      (participationBasis === "minor_guardian_permission" && (role !== "minor" || birthYear !== null || !guardianAttested)) ||
      (participationBasis === undefined && role === "minor" && (birthYear === null || !guardianAttested)) ||
      (participationBasis === undefined && role === "adult" && (birthYear !== null || guardianAttested))
    ) return [];
    return [{
      role: role as "adult" | "minor",
      participationBasis: participationBasis as "adult" | "minor_guardian_permission" | undefined,
      fullName,
      birthYear,
      guardianAttested,
    }];
  });
  const accountParticipants = participants.filter((item) => item.participationBasis !== undefined);
  const legacyAdults = participants.filter((item) => item.participationBasis === undefined && item.role === "adult");
  if (
    participants.length !== value.participants.length ||
    (accountParticipants.length > 0 ? accountParticipants.length !== 1 : legacyAdults.length !== 1)
  ) {
    return null;
  }
  return {
    id,
    subject,
    documentVersion,
    documentHash,
    acceptedAt,
    referenceCode,
    participants,
    receipt: {
      status: receiptStatus as "pending" | "sent" | "failed" | "uncertain",
      attempts: receiptAttempts,
      sentAt: asString(value.receipt.sentAt),
    },
  };
}

export function renderOpsWaiverDetail(detail: OpsWaiverDetail): string {
  const attempts = `${detail.receipt.attempts} ${detail.receipt.attempts === 1 ? "attempt" : "attempts"}`;
  const participants = detail.participants.map((participant) => {
    const suffix = participant.participationBasis === "minor_guardian_permission"
      ? " (minor account holder; guardian permission recorded)"
      : participant.role === "minor"
        ? ` (birth year ${participant.birthYear})`
        : " (adult account holder)";
    return `<li><strong>${escapeOpsHtml(participant.fullName)}</strong>${escapeOpsHtml(suffix)}</li>`;
  }).join("");
  return `<dl class="ops-legal-summary">
    <div><dt>Version</dt><dd>${escapeOpsHtml(detail.documentVersion)}</dd></div>
    <div><dt>Document hash</dt><dd class="ops-mono">${escapeOpsHtml(detail.documentHash)}</dd></div>
    <div><dt>Accepted</dt><dd>${escapeOpsHtml(formatOpsTime(detail.acceptedAt))}</dd></div>
    <div><dt>Reference</dt><dd class="ops-mono">${escapeOpsHtml(detail.referenceCode)}</dd></div>
    <div><dt>Receipt</dt><dd>${escapeOpsHtml(detail.receipt.status)} &middot; ${escapeOpsHtml(attempts)}</dd></div>
  </dl><section class="ops-legal-participants"><h3>Covered participants</h3><ul>${participants}</ul></section>`;
}

export function waiverReceiptRetryIntent(
  status: OpsWaiverDetail["receipt"]["status"]
): {
  confirmation: string;
  body: { confirmUncertainRetry: true } | undefined;
} {
  return status === "uncertain"
    ? {
        confirmation: "I checked the configured sender mailbox Sent Items or provider delivery log and still want to retry this uncertain receipt.",
        body: { confirmUncertainRetry: true },
      }
    : {
        confirmation: "Retry this participant's legal receipt email? This action will be audited.",
        body: undefined,
      };
}

export function applyWaiverReceiptRetryState(
  dialog: { dataset: { receiptStatus?: string } },
  button: { disabled: boolean },
  queued: boolean
): void {
  if (queued) {
    dialog.dataset.receiptStatus = "pending";
    button.disabled = true;
    return;
  }
  button.disabled = false;
}

function consentCell(value: boolean): string {
  const label = value ? "yes" : "no";
  return `<span class="ops-consent" data-value="${label}">${label}</span>`;
}

export function renderSubscriberRows(records: readonly OpsSubscriberRecord[]): string {
  if (records.length === 0) return `<tr><td colspan="9"><span class="ops-table-empty">No players are present in the authorized ledger.</span></td></tr>`;
  return records.map((record) => `<tr>
    <td><span class="ops-mono">${escapeOpsHtml(record.verifiedEmail)}</span></td>
    <td><strong>${escapeOpsHtml(record.fullName || "Name not supplied")}</strong><br /><span class="ops-mono">${escapeOpsHtml(record.publicHandle || "No public handle")}</span></td>
    <td>${escapeOpsHtml(record.townArea || "Not supplied")}</td>
    <td>${record.profileComplete ? "Complete" : "Onboarding"}</td>
    <td>${escapeOpsHtml(record.privacyMediaVersion || "Required")}</td>
    <td>${escapeOpsHtml(record.waiverVersion || record.waiverStatus)}${record.acceptedAt ? `<br /><small>${escapeOpsHtml(formatOpsTime(record.acceptedAt))}</small>` : ""}${record.waiverVersion ? `<br /><small>${record.minorCount} supervised ${record.minorCount === 1 ? "minor" : "minors"} &middot; ${escapeOpsHtml(record.receiptStatus || "receipt unknown")}</small>` : ""}</td>
    <td>${consentCell(record.consents.huntEmail)}</td>
    <td>${consentCell(record.consents.marketing)}</td>
    <td><div class="ops-actions">${record.waiverVersion ? `<button class="ops-button ops-button--quiet" type="button" data-waiver-detail data-player-id="${escapeOpsHtml(record.id)}">Review legal record</button>` : ""}<button class="ops-button ops-button--quiet" type="button" data-player-action="recovery" data-player-id="${escapeOpsHtml(record.id)}">Send recovery instructions</button><button class="ops-button ops-button--quiet" type="button" data-player-action="revoke-sessions" data-player-id="${escapeOpsHtml(record.id)}">Revoke sessions</button></div></td>
  </tr>`).join("");
}

function safeCsvCell(input: unknown): string {
  let value = String(input ?? "");
  if (/^[\u0000-\u0020]*[=+\-@]/.test(value)) value = `'${value}`;
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildSubscriberCsv(records: readonly OpsSubscriberRecord[]): string {
  const rows: string[][] = [
    ["verified_email", "full_name", "public_handle", "town_area", "profile_complete", "privacy_media_version", "waiver_status", "waiver_version", "participation_unlocked", "hunt_email_consent", "marketing_consent", "created_at", "updated_at"],
    ...records.map((record) => [
      record.verifiedEmail,
      record.fullName,
      record.publicHandle,
      record.townArea,
      record.profileComplete ? "yes" : "no",
      record.privacyMediaVersion,
      record.waiverStatus,
      record.waiverVersion,
      record.participationUnlocked ? "yes" : "no",
      record.consents.huntEmail ? "yes" : "no",
      record.consents.marketing ? "yes" : "no",
      record.createdAt,
      record.updatedAt,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function renderStaffRows(records: readonly OpsStaffRecord[]): string {
  if (records.length === 0) return `<tr><td colspan="6"><span class="ops-table-empty">No staff records are available from the private source.</span></td></tr>`;
  return records.map((record) => {
    const action = (name: string, label: string, style = "quiet"): string => record.actions.includes(name)
      ? `<button class="ops-button ops-button--${style}" type="button" data-staff-action="${escapeOpsHtml(name)}" data-staff-id="${escapeOpsHtml(record.subject)}">${escapeOpsHtml(label)}</button>`
      : "";
    const accessAction = record.status === "suspended"
      ? action("reactivate", "Reactivate access")
      : action("suspend", "Suspend access", "danger");
    return `<tr>
      <td><strong>${escapeOpsHtml(record.displayName)}</strong><br /><span class="ops-mono">${escapeOpsHtml(record.email)}</span></td>
      <td>${escapeOpsHtml(record.status === "invited" ? "Pending" : "Accepted")}</td>
      <td><time datetime="${escapeOpsHtml(record.lastLoginAt)}">${escapeOpsHtml(record.lastLoginAt ? formatOpsTime(record.lastLoginAt) : "Never")}</time></td>
      <td>${record.sessionCount === null ? "--" : escapeOpsHtml(record.sessionCount)}</td>
      <td><span class="ops-chip">${escapeOpsHtml(record.status)}</span></td>
      <td><div class="ops-row-actions">${action("resend-invitation", "Resend invitation")}${action("recovery", "Send recovery instructions")}${action("revoke-sessions", "Revoke sessions")}${accessAction}</div></td>
    </tr>`;
  }).join("");
}

export function renderReportRows(records: readonly OpsReportRecord[]): string {
  if (records.length === 0) return `<tr><td colspan="6"><span class="ops-table-empty">No private reports are available from the source.</span></td></tr>`;
  return records.map((record) => `<tr>
    <td><time datetime="${escapeOpsHtml(record.createdAt)}">${escapeOpsHtml(formatOpsTime(record.createdAt))}</time></td>
    <td><span class="ops-chip">${escapeOpsHtml(record.type)}</span></td>
    <td>${escapeOpsHtml(reportWaypointLabel(record))}</td>
    <td>${escapeOpsHtml(record.mediaCount)} ${record.mediaCount === 1 ? "file" : "files"}</td>
    <td>${escapeOpsHtml(record.status)}</td>
    <td><div class="ops-row-actions"><button class="ops-button ops-button--quiet" type="button" data-report-review data-report-id="${escapeOpsHtml(record.id)}">Review report</button></div></td>
  </tr>`).join("");
}

function moderationRecords(payload: unknown): unknown[] {
  const data = envelopeData(payload);
  return Array.isArray(data) ? data : isRecord(data) ? asArray(data.items) : [];
}

function validModerationTime(value: unknown): string | null {
  const text = asString(value).trim();
  return text && !Number.isNaN(new Date(text).valueOf()) ? text : null;
}

function publicRouteOrder(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? routeOrder(value) : null;
}

export function normalizeModerationReplies(payload: unknown): OpsModerationReply[] {
  return moderationRecords(payload).flatMap((value): OpsModerationReply[] => {
    if (!isRecord(value)) return [];
    const id = asString(value.id).trim();
    const noteId = asString(value.noteId).trim();
    const noteExcerpt = asString(value.noteExcerpt);
    const body = asString(value.body);
    const authorHandle = asString(value.authorHandle).trim();
    const createdAt = validModerationTime(value.createdAt);
    const status = asString(value.status);
    const flagCount = typeof value.flagCount === "number" && Number.isSafeInteger(value.flagCount) && value.flagCount >= 0
      ? value.flagCount
      : null;
    const waypointRouteOrder = publicRouteOrder(value.waypointRouteOrder);
    const waypointName = value.waypointName === null ? null : asString(value.waypointName).trim();
    const moderatedAt = value.moderatedAt === null ? null : validModerationTime(value.moderatedAt);
    if (!id || !noteId || !noteExcerpt || !body || !authorHandle || !createdAt ||
        !["published", "hidden"].includes(status) || flagCount === null ||
        (value.waypointRouteOrder !== null && waypointRouteOrder === null) ||
        (value.waypointName !== null && !waypointName) ||
        (value.moderatedAt !== null && moderatedAt === null)) return [];
    return [{ id, noteId, noteExcerpt, waypointRouteOrder, waypointName, body, authorHandle,
      status: status as "published" | "hidden", flagCount, createdAt, moderatedAt }];
  });
}

export function normalizeContentFlags(payload: unknown): OpsContentFlag[] {
  return moderationRecords(payload).flatMap((value): OpsContentFlag[] => {
    if (!isRecord(value)) return [];
    const id = asString(value.id).trim();
    const targetId = asString(value.targetId).trim();
    const targetExcerpt = asString(value.targetExcerpt);
    const authorHandle = asString(value.authorHandle).trim();
    const targetStatus = asString(value.targetStatus);
    const noteExcerpt = asString(value.noteExcerpt);
    const reason = asString(value.reason).trim();
    const status = asString(value.status);
    const createdAt = validModerationTime(value.createdAt);
    const waypointRouteOrder = publicRouteOrder(value.waypointRouteOrder);
    const waypointName = value.waypointName === null ? null : asString(value.waypointName).trim();
    if (!id || !targetId || !targetExcerpt || !authorHandle || !noteExcerpt || !reason || !createdAt ||
        value.targetKind !== "reply" || !["published", "hidden"].includes(targetStatus) ||
        !["received", "reviewing"].includes(status) ||
        (value.waypointRouteOrder !== null && waypointRouteOrder === null) ||
        (value.waypointName !== null && !waypointName)) return [];
    return [{ id, targetId, targetExcerpt, authorHandle,
      targetStatus: targetStatus as "published" | "hidden", noteExcerpt,
      waypointRouteOrder, waypointName, reason,
      status: status as "received" | "reviewing", createdAt }];
  });
}

export function appendDistinctModerationRecords<T extends { id: string }>(
  existing: readonly T[],
  older: readonly T[],
): T[] {
  const seen = new Set(existing.map((record) => record.id));
  return [...existing, ...older.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  })];
}

export type ModerationLoadOutcome =
  | { ok: true; recordCount: number; more: boolean }
  | { ok: false; message: string };

export interface ModerationPaginationController<T extends { id: string }> {
  refresh(): Promise<ModerationLoadOutcome>;
  loadMore(): Promise<ModerationLoadOutcome>;
  records(): readonly T[];
}

export interface ModerationPaginationConfig<T extends { id: string }> {
  endpoint: string;
  tableSelector: string;
  stateSelector: string;
  loadMoreSelector: string;
  document: Pick<Document, "querySelector">;
  request(url: string): Promise<{ response: Response; payload: unknown }>;
  normalize(payload: unknown): T[];
  render(records: readonly T[]): string;
  unavailableRows: string;
  loadedMessage(records: readonly T[], more: boolean): string;
}

export function createModerationPaginationController<T extends { id: string }>(
  config: ModerationPaginationConfig<T>,
): ModerationPaginationController<T> {
  let loaded: T[] = [];
  let nextCursor: string | null = null;
  let loading = false;
  let generation = 0;
  let activeLoad: Promise<ModerationLoadOutcome> | null = null;
  let requestedRefreshGeneration: number | null = null;
  let refreshCycle: Promise<ModerationLoadOutcome> | null = null;
  const table = () => config.document.querySelector<HTMLElement>(config.tableSelector);
  const state = () => config.document.querySelector<HTMLElement>(config.stateSelector);
  const loadMore = () => config.document.querySelector<HTMLButtonElement>(config.loadMoreSelector);
  const setState = (message: string, kind: "normal" | "error" = "normal") => {
    const element = state();
    if (!element) return;
    element.textContent = message;
    if (kind === "error") element.dataset.kind = "error";
    else delete element.dataset.kind;
  };
  const setLoadMore = (failed = false) => {
    const button = loadMore();
    if (!button) return;
    button.hidden = !nextCursor || failed;
    button.disabled = loading || failed;
  };
  const load = async (append: boolean, requestGeneration: number): Promise<ModerationLoadOutcome> => {
    if (append && !nextCursor) return { ok: true, recordCount: loaded.length, more: false };
    if (!append) {
      loaded = [];
      nextCursor = null;
    }
    const cursor = append ? `&cursor=${encodeURIComponent(nextCursor!)}` : "";
    loading = true;
    setLoadMore();
    setState(append ? "Loading older records..." : "Loading records...");
    try {
      const { response, payload } = await config.request(`${config.endpoint}?limit=50${cursor}`);
      if (requestGeneration !== generation) {
        return { ok: false, message: "This moderation request was superseded by a newer refresh." };
      }
      if (!response.ok) throw new Error(apiError(payload, "The moderation queue is unavailable."));
      const page = config.normalize(payload);
      loaded = append ? appendDistinctModerationRecords(loaded, page) : page;
      nextCursor = moderationNextCursor(payload);
      const target = table();
      if (target) target.innerHTML = config.render(loaded);
      setState(config.loadedMessage(loaded, nextCursor !== null));
      return { ok: true, recordCount: loaded.length, more: nextCursor !== null };
    } catch (error) {
      if (requestGeneration !== generation) {
        return { ok: false, message: "This moderation request was superseded by a newer refresh." };
      }
      if (!append) {
        loaded = [];
        nextCursor = null;
        const target = table();
        if (target) target.innerHTML = config.unavailableRows;
      }
      const message = error instanceof Error ? error.message : "The moderation queue is unavailable.";
      setState(message, "error");
      setLoadMore(true);
      return { ok: false, message };
    } finally {
      if (requestGeneration === generation) {
        loading = false;
        const failed = state()?.dataset.kind === "error";
        setLoadMore(failed);
      }
    }
  };
  const startLoad = (append: boolean, requestGeneration: number): Promise<ModerationLoadOutcome> => {
    const request = load(append, requestGeneration);
    activeLoad = request;
    void request.finally(() => {
      if (activeLoad === request) activeLoad = null;
    });
    return request;
  };
  const drainRefreshes = async (): Promise<ModerationLoadOutcome> => {
    let outcome: ModerationLoadOutcome = { ok: false, message: "The moderation refresh did not run." };
    while (requestedRefreshGeneration !== null) {
      if (activeLoad) await activeLoad;
      const requestGeneration = requestedRefreshGeneration;
      requestedRefreshGeneration = null;
      outcome = await startLoad(false, requestGeneration);
    }
    return outcome;
  };
  const refresh = (): Promise<ModerationLoadOutcome> => {
    requestedRefreshGeneration = ++generation;
    if (!refreshCycle) {
      const cycle = drainRefreshes();
      const trackedCycle = cycle.finally(() => {
        if (refreshCycle === trackedCycle) refreshCycle = null;
      });
      refreshCycle = trackedCycle;
    }
    return refreshCycle;
  };
  const append = (): Promise<ModerationLoadOutcome> => {
    if (activeLoad || refreshCycle) {
      return Promise.resolve({ ok: false, message: "A moderation refresh is already in progress." });
    }
    return startLoad(true, generation);
  };
  return { refresh, loadMore: append, records: () => loaded };
}

export function moderationMutationRefreshNotice(
  successMessage: string,
  outcome: ModerationLoadOutcome,
): { message: string; kind: "normal" | "error" } {
  if (outcome.ok) return { message: successMessage, kind: "normal" };
  return {
    message: `${successMessage} The action succeeded, but the verification refresh failed. Use Refresh before taking another action.`,
    kind: "error",
  };
}

export function renderProductionSnapshotReportRows(records: readonly ProductionSnapshotReport[]): string {
  if (records.length === 0) return `<tr><td colspan="6"><span class="ops-table-empty">No reports are present in this snapshot.</span></td></tr>`;
  return records.map((record) => {
    const waypoint = record.waypointRouteOrder !== null && record.waypointName
      ? `Waypoint ${record.waypointRouteOrder} — ${record.waypointName}`
      : "Not specified";
    const contact = `${record.reporterEmail}${record.reporterPhone ? ` / ${record.reporterPhone}` : ""}`;
    return `<tr>
      <td><time datetime="${escapeOpsHtml(record.createdAt)}">${escapeOpsHtml(formatOpsTime(record.createdAt))}</time></td>
      <td><strong>${escapeOpsHtml(record.reporterName)}</strong><br /><span class="ops-mono">${escapeOpsHtml(record.reportType)}</span></td>
      <td><span class="ops-mono">${escapeOpsHtml(contact)}</span></td>
      <td>${escapeOpsHtml(waypoint)}</td>
      <td>${escapeOpsHtml(record.status || "Unknown")}</td>
      <td><div class="ops-row-actions"><button class="ops-button ops-button--quiet" type="button" data-production-snapshot-report-id="${escapeOpsHtml(record.id)}">Review snapshot report</button></div></td>
    </tr>`;
  }).join("");
}

function snapshotRecords(payload: unknown): Record<string, unknown>[] {
  return asArray(envelopeData(payload)).filter(isRecord);
}

function renderProductionSnapshotPlayerRows(records: readonly Record<string, unknown>[]): string {
  if (records.length === 0) return `<tr><td colspan="6"><span class="ops-table-empty">No players are present in this snapshot.</span></td></tr>`;
  return records.map((record) => {
    const subject = asString(record.subject) || asString(record.id);
    const fullName = asString(record.fullName) || "Name not supplied";
    const publicHandle = asString(record.publicHandle);
    const waiverVersion = asString(record.waiverVersion);
    return `<tr>
      <td><strong>${escapeOpsHtml(fullName)}</strong>${publicHandle ? `<br /><span class="ops-mono">${escapeOpsHtml(publicHandle)}</span>` : ""}</td>
      <td><span class="ops-mono">${escapeOpsHtml(asString(record.verifiedEmail) || "Not supplied")}</span></td>
      <td>${escapeOpsHtml(asString(record.participationBasis) || "Not recorded")}</td>
      <td>${escapeOpsHtml(asString(record.privacyMediaVersion) || "Not accepted")}</td>
      <td>${escapeOpsHtml(waiverVersion || "Not accepted")}</td>
      <td>${waiverVersion && subject ? `<button class="ops-button ops-button--quiet" type="button" data-production-snapshot-waiver-subject="${escapeOpsHtml(subject)}">Review snapshot waiver</button>` : ""}</td>
    </tr>`;
  }).join("");
}

function renderProductionSnapshotStaffRows(records: readonly Record<string, unknown>[]): string {
  if (records.length === 0) return `<tr><td colspan="4"><span class="ops-table-empty">No staff are present in this snapshot.</span></td></tr>`;
  return records.map((record) => `<tr>
    <td><strong>${escapeOpsHtml(asString(record.displayName) || "Operator")}</strong></td>
    <td><span class="ops-mono">${escapeOpsHtml(asString(record.email))}</span></td>
    <td>${escapeOpsHtml(asString(record.status) || "Unknown")}</td>
    <td>${escapeOpsHtml(asString(record.lastLoginAt) ? formatOpsTime(asString(record.lastLoginAt)) : "Never")}</td>
  </tr>`).join("");
}

function renderProductionSnapshotAuditRows(records: readonly Record<string, unknown>[]): string {
  if (records.length === 0) return `<tr><td colspan="5"><span class="ops-table-empty">No audit events are present in this snapshot.</span></td></tr>`;
  return records.map((record) => `<tr>
    <td>${escapeOpsHtml(asString(record.occurredAt) ? formatOpsTime(asString(record.occurredAt)) : "Unknown")}</td>
    <td><span class="ops-mono">${escapeOpsHtml(asString(record.actor) || "System")}</span></td>
    <td>${escapeOpsHtml(asString(record.action))}</td>
    <td>${escapeOpsHtml([asString(record.targetKind), asString(record.targetId)].filter(Boolean).join(":"))}</td>
    <td class="ops-mono">${escapeOpsHtml(asString(record.metadataJson) || "{}")}</td>
  </tr>`).join("");
}

function reportWaypointLabel(detail: Pick<OpsReportRecord, "waypointId" | "waypointRouteOrder" | "waypointName">): string {
  if (detail.waypointRouteOrder !== null && detail.waypointName) {
    return stopLabel(detail.waypointRouteOrder, detail.waypointName);
  }
  return detail.waypointId === "Not specified" ? "Stop not specified" : "Stop details unavailable";
}

function reportCoordinateLabel(detail: OpsReportDetail): string {
  return detail.latitude === null || detail.longitude === null
    ? "No submitted GPS coordinates"
    : `${detail.latitude}, ${detail.longitude}`;
}

export function renderReportPrivateDetail(detail: OpsReportDetail): string {
  const account = detail.hunterSubject
    ? detail.publicAttribution === "Young Hunter"
      ? "Signed-in minor account; guardian permission recorded"
      : detail.publicationEligible
        ? "Signed-in adult account"
        : "Signed-in Hunter; publication eligibility needs attention"
    : "Report submitted without a Hunter account";
  return `<dl class="ops-report-facts">
    <div><dt>Reference</dt><dd class="ops-mono">${escapeOpsHtml(detail.id)}</dd></div>
    <div><dt>Type</dt><dd>${escapeOpsHtml(detail.type)}</dd></div>
    <div><dt>Received</dt><dd>${escapeOpsHtml(formatOpsTime(detail.createdAt))}</dd></div>
    <div><dt>Updated</dt><dd>${escapeOpsHtml(detail.updatedAt ? formatOpsTime(detail.updatedAt) : "Not supplied")}</dd></div>
    <div><dt>Current state</dt><dd>${escapeOpsHtml(detail.status)}</dd></div>
    <div><dt>Public Case Note</dt><dd>${escapeOpsHtml(detail.caseNote.published ? "Published" : "Not published")}</dd></div>
    <div><dt>Official Update</dt><dd>${escapeOpsHtml(
      detail.publication.status === "scheduled" && detail.publication.scheduledFor
        ? `${detail.publication.published ? "Live" : "Scheduled"} for ${formatOpsTime(detail.publication.scheduledFor)}`
        : detail.publication.status
          ? detail.publication.status[0]!.toUpperCase() + detail.publication.status.slice(1)
          : "No draft"
    )}</dd></div>
    <div><dt>Reporter name</dt><dd>${escapeOpsHtml(detail.name)}</dd></div>
    <div><dt>Email</dt><dd class="ops-mono">${escapeOpsHtml(detail.email)}</dd></div>
    <div><dt>Phone</dt><dd class="ops-mono">${escapeOpsHtml(detail.phone ?? "Not supplied")}</dd></div>
    <div><dt>Hunter / account</dt><dd>${escapeOpsHtml(account)}</dd></div>
    <div><dt>Waypoint</dt><dd>${escapeOpsHtml(reportWaypointLabel(detail))}</dd></div>
    <div><dt>Location description</dt><dd>${escapeOpsHtml(detail.locationDescription || "Not supplied")}</dd></div>
    <div><dt>Submitted GPS</dt><dd class="ops-mono">${escapeOpsHtml(reportCoordinateLabel(detail))}</dd></div>
    <div><dt>Assigned operator</dt><dd>${escapeOpsHtml(detail.assignedTo ?? "Unassigned")}</dd></div>
  </dl><section class="ops-report-story" aria-labelledby="report-private-story-title"><h4 id="report-private-story-title">Full private report</h4><p>${escapeOpsHtml(detail.details)}</p></section>`;
}

export function reportReviewControls(detail: OpsReportDetail): {
  showUnpublish: boolean;
  terminalTransitionsBlocked: boolean;
  guidance: string;
} {
  const published = detail.publication.published;
  const hasActiveUpdate = detail.publication.status !== null && detail.publication.status !== "withdrawn";
  return {
    showUnpublish: hasActiveUpdate,
    terminalTransitionsBlocked: published,
    guidance: published
      ? "Unpublish first before rejecting or resolving this private report."
      : "",
  };
}

export function renderReportEvidence(detail: OpsReportDetail): string {
  if (detail.media.length === 0) {
    return `<p class="ops-report-evidence__empty">No evidence images were submitted.</p>`;
  }
  return detail.media.map((media, index) => {
    const ready = media.status === "ready" && ["image/jpeg", "image/png", "image/webp"].includes(media.contentType);
    return `<article class="ops-report-evidence__item">
      ${ready ? `<img data-report-media-preview data-media-id="${escapeOpsHtml(media.id)}" alt="Private processed evidence ${index + 1}" hidden /><div class="ops-report-evidence__placeholder" data-report-media-placeholder>Loading private preview&hellip;</div>` : `<div class="ops-report-evidence__placeholder" aria-hidden="true">Image unavailable</div>`}
      <div><strong>Evidence ${index + 1}</strong><span>${escapeOpsHtml(media.contentType)} &middot; ${escapeOpsHtml(media.size)} bytes</span></div>
      ${ready
        ? `<label><input type="checkbox" name="publishMedia" value="${escapeOpsHtml(media.id)}" disabled /> Publish this image</label>`
        : `<span class="ops-report-evidence__status">${escapeOpsHtml(media.status === "processing" ? "Processing; unavailable for publication" : `${media.status}; unavailable for publication`)}</span>`}
    </article>`;
  }).join("");
}

export function renderReportPublicationPreview(
  detail: OpsReportDetail,
  draft: { title: string; body: string; publisherName?: string | null }
): string {
  const title = draft.title.trim() || "Public headline preview";
  const body = draft.body.trim() || "The operator-edited public story will appear here.";
  const attribution = draft.publisherName?.trim() || detail.publicAttribution;
  const attributionLabel = detail.publicationEligible && attribution
    ? attribution
    : "Not eligible for publication";
  return `<article class="ops-report-public-card" data-public-preview>
    <p class="ops-kicker">Approved hunter report</p>
    <h4>${escapeOpsHtml(title)}</h4>
    <p>${escapeOpsHtml(body)}</p>
    <dl><div><dt>Hunter</dt><dd>${escapeOpsHtml(attributionLabel)}</dd></div><div><dt>Waypoint</dt><dd>${escapeOpsHtml(reportWaypointLabel(detail))}</dd></div><div><dt>GPS</dt><dd class="ops-mono">${escapeOpsHtml(reportCoordinateLabel(detail))}</dd></div></dl>
  </article>`;
}

const sponsorStateLabel = (state: OpsSponsorState): string => ({
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  accepted: "Accepted",
  closed: "Closed"
})[state];

const sponsorSupportLabel = (supportType: OpsSponsorSupportType): string => ({
  community: "Community",
  lead: "Lead",
  prize_in_kind: "Prize / in-kind",
  other: "Other"
})[supportType];

export function renderSponsorRows(records: readonly OpsSponsorRecord[]): string {
  if (records.length === 0) return `<tr><td colspan="7"><span class="ops-table-empty">No sponsor inquiries match these filters.</span></td></tr>`;
  return records.map((record) => {
    const id = escapeOpsHtml(record.id);
    const options = sponsorStates.map((state) => `<option value="${escapeOpsHtml(state)}"${state === record.state ? " selected" : ""}>${escapeOpsHtml(sponsorStateLabel(state))}</option>`).join("");
    return `<tr>
      <td><time datetime="${escapeOpsHtml(record.createdAt)}">${escapeOpsHtml(formatOpsTime(record.createdAt))}</time></td>
      <td><span class="ops-mono">${escapeOpsHtml(record.referenceCode)}</span></td>
      <td><strong>${escapeOpsHtml(record.organization)}</strong><details class="ops-sponsor-detail"><summary>Inquiry details</summary><p>${escapeOpsHtml(record.desiredOutcome || "No desired outcome supplied")}</p><small>Acknowledgement ${escapeOpsHtml(record.acknowledgementVersion || "not recorded")}</small></details></td>
      <td><strong>${escapeOpsHtml(record.contactName)}</strong><br /><span class="ops-mono">${escapeOpsHtml(record.email)}</span>${record.phone ? `<br /><span class="ops-mono">${escapeOpsHtml(record.phone)}</span>` : ""}</td>
      <td>${escapeOpsHtml(sponsorSupportLabel(record.supportType))}<br /><span class="ops-mono">${escapeOpsHtml(record.contributionRange || "Range not supplied")}</span></td>
      <td><span class="ops-chip ops-sponsor-state" data-state="${escapeOpsHtml(record.state)}">${escapeOpsHtml(sponsorStateLabel(record.state))}</span></td>
      <td><div class="ops-sponsor-action"><label for="sponsor-state-${id}">Change state</label><select id="sponsor-state-${id}" data-sponsor-next-state="${id}">${options}</select><button class="ops-button ops-button--quiet" type="button" data-sponsor-id="${id}" data-sponsor-current-state="${escapeOpsHtml(record.state)}">Apply state</button></div></td>
    </tr>`;
  }).join("");
}

export function renderModerationRows(records: readonly OpsModerationRecord[]): string {
  if (records.length === 0) return `<tr><td colspan="6"><span class="ops-table-empty">No Field Notes are awaiting moderation.</span></td></tr>`;
  return records.map((record) => {
    const media = record.media.length === 0
      ? `${escapeOpsHtml(record.mediaCount)} ${record.mediaCount === 1 ? "image" : "images"}`
      : `<details class="ops-note-media"><summary>${escapeOpsHtml(record.mediaCount)} ${record.mediaCount === 1 ? "image" : "images"}</summary>${record.media.map((item) => {
          const selectable = item.status === "ready";
          const size = `${(item.size / 1_000_000).toFixed(item.size >= 1_000_000 ? 1 : 2)} MB`;
          return `<div class="ops-note-media__item" data-note-media-state="${escapeOpsHtml(item.status)}">
            <span>${escapeOpsHtml(item.status === "ready" ? "Ready" : item.status)} &middot; ${escapeOpsHtml(size)}</span>
            ${selectable ? `<button class="ops-button ops-button--quiet" type="button" data-note-media-preview="${escapeOpsHtml(item.id)}" data-note-id="${escapeOpsHtml(record.id)}">Preview</button>` : ""}
            <label><input type="checkbox" name="publicMedia" value="${escapeOpsHtml(item.id)}"${selectable ? "" : " disabled"}> Select for a later public post</label>
          </div>`;
        }).join("")}</details>`;
    return `<tr>
    <td><time datetime="${escapeOpsHtml(record.createdAt)}">${escapeOpsHtml(formatOpsTime(record.createdAt))}</time></td>
    <td>${escapeOpsHtml(record.authorHandle)}</td>
    <td>${escapeOpsHtml(reportWaypointLabel(record))}</td>
    <td>${media}</td>
    <td>${escapeOpsHtml(record.body.slice(0, 150))}${record.body.length > 150 ? "&hellip;" : ""}</td>
    <td><div class="ops-row-actions"><button class="ops-button ops-button--quiet" type="button" data-moderation-id="${escapeOpsHtml(record.id)}" data-moderation-decision="approved">Approve</button><button class="ops-button ops-button--danger" type="button" data-moderation-id="${escapeOpsHtml(record.id)}" data-moderation-decision="rejected">Reject</button></div></td>
  </tr>`;
  }).join("");
}

export function renderModerationReplyRows(records: readonly OpsModerationReply[]): string {
  if (records.length === 0) return `<tr><td colspan="7"><span class="ops-table-empty">No public replies are awaiting review.</span></td></tr>`;
  return records.map((record) => {
    const action = record.status === "published" ? "hide" : "restore";
    const label = action === "hide" ? "Hide" : "Restore";
    return `<tr>
      <td><time datetime="${escapeOpsHtml(record.createdAt)}">${escapeOpsHtml(formatOpsTime(record.createdAt))}</time></td>
      <td>${escapeOpsHtml(record.authorHandle)}</td>
      <td>${escapeOpsHtml(moderationWaypointLabel(record))}</td>
      <td>${escapeOpsHtml(record.body)}</td>
      <td><span class="ops-chip">${escapeOpsHtml(record.status)}</span></td>
      <td>${escapeOpsHtml(record.flagCount)} open ${record.flagCount === 1 ? "flag" : "flags"}</td>
      <td><button class="ops-button ops-moderation-action${action === "hide" ? " ops-moderation-action--hide" : " ops-button--quiet"}" type="button" data-reply-moderation-id="${escapeOpsHtml(record.id)}" data-reply-moderation-action="${action}">${label}</button></td>
    </tr>`;
  }).join("");
}

export function renderContentFlagRows(records: readonly OpsContentFlag[]): string {
  if (records.length === 0) return `<tr><td colspan="7"><span class="ops-table-empty">No received reply flags require review.</span></td></tr>`;
  return records.map((record) => `<tr>
    <td><time datetime="${escapeOpsHtml(record.createdAt)}">${escapeOpsHtml(formatOpsTime(record.createdAt))}</time></td>
    <td>${escapeOpsHtml(record.authorHandle)}</td>
    <td>${escapeOpsHtml(moderationWaypointLabel(record))}</td>
    <td>${escapeOpsHtml(record.targetExcerpt)}</td>
    <td>${escapeOpsHtml(record.reason)}</td>
    <td><span class="ops-chip">${escapeOpsHtml(record.status)}</span></td>
    <td><div class="ops-row-actions"><button class="ops-button ops-moderation-action ops-moderation-action--hide" type="button" data-flag-moderation-id="${escapeOpsHtml(record.id)}" data-flag-moderation-action="hide_target">Hide reply</button><button class="ops-button ops-button--quiet ops-moderation-action" type="button" data-flag-moderation-id="${escapeOpsHtml(record.id)}" data-flag-moderation-action="dismiss">Dismiss</button></div></td>
  </tr>`).join("");
}

function moderationWaypointLabel(record: Pick<OpsModerationReply | OpsContentFlag, "waypointRouteOrder" | "waypointName">): string {
  if (record.waypointRouteOrder !== null && record.waypointName) return `Stop ${String(record.waypointRouteOrder).padStart(2, "0")} · ${record.waypointName}`;
  return "Public Case Note";
}

export function renderReportUpdateUploads(detail: OpsReportDetail): string {
  if (detail.publication.uploads.length === 0) {
    return `<p class="ops-report-evidence__empty">No direct Update images uploaded.</p>`;
  }
  return detail.publication.uploads.map((upload, index) => {
    const ready = upload.status === "ready" && ["image/jpeg", "image/png", "image/webp"].includes(upload.contentType);
    const selected = detail.publication.mediaIds.includes(upload.id);
    const fieldSuffix = escapeOpsHtml(upload.id);
    return `<article class="ops-report-evidence__item">
      ${ready ? `<img data-update-media-preview data-media-id="${escapeOpsHtml(upload.id)}" alt="Private Update image ${index + 1}" hidden /><div class="ops-report-evidence__placeholder" data-report-media-placeholder>Loading private preview&hellip;</div>` : `<div class="ops-report-evidence__placeholder" aria-hidden="true">Image processing</div>`}
      <div><strong>Update image ${index + 1}</strong><span>${escapeOpsHtml(upload.contentType)} &middot; ${escapeOpsHtml(upload.size)} bytes &middot; ${escapeOpsHtml(upload.status)}</span></div>
      ${ready
        ? `<label><input type="checkbox" name="publishMedia" value="${fieldSuffix}" data-update-upload-select ${selected ? "checked" : ""} disabled /> Publish this image</label>
          <label for="media-alt-${fieldSuffix}">Alt text <span class="ops-required">required when selected</span></label>
          <input id="media-alt-${fieldSuffix}" name="mediaAltText-${fieldSuffix}" data-update-media-alt="${fieldSuffix}" type="text" maxlength="200" value="${escapeOpsHtml(upload.altText ?? "")}" required ${selected ? "" : "disabled"} />
          <label for="media-caption-${fieldSuffix}">Caption <span class="ops-optional">optional</span></label>
          <textarea id="media-caption-${fieldSuffix}" name="mediaCaption-${fieldSuffix}" data-update-media-caption="${fieldSuffix}" rows="2" maxlength="500" ${selected ? "" : "disabled"}>${escapeOpsHtml(upload.caption ?? "")}</textarea>`
        : `<span class="ops-report-evidence__status">${escapeOpsHtml(upload.status === "processing" ? "Processing; refresh shortly" : `${upload.status}; unavailable for publication`)}</span>`}
    </article>`;
  }).join("");
}

export function reportDestinationControls(detail: OpsReportDetail): {
  caseNotePublished: boolean;
  showPublishCaseNote: boolean;
  showWithdrawCaseNote: boolean;
  updatePublished: boolean;
} {
  return {
    caseNotePublished: detail.caseNote.published,
    showPublishCaseNote: !detail.caseNote.published,
    showWithdrawCaseNote: detail.caseNote.published,
    updatePublished: detail.publication.published,
  };
}

const reportStateLabel = (state: string): string => ({
  received: "Received",
  reviewing: "Reviewing",
  contacted: "Contacted",
  escalated: "Escalated",
  verified: "Verified",
  rejected: "Rejected",
  resolved: "Resolved",
})[state] ?? state;

export function renderReportState(
  detail: Pick<OpsReportDetail, "status" | "assignedTo">,
): string {
  return `<strong>Status: ${escapeOpsHtml(reportStateLabel(detail.status))}</strong><span>Assigned to: ${escapeOpsHtml(detail.assignedTo ?? "Unassigned")}</span>`;
}

export function renderAuditRows(records: readonly OpsAuditRecord[]): string {
  if (records.length === 0) return `<tr><td colspan="5"><span class="ops-table-empty">No audit events are available from the source.</span></td></tr>`;
  return records.map((record) => `<tr>
    <td><time datetime="${escapeOpsHtml(record.createdAt)}">${escapeOpsHtml(formatOpsTime(record.createdAt))}</time></td>
    <td>${escapeOpsHtml(record.actor)}</td><td>${escapeOpsHtml(record.action)}</td><td>${escapeOpsHtml(record.target)}</td><td>${escapeOpsHtml(record.result)}</td>
  </tr>`).join("");
}

export function resolveOpsView(value: string, allowProductionSnapshot = true): OpsView {
  const normalized = value.replace(/^#/, "").toLowerCase();
  if (normalized === "production-snapshot" && !allowProductionSnapshot) return "command";
  return views.includes(normalized as OpsView) ? normalized as OpsView : "command";
}

function setProductionSnapshotAvailability(environment: string): void {
  productionSnapshotAvailable = environment === "validation";
  const navigation = document.querySelector<HTMLButtonElement>('[data-view="production-snapshot"]');
  if (navigation) navigation.hidden = !productionSnapshotAvailable;
  if (!productionSnapshotAvailable && location.hash.toLowerCase() === "#production-snapshot") {
    history.replaceState(null, "", "#command");
  }
}

export function buildStatusMutation(
  input: { state: string; reason: string; reportId: string; nextClue: string; nextClueAt: string; hoursOpen: string; hoursClose: string; confirmed: boolean },
  version: number,
): Record<string, unknown> {
  return {
    state: input.state,
    version,
    confirmFound: input.state === "found" && input.confirmed,
    ...(input.reportId ? { reportId: input.reportId } : {}),
    ...(input.reason ? { adjudicationReason: input.reason } : {}),
    ...(input.nextClue ? { nextClueTitle: input.nextClue } : {}),
    ...(input.nextClueAt ? { nextClueAt: input.nextClueAt } : {}),
    ...(input.hoursOpen ? { hoursOpen: input.hoursOpen } : {}),
    ...(input.hoursClose ? { hoursClose: input.hoursClose } : {}),
  };
}

export function buildUpdateMutation(input: { title: string; body: string; publishAt: string }): Record<string, unknown> {
  return {
    title: input.title,
    body: input.body,
    ...(input.publishAt ? { scheduledFor: input.publishAt } : {}),
  };
}

function identityError(error: unknown, fallback: string): string {
  if (isRecord(error) && Array.isArray(error.errors)) {
    const first = error.errors[0];
    if (isRecord(first)) return asString(first.longMessage) || asString(first.message) || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function apiError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : payload;
  return asString(error.message) || fallback;
}

async function opsHeaders(base?: HeadersInit): Promise<Headers> {
  const headers = new Headers(base);
  const token = await staffClerk?.session?.getToken().catch(() => null);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function opsRequest(url: string, init: RequestInit = {}): Promise<{ response: Response; payload: unknown }> {
  const headers = await opsHeaders(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const payload: unknown = await response.json().catch(() => null);
  return { response, payload };
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function setMetric(selector: string, value: number | null): void {
  setText(selector, value === null ? "--" : String(value));
}

function setTable(selector: string, rows: string): void {
  const body = document.querySelector<HTMLElement>(selector);
  if (body) body.innerHTML = rows;
}

function setConnection(state: "checking" | "online" | "offline", message: string): void {
  const element = document.querySelector<HTMLElement>("#ops-connection");
  if (!element) return;
  element.dataset.state = state;
  element.innerHTML = `<span aria-hidden="true"></span>${escapeOpsHtml(message)}`;
}

function showPageError(message: string): void {
  const error = document.querySelector<HTMLElement>("#ops-page-error");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function switchView(view: OpsView, focus = true): void {
  view = resolveOpsView(`#${view}`, productionSnapshotAvailable);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-view-panel]")) {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  }
  document.querySelector("#ops-navigation")?.classList.remove("is-open");
  document.querySelector("#ops-menu")?.setAttribute("aria-expanded", "false");
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  if (focus) document.querySelector<HTMLElement>("#ops-main")?.focus();
  if (view === "sponsors" && !sponsorsLoaded) void loadSponsors();
  if (view === "subscribers" && !subscribersLoaded && !subscribersLoading) void loadSubscribers();
  if (view === "production-snapshot" && !productionSnapshotLoaded && !productionSnapshotLoading) {
    void loadProductionSnapshot();
  }
}

function renderDashboard(dashboard: OpsDashboard): void {
  latestDashboard = dashboard;
  if (dashboard.status) {
    const labels: Record<string, string> = { open: "CASE OPEN", paused: "HUNT PAUSED", found: "CASE FOUND" };
    const label = labels[dashboard.status.state] ?? dashboard.status.state.toUpperCase();
    setText("#metric-status", label);
    setText("#metric-status-time", formatOpsTime(dashboard.status.updatedAt));
    setText("#case-status-chip", label);
    setText("#command-updated", `Source updated ${formatOpsTime(dashboard.status.updatedAt)}`);
    const select = document.querySelector<HTMLSelectElement>("#case-status-select");
    if (select) select.value = dashboard.status.state;
  } else {
    setText("#metric-status", "UNAVAILABLE");
    setText("#metric-status-time", "No verified source");
    setText("#case-status-chip", "Unavailable");
    setText("#command-updated", "Awaiting a verified source timestamp");
  }
  setMetric("#metric-reports", dashboard.counts.receivedReports);
  setMetric("#metric-moderation", dashboard.counts.pendingNotes);
  setMetric("#metric-hunters", dashboard.counts.activeHunters);
  setMetric("#nav-report-count", dashboard.counts.receivedReports);
  setMetric("#nav-moderation-count", dashboard.counts.pendingNotes);

  const attention = document.querySelector<HTMLElement>("#command-attention");
  if (attention) {
    const pending = (dashboard.counts.receivedReports ?? 0) + (dashboard.counts.pendingNotes ?? 0) + (dashboard.counts.receivedFlags ?? 0);
    if (dashboard.counts.receivedReports === null && dashboard.counts.pendingNotes === null) {
      attention.innerHTML = `<strong>Queue totals unavailable</strong><span>No assumption has been made about pending work.</span>`;
    } else if (pending === 0) {
      attention.innerHTML = `<strong>No queued decisions</strong><span>The verified source reports no pending notes, reports or flags.</span>`;
    } else {
      attention.innerHTML = `<strong>${escapeOpsHtml(pending)} items need attention</strong><span>${escapeOpsHtml(dashboard.counts.receivedReports ?? 0)} private reports, ${escapeOpsHtml(dashboard.counts.pendingNotes ?? 0)} Field Notes and ${escapeOpsHtml(dashboard.counts.receivedFlags ?? 0)} flags.</span>`;
    }
  }

  const switches = document.querySelector<HTMLElement>("#kill-switches");
  if (switches && dashboard.killSwitches) {
    const entries: Array<[string, boolean, string]> = [
      ["Board visibility", dashboard.killSwitches.boardVisible, "Public reading"],
      ["Field Note submissions", dashboard.killSwitches.notesEnabled, "Pre-moderated posts"],
      ["Replies", dashboard.killSwitches.repliesEnabled, "Immediate constrained replies"],
    ];
    switches.innerHTML = entries.map(([label, enabled, detail]) => `<div class="ops-switch"><span><strong>${escapeOpsHtml(label)}</strong><small>${escapeOpsHtml(detail)}</small></span><button class="ops-button ops-button--quiet" type="button" disabled aria-label="${escapeOpsHtml(label)} is ${enabled ? "enabled" : "disabled"}">${enabled ? "Enabled" : "Disabled"}</button></div>`).join("");
  } else if (switches) {
    switches.innerHTML = `<div class="ops-empty"><strong>Control state unavailable</strong><span>No switches can be changed until the source confirms their current state.</span></div>`;
  }
}

async function loadDashboard(): Promise<void> {
  setConnection("checking", "Refreshing source");
  showPageError("");
  try {
    const { response, payload } = await opsRequest("/api/v1/ops/dashboard");
    if (!response.ok) throw new Error(apiError(payload, "The case-room source is unavailable."));
    renderDashboard(normalizeOpsDashboard(payload));
    setConnection("online", "Verified source online");
  } catch (error) {
    renderDashboard(normalizeOpsDashboard(null));
    setConnection("offline", "Source unavailable");
    showPageError(error instanceof Error ? error.message : "The case-room source is unavailable.");
  }
}

async function loadReports(): Promise<void> {
  try {
    const { response, payload } = await opsRequest("/api/v1/ops/reports");
    if (!response.ok) throw new Error(apiError(payload, "Private reports are unavailable."));
    setTable("#reports-table", renderReportRows(normalizeReports(payload)));
  } catch {
    setTable("#reports-table", `<tr><td colspan="6"><span class="ops-table-empty">Private reports are unavailable from the source.</span></td></tr>`);
  }
}

function setProductionSnapshotState(message: string, kind: "normal" | "error" = "normal"): void {
  const state = document.querySelector<HTMLElement>("#production-snapshot-state");
  if (!state) return;
  state.textContent = message;
  if (kind === "error") state.dataset.kind = "error";
  else delete state.dataset.kind;
}

async function loadProductionSnapshot(): Promise<void> {
  if (productionSnapshotLoading) return;
  productionSnapshotLoading = true;
  const panel = document.querySelector<HTMLElement>('[data-view-panel="production-snapshot"]');
  panel?.setAttribute("aria-busy", "true");
  setProductionSnapshotState("Loading the latest verified production snapshot...");
  try {
    const [summaryResponse, reportsResponse, playersResponse, staffResponse, auditResponse] = await Promise.all([
      opsRequest("/api/v1/ops/production-snapshot"),
      opsRequest("/api/v1/ops/production-snapshot/reports?limit=50"),
      opsRequest("/api/v1/ops/production-snapshot/players?limit=50"),
      opsRequest("/api/v1/ops/production-snapshot/staff"),
      opsRequest("/api/v1/ops/production-snapshot/audit?limit=50"),
    ]);
    const failed = [summaryResponse, reportsResponse, playersResponse, staffResponse, auditResponse]
      .find(({ response }) => !response.ok);
    if (failed) throw new Error(apiError(failed.payload, "The production snapshot is unavailable."));
    const summary = normalizeProductionSnapshotSummary(summaryResponse.payload);
    if (!summary) throw new Error("The production snapshot verification record is incomplete.");
    setText("#production-snapshot-verified", formatOpsTime(summary.verifiedAt));
    setText("#production-snapshot-id", summary.snapshotId);
    setMetric("#production-snapshot-report-count", summary.counts.reports);
    setMetric("#production-snapshot-player-count", summary.counts.players);
    setMetric("#production-snapshot-staff-count", summary.counts.staff);
    setMetric("#production-snapshot-media-count", summary.counts.media);
    setTable("#production-snapshot-reports", renderProductionSnapshotReportRows(normalizeProductionSnapshotReports(reportsResponse.payload)));
    setTable("#production-snapshot-players", renderProductionSnapshotPlayerRows(snapshotRecords(playersResponse.payload)));
    setTable("#production-snapshot-staff", renderProductionSnapshotStaffRows(snapshotRecords(staffResponse.payload)));
    setTable("#production-snapshot-audit", renderProductionSnapshotAuditRows(snapshotRecords(auditResponse.payload)));
    productionSnapshotLoaded = true;
    setProductionSnapshotState(`Verified production snapshot loaded from ${formatOpsTime(summary.verifiedAt)}. This workspace is read-only.`);
  } catch (error) {
    productionSnapshotLoaded = false;
    for (const [selector, columns] of [
      ["#production-snapshot-reports", 6],
      ["#production-snapshot-players", 6],
      ["#production-snapshot-staff", 4],
      ["#production-snapshot-audit", 5],
    ] as const) {
      setTable(selector, `<tr><td colspan="${columns}"><span class="ops-table-empty">Production snapshot unavailable.</span></td></tr>`);
    }
    setProductionSnapshotState(error instanceof Error ? error.message : "The production snapshot is unavailable.", "error");
  } finally {
    productionSnapshotLoading = false;
    panel?.removeAttribute("aria-busy");
  }
}

function snapshotFact(label: string, value: unknown, mono = false): string {
  return `<div><dt>${escapeOpsHtml(label)}</dt><dd${mono ? ' class="ops-mono"' : ""}>${escapeOpsHtml(value || "Not supplied")}</dd></div>`;
}

function renderProductionSnapshotReportDetail(record: Record<string, unknown>): string {
  const waypoint = asNumber(record.waypointRouteOrder) !== null && asString(record.waypointName)
    ? `Waypoint ${asNumber(record.waypointRouteOrder)} — ${asString(record.waypointName)}`
    : "Not specified";
  const coordinates = finiteNumber(record.latitude) !== null && finiteNumber(record.longitude) !== null
    ? `${finiteNumber(record.latitude)}, ${finiteNumber(record.longitude)}`
    : "Not supplied";
  return `<dl class="ops-report-facts">
    ${snapshotFact("Reference", asString(record.id), true)}
    ${snapshotFact("Type", asString(record.reportType))}
    ${snapshotFact("Reporter name", asString(record.reporterName))}
    ${snapshotFact("Email", asString(record.reporterEmail), true)}
    ${snapshotFact("Phone", asString(record.reporterPhone) || "Not supplied", true)}
    ${snapshotFact("Account subject", asString(record.hunterSubject) || "Not signed in", true)}
    ${snapshotFact("Participation basis", asString(record.participationBasis) || "Not recorded")}
    ${snapshotFact("Waypoint", waypoint)}
    ${snapshotFact("Submitted GPS", coordinates, true)}
    ${snapshotFact("Location description", asString(record.locationDescription))}
    ${snapshotFact("Current state", asString(record.status))}
    ${snapshotFact("Received", asString(record.createdAt) ? formatOpsTime(asString(record.createdAt)) : "Not supplied")}
  </dl><div class="ops-report-story"><h4>Submitted account</h4><p>${escapeOpsHtml(asString(record.details) || "No details supplied")}</p></div>`;
}

function revokeProductionSnapshotObjectUrls(): void {
  for (const url of productionSnapshotObjectUrls) URL.revokeObjectURL(url);
  productionSnapshotObjectUrls = [];
}

async function hydrateProductionSnapshotEvidence(
  reportId: string,
  media: readonly Record<string, unknown>[],
  signal: AbortSignal
): Promise<void> {
  const output = document.querySelector<HTMLElement>("[data-production-snapshot-report-evidence]");
  if (!output) return;
  const ready = media.filter((item) => asString(item.status) === "ready" && asString(item.id));
  output.innerHTML = ready.length
    ? ready.map((item) => `<article class="ops-report-evidence__item"><div class="ops-report-evidence__placeholder" data-production-snapshot-media="${escapeOpsHtml(asString(item.id))}">Loading image...</div><span>${escapeOpsHtml(asString(item.contentType))} · ${escapeOpsHtml(asNumber(item.byteSize) ?? 0)} bytes</span></article>`).join("")
    : `<p class="ops-report-evidence__empty">No ready private evidence is present in this snapshot.</p>`;
  await Promise.all(ready.map(async (item) => {
    const mediaId = asString(item.id);
    const target = output.querySelector<HTMLElement>(`[data-production-snapshot-media="${CSS.escape(mediaId)}"]`);
    if (!target) return;
    try {
      const headers = await opsHeaders();
      const response = await fetch(
        `/api/v1/ops/production-snapshot/reports/${encodeURIComponent(reportId)}/media/${encodeURIComponent(mediaId)}`,
        { headers, credentials: "same-origin", cache: "no-store", signal }
      );
      if (!response.ok) throw new Error();
      const objectUrl = URL.createObjectURL(await response.blob());
      if (signal.aborted || !target.isConnected) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      productionSnapshotObjectUrls.push(objectUrl);
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = "Private report evidence from the read-only production snapshot";
      target.replaceWith(image);
    } catch {
      if (!signal.aborted) target.textContent = "Private image unavailable.";
    }
  }));
}

async function openProductionSnapshotReport(reportId: string, trigger: HTMLButtonElement): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("#production-snapshot-report-dialog");
  const detail = dialog?.querySelector<HTMLElement>("[data-production-snapshot-report-detail]");
  const evidence = dialog?.querySelector<HTMLElement>("[data-production-snapshot-report-evidence]");
  const state = dialog?.querySelector<HTMLElement>("#production-snapshot-report-state");
  if (!dialog || !detail || !evidence || !state) return;
  productionSnapshotAbortController?.abort();
  productionSnapshotAbortController = new AbortController();
  const signal = productionSnapshotAbortController.signal;
  productionSnapshotTrigger = trigger;
  revokeProductionSnapshotObjectUrls();
  detail.replaceChildren();
  evidence.replaceChildren();
  state.textContent = "Loading the mirrored report...";
  if (!dialog.open) dialog.showModal();
  try {
    const { response, payload } = await opsRequest(
      `/api/v1/ops/production-snapshot/reports/${encodeURIComponent(reportId)}`,
      { signal }
    );
    if (!response.ok) throw new Error(apiError(payload, "The snapshot report is unavailable."));
    const record = envelopeData(payload);
    if (!isRecord(record) || asString(record.id) !== reportId) throw new Error("The snapshot report response was incomplete.");
    if (signal.aborted) return;
    detail.innerHTML = renderProductionSnapshotReportDetail(record);
    const media = asArray(record.media).filter(isRecord);
    state.textContent = "Read-only mirrored report loaded.";
    await hydrateProductionSnapshotEvidence(reportId, media, signal);
  } catch (error) {
    if (!signal.aborted) {
      state.textContent = error instanceof Error ? error.message : "The snapshot report is unavailable.";
      state.dataset.kind = "error";
    }
  }
}

function renderProductionSnapshotWaiver(record: Record<string, unknown>): string {
  const participants = asArray(record.participants).filter(isRecord);
  return `<dl class="ops-legal-summary">
    ${snapshotFact("Acceptance", asString(record.id), true)}
    ${snapshotFact("Subject", asString(record.subject), true)}
    ${snapshotFact("Document version", asString(record.documentVersion))}
    ${snapshotFact("Document hash", asString(record.documentHash), true)}
    ${snapshotFact("Action", asString(record.action))}
    ${snapshotFact("Accepted", asString(record.acceptedAt) ? formatOpsTime(asString(record.acceptedAt)) : "Not supplied")}
  </dl><section class="ops-legal-participants"><h3>Covered participants</h3><ul>${participants.map((participant) => `<li><strong>${escapeOpsHtml(asString(participant.fullName))}</strong> — ${escapeOpsHtml(asString(participant.role))}${asNumber(participant.birthYear) === null ? "" : `, born ${escapeOpsHtml(asNumber(participant.birthYear))}`}</li>`).join("") || "<li>No participant rows found.</li>"}</ul></section>`;
}

async function openProductionSnapshotWaiver(subject: string, trigger: HTMLButtonElement): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("#production-snapshot-waiver-dialog");
  const output = dialog?.querySelector<HTMLElement>("[data-production-snapshot-waiver-detail]");
  const state = dialog?.querySelector<HTMLElement>("#production-snapshot-waiver-state");
  if (!dialog || !output || !state) return;
  productionSnapshotTrigger = trigger;
  output.replaceChildren();
  state.textContent = "Loading the mirrored legal record...";
  if (!dialog.open) dialog.showModal();
  try {
    const { response, payload } = await opsRequest(`/api/v1/ops/production-snapshot/players/${encodeURIComponent(subject)}/waiver`);
    if (!response.ok) throw new Error(apiError(payload, "The snapshot waiver is unavailable."));
    const record = envelopeData(payload);
    if (!isRecord(record) || asString(record.subject) !== subject) throw new Error("The snapshot waiver response was incomplete.");
    output.innerHTML = renderProductionSnapshotWaiver(record);
    state.textContent = "Read-only mirrored legal record loaded.";
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : "The snapshot waiver is unavailable.";
    state.dataset.kind = "error";
  }
}

function setReportReviewState(message: string, kind: "normal" | "error" = "normal"): void {
  const state = document.querySelector<HTMLElement>("#report-review-state");
  if (!state) return;
  state.textContent = message;
  state.dataset.kind = kind;
}

function reportPublicationResult(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#report-publication-result");
}

function setReportPublicationResult(message: string, kind: "normal" | "error" = "normal"): void {
  const result = reportPublicationResult();
  if (!result) return;
  result.replaceChildren(document.createTextNode(message));
  result.dataset.kind = kind;
  if (kind === "error") result.focus({ preventScroll: true });
}

function revokeReportEvidenceUrls(): void {
  for (const url of reportEvidenceObjectUrls) URL.revokeObjectURL(url);
  reportEvidenceObjectUrls = [];
}

function reportReviewIsLive(
  intent: ReportReviewIntent | null,
  dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]")
): intent is ReportReviewIntent {
  return Boolean(
    dialog?.open &&
    intent &&
    reportReviewGuard.isCurrent(intent) &&
    dialog.dataset.reportId === intent.reportId
  );
}

function beginReportReview(reportId: string): { intent: ReportReviewIntent; signal: AbortSignal } {
  reportReviewAbortController?.abort();
  reportReviewAbortController = new AbortController();
  return {
    intent: reportReviewGuard.begin(reportId),
    signal: reportReviewAbortController.signal,
  };
}

function closeReportReview(): void {
  reportReviewGuard.close();
  reportReviewAbortController?.abort();
  reportReviewAbortController = null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function reportSelectedMediaIds(): string[] {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  if (!dialog) return [];
  return [...dialog.querySelectorAll<HTMLInputElement>('input[name="publishMedia"]:checked')]
    .map((input) => input.value);
}

function reportSelectedReportMediaIds(): string[] {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  if (!dialog) return [];
  return [...dialog.querySelectorAll<HTMLInputElement>('[data-report-evidence] input[name="publishMedia"]:checked')]
    .map((input) => input.value);
}

function reportSelectedMediaSelections(): Array<{
  id: string;
  altText: string | null;
  caption: string | null;
}> {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  if (!dialog) return [];
  return [...dialog.querySelectorAll<HTMLInputElement>('input[name="publishMedia"]:checked')]
    .map((input) => {
      const id = input.value;
      const item = input.closest<HTMLElement>(".ops-report-evidence__item");
      const altText = item?.querySelector<HTMLInputElement>("[data-update-media-alt]")?.value.trim() || null;
      const caption = item?.querySelector<HTMLTextAreaElement>("[data-update-media-caption]")?.value.trim() || null;
      return { id, altText, caption };
    });
}

function updateReportPublicationPreview(publisherName?: string | null): void {
  if (!activeReportDetail) return;
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  const preview = dialog?.querySelector<HTMLElement>("[data-report-public-preview]");
  const title = dialog?.querySelector<HTMLInputElement>('[data-report-publication-form] [name="title"]')?.value ?? "";
  const body = dialog?.querySelector<HTMLTextAreaElement>('[data-report-publication-form] [name="body"]')?.value ?? "";
  if (!dialog || !preview) return;
  preview.innerHTML = renderReportPublicationPreview(activeReportDetail, {
    title,
    body,
    ...(publisherName === undefined ? {} : { publisherName })
  });
  const selected = reportSelectedMediaIds();
  if (selected.length === 0) return;
  const gallery = document.createElement("div");
  gallery.className = "ops-report-public-card__media";
  gallery.setAttribute("aria-label", `${selected.length} selected public ${selected.length === 1 ? "image" : "images"}`);
  for (const mediaId of selected) {
    const source = dialog.querySelector<HTMLImageElement>(
      `[data-report-media-preview][data-media-id="${CSS.escape(mediaId)}"], [data-update-media-preview][data-media-id="${CSS.escape(mediaId)}"]`
    );
    if (!source?.src || source.hidden) continue;
    const image = document.createElement("img");
    image.src = source.src;
    image.alt = dialog.querySelector<HTMLInputElement>(`[data-update-media-alt="${CSS.escape(mediaId)}"]`)?.value.trim()
      || `Selected public evidence for ${title.trim() || "this report"}`;
    gallery.append(image);
  }
  preview.querySelector("[data-public-preview]")?.append(gallery);
}

async function hydrateReportEvidence(
  detail: OpsReportDetail,
  intent: ReportReviewIntent,
  signal: AbortSignal
): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  if (!dialog || !reportReviewIsLive(intent, dialog)) return;
  const previews = [...dialog.querySelectorAll<HTMLImageElement>("[data-report-media-preview], [data-update-media-preview]")];
  await Promise.all(previews.map(async (image) => {
    const mediaId = image.dataset.mediaId;
    const item = image.closest<HTMLElement>(".ops-report-evidence__item");
    const placeholder = item?.querySelector<HTMLElement>("[data-report-media-placeholder]");
    const checkbox = item?.querySelector<HTMLInputElement>('input[name="publishMedia"]');
    if (!mediaId || !item || !placeholder || !checkbox) return;
    try {
      const headers = await opsHeaders();
      if (!reportReviewIsLive(intent, dialog) || signal.aborted) return;
      const isUpdateUpload = image.hasAttribute("data-update-media-preview");
      const response = await fetch(
        isUpdateUpload
          ? `/api/v1/ops/reports/${encodeURIComponent(detail.id)}/update-media/${encodeURIComponent(mediaId)}`
          : `/api/v1/ops/reports/${encodeURIComponent(detail.id)}/media/${encodeURIComponent(mediaId)}`,
        { headers, credentials: "same-origin", cache: "no-store", signal }
      );
      if (!reportReviewIsLive(intent, dialog) || signal.aborted) return;
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
      if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        throw new Error("Private evidence preview is unavailable.");
      }
      const blob = await response.blob();
      if (
        !reportReviewIsLive(intent, dialog) || signal.aborted ||
        activeReportDetail?.id !== detail.id || !image.isConnected
      ) return;
      const objectUrl = URL.createObjectURL(blob);
      reportEvidenceObjectUrls.push(objectUrl);
      image.src = objectUrl;
      image.hidden = false;
      let trigger = image.parentElement instanceof HTMLAnchorElement ? image.parentElement : null;
      if (!trigger) {
        trigger = document.createElement("a");
        trigger.className = "approved-media-trigger";
        trigger.target = "_blank";
        trigger.rel = "noopener";
        trigger.referrerPolicy = "no-referrer";
        trigger.setAttribute("data-approved-media", "");
        image.before(trigger);
        trigger.append(image);
      }
      trigger.href = objectUrl;
      trigger.dataset.mediaCaption = image.alt;
      placeholder.hidden = true;
      checkbox.disabled = !detail.publicationEligible;
      for (const field of item.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "[data-update-media-alt], [data-update-media-caption]"
      )) {
        field.disabled = !detail.publicationEligible || !checkbox.checked;
      }
    } catch (error) {
      if (!reportReviewIsLive(intent, dialog) || signal.aborted || isAbortError(error)) return;
      image.removeAttribute("src");
      image.hidden = true;
      placeholder.textContent = "Private evidence preview unavailable";
      checkbox.checked = false;
      checkbox.disabled = true;
    }
  }));
  if (!reportReviewIsLive(intent, dialog) || signal.aborted) return;
  updateReportPublicationPreview();
}

function reportDraft(): {
  title: string;
  body: string;
  scheduledFor: string;
  confirmed: boolean;
  mediaIds: string[];
  mediaSelections: ReturnType<typeof reportSelectedMediaSelections>;
} {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  return {
    title: dialog?.querySelector<HTMLInputElement>('[data-report-publication-form] [name="title"]')?.value ?? "",
    body: dialog?.querySelector<HTMLTextAreaElement>('[data-report-publication-form] [name="body"]')?.value ?? "",
    scheduledFor: dialog?.querySelector<HTMLInputElement>('[data-report-publication-form] [name="scheduledFor"]')?.value ?? "",
    confirmed: dialog?.querySelector<HTMLInputElement>('[data-report-publication-form] [name="confirmPublication"]')?.checked ?? false,
    mediaIds: reportSelectedMediaIds(),
    mediaSelections: reportSelectedMediaSelections(),
  };
}

function renderReportDialog(
  detail: OpsReportDetail,
  intent: ReportReviewIntent,
  signal: AbortSignal,
  draft?: ReturnType<typeof reportDraft>
): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  const privateOutput = dialog?.querySelector<HTMLElement>("[data-report-private-detail]");
  const evidenceOutput = dialog?.querySelector<HTMLElement>("[data-report-evidence]");
  const updateUploadsOutput = dialog?.querySelector<HTMLElement>("[data-report-update-uploads]");
  const form = dialog?.querySelector<HTMLFormElement>("[data-report-publication-form]");
  if (
    !dialog || !privateOutput || !evidenceOutput || !updateUploadsOutput || !form || signal.aborted ||
    detail.id !== intent.reportId || !reportReviewIsLive(intent, dialog)
  ) return;
  revokeReportEvidenceUrls();
  activeReportDetail = detail;
  privateOutput.innerHTML = renderReportPrivateDetail(detail);
  evidenceOutput.innerHTML = renderReportEvidence(detail);
  updateUploadsOutput.innerHTML = renderReportUpdateUploads(detail);
  evidenceOutput.setAttribute("data-media-gallery", "");
  evidenceOutput.dataset.mediaGalleryTitle = "Submitted report evidence";
  updateUploadsOutput.setAttribute("data-media-gallery", "");
  updateUploadsOutput.dataset.mediaGalleryTitle = "Direct Official Update images";

  const title = form.elements.namedItem("title");
  const body = form.elements.namedItem("body");
  const scheduledFor = form.elements.namedItem("scheduledFor");
  const confirmation = form.elements.namedItem("confirmPublication");
  if (title instanceof HTMLInputElement) {
    title.value = draft?.title ?? detail.publication.title ?? "";
    title.disabled = !detail.publicationEligible;
  }
  if (body instanceof HTMLTextAreaElement) {
    body.value = draft?.body ?? detail.publication.body ?? "";
    body.disabled = !detail.publicationEligible;
  }
  if (confirmation instanceof HTMLInputElement) {
    confirmation.checked = draft?.confirmed ?? false;
    confirmation.disabled = !detail.publicationEligible;
  }
  for (const checkbox of dialog.querySelectorAll<HTMLInputElement>('input[name="publishMedia"]')) {
    checkbox.checked = draft?.mediaIds.includes(checkbox.value) ?? detail.publication.mediaIds.includes(checkbox.value);
    const draftSelection = draft?.mediaSelections.find((selection) => selection.id === checkbox.value);
    const item = checkbox.closest<HTMLElement>(".ops-report-evidence__item");
    const altText = item?.querySelector<HTMLInputElement>("[data-update-media-alt]");
    const caption = item?.querySelector<HTMLTextAreaElement>("[data-update-media-caption]");
    if (altText) {
      if (draftSelection) altText.value = draftSelection.altText ?? "";
      altText.disabled = !checkbox.checked;
    }
    if (caption) {
      if (draftSelection) caption.value = draftSelection.caption ?? "";
      caption.disabled = !checkbox.checked;
    }
  }

  const controls = reportReviewControls(detail);
  const stateSummary = dialog.querySelector<HTMLElement>("[data-report-state-summary]");
  const begin = dialog.querySelector<HTMLButtonElement>("[data-report-begin-review]");
  const status = dialog.querySelector<HTMLSelectElement>("[data-report-next-status]");
  const saveStatus = dialog.querySelector<HTMLButtonElement>("[data-report-save-status]");
  const saveDraft = dialog.querySelector<HTMLButtonElement>("[data-report-save-draft]");
  const schedule = dialog.querySelector<HTMLButtonElement>("[data-report-schedule]");
  const publish = dialog.querySelector<HTMLButtonElement>("[data-report-publish]");
  const unpublish = dialog.querySelector<HTMLButtonElement>("[data-report-unpublish]");
  const publishCaseNote = dialog.querySelector<HTMLButtonElement>("[data-report-publish-case-note]");
  const withdrawCaseNote = dialog.querySelector<HTMLButtonElement>("[data-report-withdraw-case-note]");
  if (stateSummary) stateSummary.innerHTML = renderReportState(detail);
  const transitions = nextReportStates(detail.status);
  const selectableTransitions = detail.status === "received"
    ? transitions.filter((state) => state !== "reviewing")
    : transitions;
  if (begin) {
    begin.hidden = detail.status !== "received";
    begin.disabled = !transitions.includes("reviewing");
  }
  const updateFiles = form.querySelector<HTMLInputElement>("[data-report-update-files]");
  const uploadUpdateImages = form.querySelector<HTMLButtonElement>("[data-report-upload-update-images]");
  const canUploadUpdateMedia = detail.publicationEligible && Boolean(detail.publication.updateId);
  if (updateFiles) updateFiles.disabled = !canUploadUpdateMedia;
  if (uploadUpdateImages) uploadUpdateImages.disabled = !canUploadUpdateMedia;
  if (scheduledFor instanceof HTMLInputElement) {
    scheduledFor.value = draft?.scheduledFor ?? (
      detail.publication.scheduledFor
        ? new Date(detail.publication.scheduledFor).toISOString().slice(0, 16)
        : ""
    );
    scheduledFor.disabled = !detail.publicationEligible;
  }
  if (status) {
    status.replaceChildren(...selectableTransitions.map((nextState) => {
      const option = document.createElement("option");
      option.value = nextState;
      option.textContent = reportStateLabel(nextState);
      return option;
    }));
    status.hidden = selectableTransitions.length === 0;
    status.disabled = selectableTransitions.length === 0;
    for (const option of [...status.options]) {
      option.disabled = controls.terminalTransitionsBlocked && ["rejected", "resolved"].includes(option.value);
    }
  }
  if (saveStatus) {
    saveStatus.hidden = selectableTransitions.length === 0;
    saveStatus.disabled = selectableTransitions.length === 0 ||
      (controls.terminalTransitionsBlocked && ["rejected", "resolved"].includes(status?.value ?? ""));
  }
  if (publish) {
    publish.disabled = !detail.publicationEligible || detail.status !== "verified";
    publish.textContent = detail.publication.published ? "Update live Official Update" : "Publish Official Update now";
  }
  if (saveDraft) saveDraft.disabled = !detail.publicationEligible;
  if (schedule) schedule.disabled = !detail.publicationEligible || detail.status !== "verified";
  if (unpublish) unpublish.hidden = !controls.showUnpublish;
  const destinations = reportDestinationControls(detail);
  if (publishCaseNote) {
    publishCaseNote.hidden = !destinations.showPublishCaseNote;
    publishCaseNote.disabled = !detail.publicationEligible;
  }
  if (withdrawCaseNote) withdrawCaseNote.hidden = !destinations.showWithdrawCaseNote;
  updateReportPublicationPreview();
  const eligibility = detail.publicationEligible
    ? "This report is eligible for a deliberate public preview and publication."
    : `Publication is blocked (${detail.publicationEligibilityReason.replaceAll("_", " ")}). Private review remains available.`;
  setReportReviewState(`Private report loaded. ${eligibility}${controls.guidance ? ` ${controls.guidance}` : ""}`);
  void hydrateReportEvidence(detail, intent, signal);
}

async function fetchReportDetail(reportId: string, signal: AbortSignal): Promise<OpsReportDetail> {
  const { response, payload } = await opsRequest(
    `/api/v1/ops/reports/${encodeURIComponent(reportId)}`,
    { signal }
  );
  if (!response.ok) throw new Error(apiError(payload, "The private report is unavailable."));
  const detail = normalizeOpsReportDetail(payload);
  if (!detail || detail.id !== reportId) throw new Error("The private report response was incomplete.");
  return detail;
}

async function openReportDetail(reportId: string, trigger: HTMLButtonElement): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  if (!dialog) return;
  const { intent, signal } = beginReportReview(reportId);
  reportReviewTrigger = trigger;
  activeReportDetail = null;
  dialog.dataset.reportId = reportId;
  dialog.querySelector<HTMLElement>("[data-report-private-detail]")?.replaceChildren();
  dialog.querySelector<HTMLElement>("[data-report-evidence]")?.replaceChildren();
  dialog.querySelector<HTMLElement>("[data-report-public-preview]")?.replaceChildren();
  const form = dialog.querySelector<HTMLFormElement>("[data-report-publication-form]");
  form?.reset();
  for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("[data-report-status-actions] button, [data-report-status-actions] select, [data-report-publication-form] input, [data-report-publication-form] textarea, [data-report-publication-form] button")) {
    control.disabled = true;
  }
  const unpublish = dialog.querySelector<HTMLButtonElement>("[data-report-unpublish]");
  if (unpublish) unpublish.hidden = true;
  const withdrawCaseNote = dialog.querySelector<HTMLButtonElement>("[data-report-withdraw-case-note]");
  if (withdrawCaseNote) withdrawCaseNote.hidden = true;
  setReportPublicationResult("");
  setReportReviewState("Loading the selected private report and audited evidence controls...");
  if (!dialog.open) dialog.showModal();
  try {
    const detail = await fetchReportDetail(reportId, signal);
    if (!reportReviewIsLive(intent, dialog) || signal.aborted) return;
    renderReportDialog(detail, intent, signal);
  } catch (error) {
    if (!reportReviewIsLive(intent, dialog) || signal.aborted || isAbortError(error)) return;
    setReportReviewState(error instanceof Error ? error.message : "The private report is unavailable.", "error");
  }
}

async function refreshActiveReportDetail(intent = reportReviewGuard.capture()): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  const signal = reportReviewAbortController?.signal;
  if (!intent || !signal || !activeReportDetail || !reportReviewIsLive(intent, dialog)) return;
  const reportId = intent.reportId;
  const draft = reportDraft();
  const detail = await fetchReportDetail(reportId, signal);
  if (!reportReviewIsLive(intent, dialog) || signal.aborted) return;
  renderReportDialog(detail, intent, signal, draft);
}

async function updateActiveReportStatus(status: string): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  const intent = reportReviewGuard.capture();
  const signal = reportReviewAbortController?.signal;
  if (
    !intent || !signal || !activeReportDetail || activeReportDetail.id !== intent.reportId ||
    !reportReviewIsLive(intent, dialog) ||
    !nextReportStates(activeReportDetail.status).includes(status as ReportReviewState)
  ) return;
  const reportId = intent.reportId;
  if (activeReportDetail.publication.published && ["rejected", "resolved"].includes(status)) {
    setReportReviewState("Unpublish first before rejecting or resolving this private report.", "error");
    return;
  }
  const note = status === "reviewing"
    ? "Review opened in the private case room"
    : window.prompt("Add an optional private note for this status change:", "");
  if (
    note === null || !window.confirm(`Change this private report to ${status}? This action is audited.`) ||
    !reportReviewIsLive(intent, dialog) || signal.aborted
  ) return;
  setReportReviewState(`Saving private ${status} state...`);
  try {
    const { response, payload } = await opsRequest(`/api/v1/ops/reports/${encodeURIComponent(reportId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note: note.trim() || undefined }),
      signal,
    });
    if (!reportReviewIsLive(intent, dialog) || signal.aborted) return;
    if (!response.ok) throw new Error(apiError(payload, "The report state was not changed."));
    await Promise.all([refreshActiveReportDetail(intent), loadReports(), loadDashboard(), loadAudit()]);
  } catch (error) {
    if (!reportReviewIsLive(intent, dialog) || signal.aborted || isAbortError(error)) return;
    setReportReviewState(error instanceof Error ? error.message : "The report state was not changed.", "error");
  }
}

async function loadModeration(): Promise<void> {
  await Promise.allSettled([loadModerationNotes(), loadModerationReplies(), loadContentFlags()]);
}

async function loadModerationNotes(): Promise<void> {
  try {
    const { response, payload } = await opsRequest("/api/v1/ops/moderation/notes");
    if (!response.ok) throw new Error(apiError(payload, "The moderation queue is unavailable."));
    setTable("#moderation-table", renderModerationRows(normalizeModeration(payload)));
  } catch {
    setTable("#moderation-table", `<tr><td colspan="6"><span class="ops-table-empty">The moderation queue is unavailable from the source.</span></td></tr>`);
  }
}

function moderationNextCursor(payload: unknown): string | null {
  const page = isRecord(payload) && isRecord(payload.page) ? payload.page : {};
  return asString(page.nextCursor).trim() || null;
}

function setModerationState(selector: "#moderation-replies-state" | "#moderation-flags-state", message: string, kind: "normal" | "error" = "normal"): void {
  const state = document.querySelector<HTMLElement>(selector);
  if (!state) return;
  state.textContent = message;
  if (kind === "error") state.dataset.kind = "error";
  else delete state.dataset.kind;
}

function repliesPager(): ModerationPaginationController<OpsModerationReply> {
  return moderationRepliesController ??= createModerationPaginationController({
    endpoint: "/api/v1/ops/moderation/replies",
    tableSelector: "#moderation-replies-table", stateSelector: "#moderation-replies-state", loadMoreSelector: "#moderation-replies-load-more",
    document, request: opsRequest, normalize: normalizeModerationReplies, render: renderModerationReplyRows,
    unavailableRows: `<tr><td colspan="7"><span class="ops-table-empty">The public replies queue is unavailable from the source.</span></td></tr>`,
    loadedMessage: (records, more) => records.length === 0
      ? "Public replies loaded. No reply action is currently needed."
      : `${records.length} public ${records.length === 1 ? "reply" : "replies"} loaded for review.${more ? " More older replies are available." : " End of reply queue."}`,
  });
}

function flagsPager(): ModerationPaginationController<OpsContentFlag> {
  return moderationFlagsController ??= createModerationPaginationController({
    endpoint: "/api/v1/ops/moderation/flags",
    tableSelector: "#moderation-flags-table", stateSelector: "#moderation-flags-state", loadMoreSelector: "#moderation-flags-load-more",
    document, request: opsRequest, normalize: normalizeContentFlags, render: renderContentFlagRows,
    unavailableRows: `<tr><td colspan="7"><span class="ops-table-empty">The received flags queue is unavailable from the source.</span></td></tr>`,
    loadedMessage: (records, more) => records.length === 0
      ? "Received flags loaded. No flag action is currently needed."
      : `${records.length} received ${records.length === 1 ? "flag" : "flags"} loaded for review.${more ? " More older flags are available." : " End of flag queue."}`,
  });
}

async function loadModerationReplies(append = false): Promise<ModerationLoadOutcome> {
  return append ? repliesPager().loadMore() : repliesPager().refresh();
}

async function loadContentFlags(append = false): Promise<ModerationLoadOutcome> {
  return append ? flagsPager().loadMore() : flagsPager().refresh();
}

function setSponsorsState(message: string, kind: "normal" | "error" = "normal"): void {
  const state = document.querySelector<HTMLElement>("#sponsors-state");
  if (!state) return;
  state.textContent = message;
  if (kind === "error") state.dataset.kind = "error";
  else delete state.dataset.kind;
}

function sponsorFilters(): URLSearchParams {
  const params = new URLSearchParams({ limit: "50" });
  const state = document.querySelector<HTMLSelectElement>("#sponsor-state-filter")?.value ?? "";
  const supportType = document.querySelector<HTMLSelectElement>("#sponsor-support-filter")?.value ?? "";
  const query = document.querySelector<HTMLInputElement>("#sponsor-search")?.value.trim() ?? "";
  if (state) params.set("state", state);
  if (supportType) params.set("supportType", supportType);
  if (query) params.set("q", query.slice(0, 100));
  return params;
}

async function loadSponsors(): Promise<void> {
  const version = ++sponsorLoadVersion;
  const panel = document.querySelector<HTMLElement>('[data-view-panel="sponsors"]');
  panel?.setAttribute("aria-busy", "true");
  setSponsorsState(sponsorsLoaded ? "Refreshing private sponsor inquiries..." : "Loading private sponsor inquiries...");
  if (!sponsorsLoaded) {
    setTable("#sponsors-table", `<tr><td colspan="7"><span class="ops-table-empty">Loading authorized sponsor inquiries...</span></td></tr>`);
  }
  try {
    const { response, payload } = await opsRequest(`/api/v1/ops/sponsors?${sponsorFilters().toString()}`);
    if (version !== sponsorLoadVersion) return;
    if (!response.ok) throw new Error(apiError(payload, "The sponsor ledger is unavailable."));
    const ledger = normalizeOpsSponsors(payload);
    sponsorsLoaded = true;
    setTable("#sponsors-table", renderSponsorRows(ledger.items));
    sponsorMetricValues(ledger).forEach((count, index) => {
      setMetric(`#sponsor-${visibleSponsorMetricStates[index]}-count`, count);
    });
    const pageNote = ledger.nextCursor ? " More matching records are available; narrow the filters to review them." : "";
    const totalsAvailable = sponsorStates.every((state) => ledger.counts[state] !== null);
    setSponsorsState(
      `${ledger.items.length} private sponsor ${ledger.items.length === 1 ? "inquiry" : "inquiries"} loaded.${pageNote}${totalsAvailable ? "" : " Workflow totals are unavailable."}`,
      totalsAvailable ? "normal" : "error"
    );
  } catch (error) {
    if (version !== sponsorLoadVersion) return;
    setTable("#sponsors-table", `<tr><td colspan="7"><span class="ops-table-empty">The private sponsor ledger is unavailable from the source.</span></td></tr>`);
    for (const state of visibleSponsorMetricStates) setMetric(`#sponsor-${state}-count`, null);
    setSponsorsState(error instanceof Error ? error.message : "The sponsor ledger is unavailable.", "error");
  } finally {
    if (version === sponsorLoadVersion) panel?.removeAttribute("aria-busy");
  }
}

async function loadStaff(): Promise<void> {
  try {
    const { response, payload } = await opsRequest("/api/v1/ops/staff");
    if (!response.ok) throw new Error(apiError(payload, "Staff access records are unavailable."));
    setTable("#staff-table", renderStaffRows(normalizeOpsStaff(payload)));
  } catch {
    setTable("#staff-table", `<tr><td colspan="6"><span class="ops-table-empty">Staff access records are unavailable from the private source.</span></td></tr>`);
  }
}

async function loadAudit(): Promise<void> {
  try {
    const { response, payload } = await opsRequest("/api/v1/ops/audit");
    if (!response.ok) throw new Error(apiError(payload, "The audit trail is unavailable."));
    setTable("#audit-table", renderAuditRows(normalizeAudit(payload)));
  } catch {
    setTable("#audit-table", `<tr><td colspan="5"><span class="ops-table-empty">The audit trail is unavailable from the source.</span></td></tr>`);
  }
}

function privateModerationReason(): string | null {
  const entered = window.prompt("Record a private reason for this audited action:", "");
  if (entered === null) return null;
  const reason = entered.trim();
  if (reason.length < 3 || reason.length > 500) return "";
  return reason;
}

async function refreshModerationAfterMutation(
  stateSelector: "#moderation-replies-state" | "#moderation-flags-state",
  message: string,
): Promise<void> {
  const [repliesOutcome, flagsOutcome] = await Promise.all([
    loadModerationReplies(),
    loadContentFlags(),
    loadDashboard(),
    loadAudit(),
  ]);
  const targetOutcome = stateSelector === "#moderation-replies-state" ? repliesOutcome : flagsOutcome;
  const notice = moderationMutationRefreshNotice(message, targetOutcome);
  setModerationState(stateSelector, notice.message, notice.kind);
  document.querySelector<HTMLElement>(stateSelector)?.focus();
}

async function moderateReplyFromButton(button: HTMLButtonElement): Promise<void> {
  const id = button.dataset.replyModerationId;
  const action = button.dataset.replyModerationAction;
  if (!id || (action !== "hide" && action !== "restore")) return;
  const reason = privateModerationReason();
  if (reason === null) return;
  if (!reason) {
    setModerationState("#moderation-replies-state", "Enter a private reason between 3 and 500 characters before continuing.", "error");
    button.focus();
    return;
  }
  if (action === "hide" && !window.confirm("Hide this public reply? This action is reversible and audited.")) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  try {
    const { response, payload } = await opsRequest(`/api/v1/ops/moderation/replies/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    if (!response.ok) throw new Error(apiError(payload, "The reply was not changed."));
    await refreshModerationAfterMutation("#moderation-replies-state", action === "hide" ? "Reply hidden. The action is audited and can be restored." : "Reply restored. The action is audited.");
  } catch (error) {
    setModerationState("#moderation-replies-state", error instanceof Error ? error.message : "The reply was not changed.", "error");
    button.disabled = false;
    button.textContent = originalLabel;
    button.focus();
  }
}

async function moderateFlagFromButton(button: HTMLButtonElement): Promise<void> {
  const id = button.dataset.flagModerationId;
  const action = button.dataset.flagModerationAction;
  if (!id || (action !== "dismiss" && action !== "hide_target")) return;
  const reason = privateModerationReason();
  if (reason === null) return;
  if (!reason) {
    setModerationState("#moderation-flags-state", "Enter a private reason between 3 and 500 characters before continuing.", "error");
    button.focus();
    return;
  }
  if (action === "hide_target" && !window.confirm("Hide this public reply? This action is reversible and audited.")) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  try {
    const { response, payload } = await opsRequest(`/api/v1/ops/moderation/flags/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    if (!response.ok) throw new Error(apiError(payload, "The flag was not changed."));
    await refreshModerationAfterMutation("#moderation-flags-state", action === "hide_target" ? "Reply hidden and its received flags resolved. The action is audited." : "Flag dismissed. The action is audited.");
  } catch (error) {
    setModerationState("#moderation-flags-state", error instanceof Error ? error.message : "The flag was not changed.", "error");
    button.disabled = false;
    button.textContent = originalLabel;
    button.focus();
  }
}

function setSubscriberState(message: string, kind: "normal" | "error" = "normal"): void {
  const state = document.querySelector<HTMLElement>("#subscribers-state");
  if (!state) return;
  state.textContent = message;
  if (kind === "error") state.dataset.kind = "error";
  else delete state.dataset.kind;
}

async function loadSubscribers(append = false): Promise<void> {
  if (subscribersLoading || (append && !subscriberNextCursor)) return;
  subscribersLoading = true;
  const exportButton = document.querySelector<HTMLButtonElement>("#subscriber-export");
  const loadMore = document.querySelector<HTMLButtonElement>("#subscriber-load-more");
  const loadedCount = document.querySelector<HTMLElement>("#subscriber-loaded-count");
  if (loadMore) loadMore.disabled = true;
  if (!subscribersLoaded) {
    setSubscriberState("Loading the authorized player ledger...");
    setTable("#subscribers-table", `<tr><td colspan="9"><span class="ops-table-empty">Loading authorized player records...</span></td></tr>`);
  } else {
    setSubscriberState(append ? "Loading more authorized player records..." : "Refreshing the authorized player ledger...");
  }
  const cursor = append && subscriberNextCursor ? `&cursor=${encodeURIComponent(subscriberNextCursor)}` : "";
  try {
    const { response, payload } = await opsRequest(`/api/v1/ops/players?limit=100${cursor}`);
    if (!response.ok) throw new Error(apiError(payload, "The player ledger is unavailable."));
    const ledger = normalizeOpsSubscribers(payload);
    if (append) {
      const deduplicated = new Map(loadedSubscribers.map((item) => [item.verifiedEmail.toLowerCase(), item]));
      for (const item of ledger.items) deduplicated.set(item.verifiedEmail.toLowerCase(), item);
      loadedSubscribers = [...deduplicated.values()];
    } else {
      loadedSubscribers = ledger.items;
    }
    subscriberNextCursor = ledger.nextCursor;
    subscribersLoaded = true;
    setMetric("#subscriber-accounts", ledger.counts.verifiedAccounts);
    setMetric("#subscriber-profiles", ledger.counts.completedProfiles);
    setMetric("#subscriber-hunt", ledger.counts.huntEmail);
    setMetric("#subscriber-marketing", ledger.counts.marketing);
    setTable("#subscribers-table", renderSubscriberRows(loadedSubscribers));
    setSubscriberState(loadedSubscribers.length === 0
      ? "The authorized ledger loaded successfully and currently contains no player records."
      : `${loadedSubscribers.length} authorized player ${loadedSubscribers.length === 1 ? "record is" : "records are"} loaded in this browser session.`);
    if (exportButton) exportButton.disabled = loadedSubscribers.length === 0;
    if (loadMore) {
      loadMore.hidden = subscriberNextCursor === null;
      loadMore.disabled = false;
    }
    if (loadedCount) loadedCount.textContent = `${loadedSubscribers.length} loaded${subscriberNextCursor ? "; more available" : "; end of ledger"}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The player ledger is unavailable.";
    if (subscribersLoaded) {
      setSubscriberState(`${detail} ${loadedSubscribers.length} previously loaded ${loadedSubscribers.length === 1 ? "record remains" : "records remain"} available; totals may be stale.`, "error");
      if (exportButton) exportButton.disabled = loadedSubscribers.length === 0;
      if (loadMore) {
        loadMore.hidden = subscriberNextCursor === null;
        loadMore.disabled = false;
      }
    } else {
      loadedSubscribers = [];
      subscriberNextCursor = null;
      setMetric("#subscriber-accounts", null);
      setMetric("#subscriber-profiles", null);
      setMetric("#subscriber-hunt", null);
      setMetric("#subscriber-marketing", null);
      setTable("#subscribers-table", `<tr><td colspan="9"><span class="ops-table-empty">The private player ledger is unavailable from the source.</span></td></tr>`);
      setSubscriberState(`${detail} No player data was loaded or exported.`, "error");
      if (exportButton) exportButton.disabled = true;
      if (loadMore) loadMore.hidden = true;
      if (loadedCount) loadedCount.textContent = "No player records loaded";
    }
  } finally {
    subscribersLoading = false;
  }
}

function setWaiverDetailState(message: string, kind: "normal" | "error" = "normal"): void {
  const state = document.querySelector<HTMLElement>("#waiver-detail-state");
  if (!state) return;
  state.textContent = message;
  state.dataset.kind = kind;
}

async function openWaiverDetail(subject: string): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("#ops-waiver-dialog");
  const output = dialog?.querySelector<HTMLElement>("[data-waiver-detail-output]");
  const retry = dialog?.querySelector<HTMLButtonElement>("[data-retry-waiver-receipt]");
  if (!dialog || !output || !retry) return;
  dialog.dataset.playerId = "";
  output.replaceChildren();
  retry.disabled = true;
  setWaiverDetailState("Loading the selected player's private legal record...");
  if (!dialog.open) dialog.showModal();
  try {
    const { response, payload } = await opsRequest(`/api/v1/ops/players/${encodeURIComponent(subject)}/waiver`);
    if (!response.ok) throw new Error(apiError(payload, "The legal record is unavailable."));
    const detail = normalizeOpsWaiverDetail(payload);
    if (!detail || detail.subject !== subject) throw new Error("The legal record response was incomplete.");
    output.innerHTML = renderOpsWaiverDetail(detail);
    dialog.dataset.playerId = subject;
    dialog.dataset.receiptStatus = detail.receipt.status;
    retry.disabled = false;
    setWaiverDetailState("Private legal record loaded for deliberate review.");
  } catch (error) {
    setWaiverDetailState(error instanceof Error ? error.message : "The legal record is unavailable.", "error");
  }
}

function exportLoadedSubscribers(): void {
  if (loadedSubscribers.length === 0) return;
  const csv = buildSubscriberCsv(loadedSubscribers);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `tim-lost-something-players-${new Date().toISOString().slice(0, 10)}.csv`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  setSubscriberState(`Exported ${loadedSubscribers.length} loaded subscriber ${loadedSubscribers.length === 1 ? "record" : "records"} to a local CSV.`);
}

async function activateAttempt(): Promise<boolean> {
  if (!staffClerk || !signInAttempt || signInAttempt.status !== "complete" || !signInAttempt.createdSessionId) return false;
  await staffClerk.setActive({ session: signInAttempt.createdSessionId });
  signInAttempt = null;
  return true;
}

type OpsAuthFormId = "ops-sign-in-form" | "ops-sign-up-form" | "ops-sign-up-verify-form" | "ops-second-factor-form" | "ops-recovery-form" | "ops-recovery-complete-form";

function showAuthForm(id: OpsAuthFormId): void {
  for (const formId of ["ops-sign-in-form", "ops-sign-up-form", "ops-sign-up-verify-form", "ops-second-factor-form", "ops-recovery-form", "ops-recovery-complete-form"]) {
    const form = document.querySelector<HTMLFormElement>(`#${formId}`);
    if (form) form.hidden = formId !== id;
  }
}

function setAuthMessage(message: string, state: "checking" | "ready" | "error"): void {
  const status = document.querySelector<HTMLElement>("#ops-auth-config");
  if (!status) return;
  status.dataset.state = state;
  status.textContent = message;
}

async function verifyStaffSession(): Promise<boolean> {
  const { response, payload } = await opsRequest("/api/v1/ops/session");
  if (!response.ok) return false;
  const data = envelopeData(payload);
  const operator = isRecord(data) && isRecord(data.operator) ? data.operator : isRecord(data) ? data : {};
  const name = asString(operator.displayName) || asString(operator.email) || "Operator";
  setText("#ops-operator-name", name);
  const initials = name.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "OP";
  setText(".ops-operator__initials", initials);
  document.querySelector<HTMLElement>("#ops-auth-panel")?.setAttribute("hidden", "");
  const app = document.querySelector<HTMLElement>("#ops-app");
  if (app) app.hidden = false;
  await Promise.all([loadDashboard(), loadReports(), loadModeration(), loadStaff(), loadAudit()]);
  switchView(resolveOpsView(location.hash, productionSnapshotAvailable), false);
  return true;
}

async function initialiseManagedIdentity(): Promise<void> {
  let publishableKey = document.querySelector<HTMLMetaElement>('meta[name="staff-clerk-publishable-key"]')?.content.trim() ?? "";
  try {
    const response = await fetch("/api/v1/config", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    const payload: unknown = response.ok ? await response.json() : null;
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    if (isRecord(data)) {
      publishableKey = asString(data.staffPublishableKey) || publishableKey;
      setProductionSnapshotAvailability(asString(data.deploymentEnvironment));
    }
  } catch {
    // The optional meta value remains a safe preview fallback.
  }
  if (!publishableKey) {
    setAuthMessage("Staff identity is not configured in this build. No password is accepted locally.", "error");
    document.querySelector<HTMLButtonElement>('#ops-sign-in-form button[type="submit"]')?.setAttribute("disabled", "");
    return;
  }
  try {
    const { Clerk: ClerkConstructor } = await import("@clerk/clerk-js");
    staffClerk = new ClerkConstructor(publishableKey);
    await staffClerk.load();
    if (staffClerk.user && await verifyStaffSession()) return;
    setAuthMessage("Managed staff identity is ready. Verified company-domain accounts can continue.", "ready");
  } catch (error) {
    setAuthMessage(identityError(error, "Staff identity could not be loaded."), "error");
  }
}

function setupAuthForms(): void {
  const signIn = document.querySelector<HTMLFormElement>("#ops-sign-in-form");
  const signUp = document.querySelector<HTMLFormElement>("#ops-sign-up-form");
  const signUpVerify = document.querySelector<HTMLFormElement>("#ops-sign-up-verify-form");
  const secondFactor = document.querySelector<HTMLFormElement>("#ops-second-factor-form");
  const recovery = document.querySelector<HTMLFormElement>("#ops-recovery-form");
  const recoveryComplete = document.querySelector<HTMLFormElement>("#ops-recovery-complete-form");
  if (!signIn || !signUp || !signUpVerify || !secondFactor || !recovery || !recoveryComplete) return;

  document.querySelector("#show-staff-sign-up")?.addEventListener("click", () => showAuthForm("ops-sign-up-form"));
  document.querySelector("#show-recovery")?.addEventListener("click", () => showAuthForm("ops-recovery-form"));
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-back-to-sign-in]")) {
    button.addEventListener("click", () => { signInAttempt = null; signUpAttempt = null; showAuthForm("ops-sign-in-form"); });
  }

  const runStaffSignUp = createSerializedSubmission(async () => {
    const client = staffClerk?.client;
    const submit = signUp.querySelector<HTMLButtonElement>('button[type="submit"]');
    const error = signUp.querySelector<HTMLElement>(".ops-form__error");
    const formData = new FormData(signUp);
    const emailAddress = asString(formData.get("email")).trim().toLowerCase();
    const password = asString(formData.get("password"));
    const confirmation = asString(formData.get("confirmPassword"));
    if (!client || !isAllowedStaffEmail(emailAddress) || password.length < 14 || password !== confirmation) {
      if (error) {
        error.hidden = false;
        error.textContent = "Use an approved company email and matching passwords of at least 14 characters.";
      }
      return;
    }
    const label = submit?.textContent ?? "Create staff account";
    if (submit) { submit.disabled = true; submit.textContent = "Sending code…"; }
    try {
      signUpAttempt = await client.signUp.create({ emailAddress, password });
      await signUpAttempt.prepareEmailAddressVerification({ strategy: "email_code" });
      showAuthForm("ops-sign-up-verify-form");
      setAuthMessage("Check your company email for one verification code.", "ready");
    } catch (caught) {
      if (error) { error.hidden = false; error.textContent = identityError(caught, "Staff account creation failed."); }
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = label; }
    }
  });

  signUp.addEventListener("submit", (event) => {
    event.preventDefault();
    void runStaffSignUp();
  });

  signUpVerify.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = asString(new FormData(signUpVerify).get("code")).trim();
    if (!signUpAttempt || !code || !staffClerk) {
      setAuthMessage("Enter the verification code from your company email.", "error");
      return;
    }
    try {
      signUpAttempt = await signUpAttempt.attemptEmailAddressVerification({ code });
      if (signUpAttempt.status !== "complete" || !signUpAttempt.createdSessionId) {
        throw new Error("Company email verification is not complete.");
      }
      await staffClerk.setActive({ session: signUpAttempt.createdSessionId });
      if (!await verifyStaffSession()) {
        await staffClerk.signOut();
        throw new Error("This verified address is not authorized for case-room access.");
      }
      signUpAttempt = null;
    } catch (caught) {
      setAuthMessage(identityError(caught, "Company email verification failed."), "error");
    }
  });

  signIn.addEventListener("submit", async (event) => {
    event.preventDefault();
    const client = staffClerk?.client;
    if (!client) return;
    const formData = new FormData(signIn);
    const identifier = asString(formData.get("email")).trim().toLowerCase();
    const password = asString(formData.get("password"));
    const error = signIn.querySelector<HTMLElement>(".ops-form__error");
    if (!identifier || password.length < 14) {
      if (error) { error.hidden = false; error.textContent = "Enter your invited email and a password of at least 14 characters."; }
      return;
    }
    try {
      signInAttempt = await client.signIn.create({ strategy: "password", identifier, password });
      if (await activateAttempt()) {
        if (!await verifyStaffSession()) throw new Error("This identity is not an active case-room operator.");
        return;
      }
      if (signInAttempt.status === "needs_second_factor") {
        showAuthForm("ops-second-factor-form");
        setAuthMessage("Password accepted. Complete your authenticator check.", "ready");
        return;
      }
      throw new Error("Additional identity verification is required. Use the managed recovery flow if you cannot continue.");
    } catch (caught) {
      if (error) { error.hidden = false; error.textContent = identityError(caught, "Sign-in failed."); }
    }
  });

  secondFactor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = asString(new FormData(secondFactor).get("code")).replace(/\s/g, "");
    if (!signInAttempt || !/^\d{6}$/.test(code)) {
      setAuthMessage("Enter the six-digit code from your authenticator app.", "error");
      return;
    }
    try {
      signInAttempt = await signInAttempt.attemptSecondFactor({ strategy: "totp", code });
      if (!await activateAttempt() || !await verifyStaffSession()) throw new Error("This identity is not an active case-room operator.");
    } catch (error) {
      setAuthMessage(identityError(error, "Authenticator verification failed."), "error");
    }
  });

  const runRecovery = createSerializedSubmission(async () => {
    const client = staffClerk?.client;
    if (!client) return;
    const submit = recovery.querySelector<HTMLButtonElement>('button[type="submit"]');
    const identifier = asString(new FormData(recovery).get("email")).trim().toLowerCase();
    const label = submit?.textContent ?? "Send verification code";
    if (submit) { submit.disabled = true; submit.textContent = "Sending code…"; }
    try {
      signInAttempt = await client.signIn.create({ strategy: "reset_password_email_code", identifier });
      const factor = signInAttempt.supportedFirstFactors?.find((item) => item.strategy === "reset_password_email_code");
      if (!factor || factor.strategy !== "reset_password_email_code") throw new Error("Email recovery is not available for this account.");
      signInAttempt = await signInAttempt.prepareFirstFactor({ strategy: "reset_password_email_code", emailAddressId: factor.emailAddressId });
      showAuthForm("ops-recovery-complete-form");
      setAuthMessage("If the staff account exists, its verification code has been sent.", "ready");
    } catch (error) {
      setAuthMessage(identityError(error, "Recovery could not be started."), "error");
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = label; }
    }
  });
  recovery.addEventListener("submit", (event) => {
    event.preventDefault();
    void runRecovery();
  });

  recoveryComplete.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(recoveryComplete);
    const code = asString(formData.get("code")).trim();
    const password = asString(formData.get("newPassword"));
    const confirmation = asString(formData.get("confirmPassword"));
    if (!signInAttempt || !code || password.length < 14 || password !== confirmation) {
      setAuthMessage("Enter the emailed code and matching passwords of at least 14 characters.", "error");
      return;
    }
    try {
      signInAttempt = await signInAttempt.attemptFirstFactor({ strategy: "reset_password_email_code", code });
      if (signInAttempt.status === "needs_new_password") {
        signInAttempt = await signInAttempt.resetPassword({ password, signOutOfOtherSessions: true });
      }
      if (!await activateAttempt() || !await verifyStaffSession()) throw new Error("This identity is not an active case-room operator.");
    } catch (error) {
      setAuthMessage(identityError(error, "Password recovery failed."), "error");
    }
  });
}

function setupWorkspace(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.addEventListener("click", () => switchView(resolveOpsView(button.dataset.view ?? "")));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-link]")) {
    button.addEventListener("click", () => switchView(resolveOpsView(button.dataset.viewLink ?? "")));
  }
  window.addEventListener("hashchange", () => switchView(resolveOpsView(location.hash), false));
  document.querySelector("#ops-menu")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const sidebar = document.querySelector("#ops-navigation");
    const open = !sidebar?.classList.contains("is-open");
    sidebar?.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
  });
  document.querySelector("#ops-refresh")?.addEventListener("click", () => void Promise.all([loadDashboard(), loadReports(), loadModeration(), loadStaff(), loadAudit(), ...(sponsorsLoaded ? [loadSponsors()] : []), ...(subscribersLoaded ? [loadSubscribers()] : []), ...(productionSnapshotLoaded ? [loadProductionSnapshot()] : [])]));
  document.querySelector("#refresh-reports")?.addEventListener("click", () => void loadReports());
  document.querySelector("#refresh-sponsors")?.addEventListener("click", () => void loadSponsors());
  document.querySelector("#sponsor-filters")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadSponsors();
  });
  document.querySelector("#sponsor-state-filter")?.addEventListener("change", () => void loadSponsors());
  document.querySelector("#sponsor-support-filter")?.addEventListener("change", () => void loadSponsors());
  document.querySelector("#subscriber-refresh")?.addEventListener("click", () => void loadSubscribers());
  document.querySelector("#subscriber-load-more")?.addEventListener("click", () => void loadSubscribers(true));
  document.querySelector("#subscriber-export")?.addEventListener("click", exportLoadedSubscribers);
  document.querySelector("#moderation-replies-load-more")?.addEventListener("click", () => void loadModerationReplies(true));
  document.querySelector("#moderation-flags-load-more")?.addEventListener("click", () => void loadContentFlags(true));
  document.querySelector("#moderation-replies-table")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-reply-moderation-id][data-reply-moderation-action]");
    if (button && !button.disabled) void moderateReplyFromButton(button);
  });
  document.querySelector("#moderation-flags-table")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-flag-moderation-id][data-flag-moderation-action]");
    if (button && !button.disabled) void moderateFlagFromButton(button);
  });

  document.querySelector("#production-snapshot-reports")?.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-production-snapshot-report-id]");
    const reportId = button?.dataset.productionSnapshotReportId;
    if (button && reportId) void openProductionSnapshotReport(reportId, button);
  });
  document.querySelector("#production-snapshot-players")?.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-production-snapshot-waiver-subject]");
    const subject = button?.dataset.productionSnapshotWaiverSubject;
    if (button && subject) void openProductionSnapshotWaiver(subject, button);
  });
  const snapshotReportDialog = document.querySelector<HTMLDialogElement>("#production-snapshot-report-dialog");
  snapshotReportDialog?.querySelector("[data-production-snapshot-report-close]")?.addEventListener("click", () => snapshotReportDialog.close());
  snapshotReportDialog?.addEventListener("close", () => {
    productionSnapshotAbortController?.abort();
    productionSnapshotAbortController = null;
    revokeProductionSnapshotObjectUrls();
    const trigger = productionSnapshotTrigger?.isConnected ? productionSnapshotTrigger : null;
    productionSnapshotTrigger = null;
    window.setTimeout(() => trigger?.focus(), 0);
  });
  const snapshotWaiverDialog = document.querySelector<HTMLDialogElement>("#production-snapshot-waiver-dialog");
  snapshotWaiverDialog?.querySelector("[data-production-snapshot-waiver-close]")?.addEventListener("click", () => snapshotWaiverDialog.close());
  snapshotWaiverDialog?.addEventListener("close", () => {
    const trigger = productionSnapshotTrigger?.isConnected ? productionSnapshotTrigger : null;
    productionSnapshotTrigger = null;
    window.setTimeout(() => trigger?.focus(), 0);
  });

  const statusForm = document.querySelector<HTMLFormElement>("#case-status-form");
  statusForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(statusForm);
    const state = asString(formData.get("state"));
    const reason = asString(formData.get("reason")).trim();
    const reportId = asString(formData.get("reportId")).trim();
    const nextClue = asString(formData.get("nextClue")).trim();
    const nextClueAt = asString(formData.get("nextClueAt"));
    const hoursOpen = asString(formData.get("hoursOpen"));
    const hoursClose = asString(formData.get("hoursClose"));
    const confirmed = formData.get("confirmed") === "on";
    const result = statusForm.querySelector<HTMLElement>(".ops-inline-result");
    if (!["open", "paused", "found"].includes(state) || !reason || !hoursOpen || !hoursClose || !confirmed) {
      if (result) result.textContent = "Choose a state, record the reason and hours, then confirm the official change.";
      return;
    }
    if (state === "found" && !reportId && reason.length < 20) {
      if (result) result.textContent = "FOUND needs a verified report reference or a specific adjudication reason.";
      return;
    }
    if (!window.confirm(`Publish ${state.toUpperCase()} as the official case state?`)) return;
    try {
      const version = latestDashboard?.status?.version ?? 0;
      const mutation = buildStatusMutation({ state, reason, reportId, nextClue, nextClueAt, hoursOpen, hoursClose, confirmed }, version);
      const { response, payload } = await opsRequest("/api/v1/ops/status", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
      if (!response.ok) throw new Error(apiError(payload, "Status was not changed."));
      if (result) result.textContent = "Official status published and audited.";
      statusForm.reset();
      await loadDashboard();
    } catch (error) {
      if (result) result.textContent = error instanceof Error ? error.message : "Status was not changed.";
    }
  });

  const updateForm = document.querySelector<HTMLFormElement>("#official-update-form");
  updateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(updateForm);
    const title = asString(formData.get("title")).trim();
    const body = asString(formData.get("body")).trim();
    const publishAt = asString(formData.get("publishAt"));
    const confirmed = formData.get("confirmed") === "on";
    const result = updateForm.querySelector<HTMLElement>(".ops-inline-result");
    if (!title || !body || !confirmed) {
      if (result) result.textContent = "Headline, update copy and privacy confirmation are required.";
      return;
    }
    try {
      const mutation = buildUpdateMutation({ title, body, publishAt });
      const { response, payload } = await opsRequest("/api/v1/ops/updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
      if (!response.ok) throw new Error(apiError(payload, "The official update was not saved."));
      if (result) result.textContent = publishAt ? "Official update scheduled and audited." : "Official update published and audited.";
      updateForm.reset();
    } catch (error) {
      if (result) result.textContent = error instanceof Error ? error.message : "The official update was not saved.";
    }
  });

  document.querySelector("#reports-table")?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-report-review][data-report-id]");
    if (!button?.dataset.reportId) return;
    await openReportDetail(button.dataset.reportId, button);
  });

  const reportDialog = document.querySelector<HTMLDialogElement>("[data-report-review-dialog]");
  reportDialog?.querySelector("[data-report-begin-review]")?.addEventListener("click", async () => {
    try {
      await updateActiveReportStatus("reviewing");
    } catch (error) {
      setReportReviewState(error instanceof Error ? error.message : "The report state was not changed.", "error");
    }
  });
  reportDialog?.querySelector("[data-report-save-status]")?.addEventListener("click", async () => {
    const status = reportDialog.querySelector<HTMLSelectElement>("[data-report-next-status]")?.value ?? "";
    try {
      await updateActiveReportStatus(status);
    } catch (error) {
      setReportReviewState(error instanceof Error ? error.message : "The report state was not changed.", "error");
    }
  });
  reportDialog?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target instanceof HTMLInputElement && target.name === "publishMedia") {
      const selected = reportSelectedMediaIds();
      if (selected.length > 3) {
        target.checked = false;
        setReportPublicationResult("Select no more than three evidence images.", "error");
      } else {
        setReportPublicationResult("");
      }
      const item = target.closest<HTMLElement>(".ops-report-evidence__item");
      for (const field of item?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "[data-update-media-alt], [data-update-media-caption]"
      ) ?? []) {
        field.disabled = !target.checked;
      }
    }
    if (["title", "body", "publishMedia", "scheduledFor"].includes(target.name) ||
        target.hasAttribute("data-update-media-alt") || target.hasAttribute("data-update-media-caption")) {
      const confirmation = reportDialog.querySelector<HTMLInputElement>(
        '[data-report-publication-form] [name="confirmPublication"]'
      );
      if (confirmation) {
        confirmation.checked = reportPublicationConfirmationAfterInput(
          confirmation.checked,
          target.name
        );
      }
      updateReportPublicationPreview();
    }
  });

  reportDialog?.querySelector("[data-report-upload-update-images]")?.addEventListener("click", async (event) => {
    const intent = reportReviewGuard.capture();
    const signal = reportReviewAbortController?.signal;
    if (!reportDialog || !intent || !signal || !activeReportDetail ||
        activeReportDetail.id !== intent.reportId || !reportReviewIsLive(intent, reportDialog)) return;
    const input = reportDialog.querySelector<HTMLInputElement>("[data-report-update-files]");
    const result = reportDialog.querySelector<HTMLElement>("[data-report-update-upload-result]");
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || !input?.files?.length) {
      if (result) result.textContent = "Choose one to three images first.";
      return;
    }
    if (!activeReportDetail.publication.updateId) {
      if (result) result.textContent = "Save the Official Update draft before uploading images.";
      return;
    }
    button.disabled = true;
    if (result) result.textContent = "Preparing images in this browser...";
    try {
      const prepared = await prepareReportImages([...input.files], { signal });
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      const formData = new FormData();
      for (const item of prepared) formData.append("images", item.upload, item.upload.name);
      if (result) result.textContent = "Uploading private prepared images...";
      const { response, payload } = await opsRequest(
        `/api/v1/ops/reports/${encodeURIComponent(intent.reportId)}/update-media`,
        { method: "POST", body: formData, signal }
      );
      if (!response.ok) throw new Error(apiError(payload, "The Update images were not uploaded."));
      await refreshActiveReportDetail(intent);
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      input.value = "";
      if (result) result.textContent = "Images uploaded privately and queued for processing. Refresh this report shortly to select them.";
    } catch (error) {
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted || isAbortError(error)) return;
      if (result) result.textContent = error instanceof ReportImagePreparationError || error instanceof Error
        ? error.message
        : "The Update images were not uploaded.";
    } finally {
      if (reportReviewIsLive(intent, reportDialog) && activeReportDetail?.id === intent.reportId) {
        button.disabled = !activeReportDetail.publication.updateId;
      }
    }
  });

  reportDialog?.querySelector("[data-report-publish-case-note]")?.addEventListener("click", async (event) => {
    const intent = reportReviewGuard.capture();
    const signal = reportReviewAbortController?.signal;
    if (
      !intent || !signal || !activeReportDetail || activeReportDetail.id !== intent.reportId ||
      !reportReviewIsLive(intent, reportDialog)
    ) return;
    const reportId = intent.reportId;
    const form = reportDialog.querySelector<HTMLFormElement>("[data-report-publication-form]");
    const body = form?.querySelector<HTMLTextAreaElement>('[name="body"]')?.value.trim() ?? "";
    const confirmed = form?.querySelector<HTMLInputElement>('[name="confirmPublication"]')?.checked ?? false;
    const mediaIds = reportSelectedReportMediaIds();
    if (!activeReportDetail.publicationEligible) {
      setReportPublicationResult("Publication is blocked until the report has current legal and profile eligibility.", "error");
      return;
    }
    if (!body || !confirmed || mediaIds.length > 3) {
      setReportPublicationResult("Enter the edited public story, select up to three images, and confirm the exact preview.", "error");
      (body ? form?.querySelector<HTMLInputElement>('[name="confirmPublication"]') : form?.querySelector<HTMLTextAreaElement>('[name="body"]'))?.focus();
      return;
    }
    if (
      !window.confirm("Publish this exact reviewed observation to Case Notes? It will not become an Official Update.") ||
      !reportReviewIsLive(intent, reportDialog) || signal.aborted
    ) return;
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    setReportPublicationResult("Publishing the reviewed observation to Case Notes...");
    try {
      const { response, payload } = await opsRequest(
        `/api/v1/ops/reports/${encodeURIComponent(reportId)}/case-note`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, mediaIds }),
          signal,
        }
      );
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      if (!response.ok) throw new Error(apiError(payload, "The reviewed Case Note was not published."));
      const published = envelopeData(payload);
      if (!isRecord(published) || !asString(published.id)) throw new Error("The Case Note response was incomplete.");
      await Promise.all([refreshActiveReportDetail(intent), loadReports(), loadDashboard(), loadAudit()]);
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      const result = reportPublicationResult();
      if (result) {
        const link = document.createElement("a");
        link.href = `/clue-board#${encodeURIComponent(asString(published.id))}`;
        link.textContent = "Open the public Case Note";
        result.replaceChildren(document.createTextNode("Reviewed Case Note published and audited. "), link);
        result.dataset.kind = "normal";
      }
    } catch (error) {
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted || isAbortError(error)) return;
      setReportPublicationResult(error instanceof Error ? error.message : "The reviewed Case Note was not published.", "error");
    } finally {
      if (reportReviewIsLive(intent, reportDialog) && activeReportDetail?.id === reportId) {
        button.disabled = !activeReportDetail.publicationEligible || activeReportDetail.caseNote.published;
      }
    }
  });

  reportDialog?.querySelector("[data-report-withdraw-case-note]")?.addEventListener("click", async (event) => {
    const intent = reportReviewGuard.capture();
    const signal = reportReviewAbortController?.signal;
    if (
      !intent || !signal || !activeReportDetail || activeReportDetail.id !== intent.reportId ||
      !reportReviewIsLive(intent, reportDialog) ||
      !window.confirm("Withdraw this reviewed observation from public Case Notes? The private report and audit history will remain.") ||
      !reportReviewIsLive(intent, reportDialog) || signal.aborted
    ) return;
    const reportId = intent.reportId;
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    setReportPublicationResult("Withdrawing the public Case Note...");
    try {
      const { response, payload } = await opsRequest(
        `/api/v1/ops/reports/${encodeURIComponent(reportId)}/case-note/withdraw`,
        { method: "POST", signal }
      );
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      if (!response.ok) throw new Error(apiError(payload, "The reviewed Case Note was not withdrawn."));
      await Promise.all([refreshActiveReportDetail(intent), loadReports(), loadDashboard(), loadAudit()]);
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      setReportPublicationResult("The Case Note was withdrawn. The private report and audit history remain available.");
    } catch (error) {
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted || isAbortError(error)) return;
      setReportPublicationResult(error instanceof Error ? error.message : "The reviewed Case Note was not withdrawn.", "error");
    } finally {
      if (reportReviewIsLive(intent, reportDialog) && activeReportDetail?.id === reportId) button.disabled = false;
    }
  });

  reportDialog?.querySelector<HTMLFormElement>("[data-report-publication-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  const mutateOfficialUpdate = async (
    action: "save_draft" | "schedule" | "publish_now",
    button: HTMLButtonElement
  ): Promise<void> => {
    if (!reportDialog) return;
    const intent = reportReviewGuard.capture();
    const signal = reportReviewAbortController?.signal;
    if (
      !intent || !signal || !activeReportDetail || activeReportDetail.id !== intent.reportId ||
      !reportReviewIsLive(intent, reportDialog)
    ) return;
    const reportId = intent.reportId;
    const form = reportDialog.querySelector<HTMLFormElement>("[data-report-publication-form]");
    if (!form) return;
    const data = new FormData(form);
    const title = asString(data.get("title")).trim();
    const body = asString(data.get("body")).trim();
    const confirmed = data.get("confirmPublication") === "on";
    const mediaSelections = reportSelectedMediaSelections();
    const mediaIds = mediaSelections.map((selection) => selection.id);
    const missingAltText = mediaSelections.some((selection) => {
      const checkbox = reportDialog.querySelector<HTMLInputElement>(
        `input[name="publishMedia"][value="${CSS.escape(selection.id)}"]`
      );
      return checkbox?.hasAttribute("data-update-upload-select") && !selection.altText;
    });
    const scheduledLocal = asString(data.get("scheduledFor")).trim();
    const scheduledFor = action === "schedule" && scheduledLocal
      ? new Date(scheduledLocal).toISOString()
      : null;
    if (!activeReportDetail.publicationEligible) {
      setReportPublicationResult("Publication is blocked until the report has current legal and profile eligibility.", "error");
      return;
    }
    if (!title || !body || mediaIds.length > 3 || missingAltText ||
        (action !== "save_draft" && (!confirmed || activeReportDetail.status !== "verified")) ||
        (action === "schedule" && (!scheduledFor || new Date(scheduledFor).getTime() <= Date.now()))) {
      setReportPublicationResult(
        action === "save_draft"
          ? "Enter the public headline and edited story, select up to three images, and add alt text for each direct upload."
          : action === "schedule"
            ? "Verify the report, enter a future schedule time, complete the preview, and confirm it."
            : "Verify the report, complete the public preview, select up to three images, and confirm it.",
        "error"
      );
      const firstInvalid = form.querySelector<HTMLElement>(":invalid");
      firstInvalid?.focus();
      return;
    }
    const confirmationMessage = action === "save_draft"
      ? "Save these private Official Update draft changes? Nothing will be public."
      : action === "schedule"
        ? `Schedule this exact Official Update for ${formatOpsTime(scheduledFor!)}?`
        : "Publish this exact Official Update now?";
    if (
      !window.confirm(confirmationMessage) ||
      !reportReviewIsLive(intent, reportDialog) || signal.aborted
    ) return;
    button.disabled = true;
    setReportPublicationResult(
      action === "save_draft"
        ? "Saving the private Update draft..."
        : action === "schedule"
          ? "Scheduling the verified Official Update..."
          : "Publishing the verified Official Update..."
    );
    try {
      const { response, payload } = await opsRequest(`/api/v1/ops/reports/${encodeURIComponent(reportId)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          mediaIds,
          mediaSelections,
          action,
          ...(scheduledFor ? { scheduledFor } : {})
        }),
        signal,
      });
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      if (!response.ok) throw new Error(apiError(payload, "The Official Update change was not saved."));
      const update = envelopeData(payload);
      if (!isRecord(update) || !asString(update.id) || !asString(update.publisherName)) {
        throw new Error("The Official Update response was incomplete.");
      }
      await Promise.all([refreshActiveReportDetail(intent), loadReports(), loadDashboard(), loadAudit()]);
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      const result = reportPublicationResult();
      if (result) {
        if (action === "publish_now") {
          const link = document.createElement("a");
          link.href = `/updates#${encodeURIComponent(asString(update.id))}`;
          link.textContent = "Open the public Official Update";
          result.replaceChildren(document.createTextNode("Official Update published and audited. "), link);
        } else {
          result.textContent = action === "schedule"
            ? `Official Update scheduled for ${formatOpsTime(scheduledFor!)} and audited.`
            : "Private Official Update draft saved and audited.";
        }
        result.dataset.kind = "normal";
      }
    } catch (error) {
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted || isAbortError(error)) return;
      setReportPublicationResult(error instanceof Error ? error.message : "The Official Update change was not saved.", "error");
    } finally {
      if (reportReviewIsLive(intent, reportDialog) && activeReportDetail?.id === reportId) {
        button.disabled = !activeReportDetail.publicationEligible ||
          (action !== "save_draft" && activeReportDetail.status !== "verified");
      }
    }
  };

  reportDialog?.querySelector("[data-report-save-draft]")?.addEventListener("click", (event) => {
    if (event.currentTarget instanceof HTMLButtonElement) void mutateOfficialUpdate("save_draft", event.currentTarget);
  });
  reportDialog?.querySelector("[data-report-schedule]")?.addEventListener("click", (event) => {
    if (event.currentTarget instanceof HTMLButtonElement) void mutateOfficialUpdate("schedule", event.currentTarget);
  });
  reportDialog?.querySelector("[data-report-publish-now]")?.addEventListener("click", (event) => {
    if (event.currentTarget instanceof HTMLButtonElement) void mutateOfficialUpdate("publish_now", event.currentTarget);
  });

  reportDialog?.querySelector("[data-report-unpublish]")?.addEventListener("click", async (event) => {
    const intent = reportReviewGuard.capture();
    const signal = reportReviewAbortController?.signal;
    if (
      !intent || !signal || !activeReportDetail || activeReportDetail.id !== intent.reportId ||
      !reportReviewIsLive(intent, reportDialog) ||
      !window.confirm("Unpublish this approved report from the public Updates page? The private report and audit record will remain.") ||
      !reportReviewIsLive(intent, reportDialog) || signal.aborted
    ) return;
    const reportId = intent.reportId;
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    setReportPublicationResult("Removing the public report post...");
    try {
      const { response, payload } = await opsRequest(
        `/api/v1/ops/reports/${encodeURIComponent(reportId)}/unpublish`,
        { method: "POST", signal }
      );
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      if (!response.ok) throw new Error(apiError(payload, "The report post was not unpublished."));
      await Promise.all([refreshActiveReportDetail(intent), loadReports(), loadDashboard(), loadAudit()]);
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted) return;
      setReportPublicationResult("The public post was withdrawn. The private report and audit history remain available.");
    } catch (error) {
      if (!reportReviewIsLive(intent, reportDialog) || signal.aborted || isAbortError(error)) return;
      setReportPublicationResult(error instanceof Error ? error.message : "The report post was not unpublished.", "error");
    } finally {
      if (reportReviewIsLive(intent, reportDialog) && activeReportDetail?.id === reportId) {
        button.disabled = false;
      }
    }
  });

  reportDialog?.addEventListener("close", () => {
    const reportId = reportDialog.dataset.reportId ?? "";
    closeReportReview();
    revokeReportEvidenceUrls();
    activeReportDetail = null;
    reportDialog.dataset.reportId = "";
    reportDialog.querySelector<HTMLElement>("[data-report-private-detail]")?.replaceChildren();
    reportDialog.querySelector<HTMLElement>("[data-report-evidence]")?.replaceChildren();
    reportDialog.querySelector<HTMLElement>("[data-report-public-preview]")?.replaceChildren();
    setReportPublicationResult("");
    setReportReviewState("Choose Review report to load one private submission.");
    const trigger = reportReviewTrigger?.isConnected
      ? reportReviewTrigger
      : reportId
        ? document.querySelector<HTMLButtonElement>(`[data-report-review][data-report-id="${CSS.escape(reportId)}"]`)
        : null;
    reportReviewTrigger = null;
    window.setTimeout(() => trigger?.focus(), 0);
  });

  document.querySelector("#moderation-table")?.addEventListener("click", async (event) => {
    const target = event.target as Element;
    const previewButton = target.closest<HTMLButtonElement>("[data-note-media-preview]");
    if (previewButton) {
      const noteId = previewButton.dataset.noteId;
      const mediaId = previewButton.dataset.noteMediaPreview;
      if (!noteId || !mediaId) return;
      previewButton.disabled = true;
      try {
        const headers = await opsHeaders();
        const response = await fetch(
          `/api/v1/ops/moderation/notes/${encodeURIComponent(noteId)}/media/${encodeURIComponent(mediaId)}`,
          { headers, credentials: "same-origin", cache: "no-store" }
        );
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
        if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
          throw new Error("The Case Note image preview is unavailable.");
        }
        const objectUrl = URL.createObjectURL(await response.blob());
        const opened = window.open(objectUrl, "_blank", "noopener,noreferrer");
        if (!opened) throw new Error("Allow pop-ups to preview this Case Note image.");
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } catch (error) {
        showPageError(error instanceof Error ? error.message : "The Case Note image preview is unavailable.");
      } finally {
        previewButton.disabled = false;
      }
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-moderation-id]");
    if (!button || !button.dataset.moderationId || !button.dataset.moderationDecision) return;
    const decision = button.dataset.moderationDecision;
    const reason = decision === "rejected" ? window.prompt("Record a private moderation reason:") : "Approved after operator review";
    if (reason === null || !window.confirm(`${decision === "approved" ? "Approve" : "Reject"} this Field Note?`)) return;
    button.disabled = true;
    try {
      const { response, payload } = await opsRequest(`/api/v1/ops/moderation/notes/${encodeURIComponent(button.dataset.moderationId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) });
      if (!response.ok) throw new Error(apiError(payload, "The moderation decision was not saved."));
      await Promise.all([loadModeration(), loadDashboard()]);
    } catch (error) {
      button.disabled = false;
      showPageError(error instanceof Error ? error.message : "The moderation decision was not saved.");
    }
  });

  document.querySelector("#sponsors-table")?.addEventListener("click", async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-sponsor-id]");
    const inquiryId = button?.dataset.sponsorId;
    if (!button || !inquiryId || sponsorMutations.has(inquiryId)) return;
    const select = document.querySelector<HTMLSelectElement>(`[data-sponsor-next-state="${CSS.escape(inquiryId)}"]`);
    const nextState = select?.value as OpsSponsorState | undefined;
    if (!nextState || !sponsorStates.includes(nextState)) return;
    if (nextState === button.dataset.sponsorCurrentState) {
      setSponsorsState("Choose a different sponsor state before applying the change.", "error");
      return;
    }
    const note = window.prompt("Add a private note for this sponsor state change (optional, 2,000 characters maximum):", "");
    if (note === null) return;
    if (note.length > 2_000) {
      setSponsorsState("Private notes must be 2,000 characters or fewer.", "error");
      return;
    }
    if (nextState === "accepted" && !window.confirm("Accepted is an internal pipeline state. It does not publish a sponsor.")) return;
    sponsorMutations.add(inquiryId);
    button.disabled = true;
    setSponsorsState(`Saving ${sponsorStateLabel(nextState).toLowerCase()} state...`);
    try {
      const { response, payload } = await opsRequest(`/api/v1/ops/sponsors/${encodeURIComponent(inquiryId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState, note: note.trim() || null })
      });
      if (!response.ok) throw new Error(apiError(payload, "The sponsor state was not changed."));
      setSponsorsState("Sponsor state changed and recorded in the private audit history.");
      await loadSponsors();
    } catch (error) {
      setSponsorsState(error instanceof Error ? error.message : "The sponsor state was not changed.", "error");
    } finally {
      sponsorMutations.delete(inquiryId);
      button.disabled = false;
    }
  });

  document.querySelector("#staff-table")?.addEventListener("click", async (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement) || !button.dataset.staffId || !button.dataset.staffAction) return;
    const action = button.dataset.staffAction;
    if (!window.confirm(`${button.textContent?.trim() ?? "Apply this action"}? This event will be audited.`)) return;
    button.disabled = true;
    try {
      const { response, payload } = await opsRequest(`/api/v1/ops/staff/${encodeURIComponent(button.dataset.staffId)}/${encodeURIComponent(action)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      if (!response.ok) throw new Error(apiError(payload, "The access action was not completed."));
      await Promise.all([loadStaff(), loadAudit()]);
    } catch (error) {
      button.disabled = false;
      showPageError(error instanceof Error ? error.message : "The access action was not completed.");
    }
  });

  document.querySelector("#subscribers-table")?.addEventListener("click", async (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement) || !button.dataset.playerId) return;
    if (button.hasAttribute("data-waiver-detail")) {
      await openWaiverDetail(button.dataset.playerId);
      return;
    }
    if (!button.dataset.playerAction) return;
    const action = button.dataset.playerAction;
    if (!window.confirm(`${button.textContent?.trim() ?? "Apply this action"}? This event will be audited.`)) return;
    button.disabled = true;
    try {
      const { response, payload } = await opsRequest(`/api/v1/ops/players/${encodeURIComponent(button.dataset.playerId)}/${encodeURIComponent(action)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      if (!response.ok) throw new Error(apiError(payload, "The player account action was not completed."));
      await loadAudit();
      button.disabled = false;
    } catch (error) {
      button.disabled = false;
      showPageError(error instanceof Error ? error.message : "The player account action was not completed.");
    }
  });

  document.querySelector("[data-retry-waiver-receipt]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const dialog = document.querySelector<HTMLDialogElement>("#ops-waiver-dialog");
    const subject = dialog?.dataset.playerId;
    if (!(button instanceof HTMLButtonElement) || !subject) return;
    const receiptStatus = dialog?.dataset.receiptStatus;
    const intent = waiverReceiptRetryIntent(
      receiptStatus === "uncertain" ? "uncertain" : "failed"
    );
    const receiptConfirmation = intent.confirmation;
    if (!window.confirm(receiptConfirmation)) return;
    button.disabled = true;
    setWaiverDetailState("Queueing a fresh copy of the legal receipt...");
    let queued = false;
    try {
      const { response, payload } = await opsRequest(`/api/v1/ops/players/${encodeURIComponent(subject)}/waiver/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent.body ?? {}),
      });
      if (!response.ok) throw new Error(apiError(payload, "The legal receipt could not be retried."));
      queued = true;
      applyWaiverReceiptRetryState(dialog, button, true);
      setWaiverDetailState("Receipt retry queued and recorded in the audit trail.");
      await loadAudit();
    } catch (error) {
      if (!queued && dialog) applyWaiverReceiptRetryState(dialog, button, false);
      setWaiverDetailState(error instanceof Error ? error.message : "The legal receipt could not be retried.", "error");
    }
  });
  document.querySelector<HTMLDialogElement>("#ops-waiver-dialog")?.addEventListener("close", (event) => {
    const dialog = event.currentTarget;
    if (!(dialog instanceof HTMLDialogElement)) return;
    dialog.dataset.playerId = "";
    dialog.dataset.receiptStatus = "";
    dialog.querySelector<HTMLElement>("[data-waiver-detail-output]")?.replaceChildren();
    const retry = dialog.querySelector<HTMLButtonElement>("[data-retry-waiver-receipt]");
    if (retry) retry.disabled = true;
    setWaiverDetailState("Choose Review legal record for one player to load the private acceptance.");
  });
}

function setupAccountDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#ops-account-dialog");
  document.querySelector("#ops-account-button")?.addEventListener("click", () => dialog?.showModal());
  document.querySelector("#manage-mfa")?.addEventListener("click", () => staffClerk?.openUserProfile());
  document.querySelector("#ops-sign-out")?.addEventListener("click", async () => {
    await staffClerk?.signOut();
    location.reload();
  });
  const changePassword = document.querySelector<HTMLFormElement>("#change-password-form");
  changePassword?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(changePassword);
    const currentPassword = asString(formData.get("currentPassword"));
    const newPassword = asString(formData.get("newPassword"));
    const confirmation = asString(formData.get("confirmPassword"));
    const result = changePassword.querySelector<HTMLElement>(".ops-inline-result");
    if (newPassword.length < 14 || newPassword !== confirmation) {
      if (result) result.textContent = "New passwords must match and contain at least 14 characters.";
      return;
    }
    try {
      if (!staffClerk?.user) throw new Error("Managed identity is unavailable.");
      await staffClerk.user.updatePassword({ currentPassword, newPassword, signOutOfOtherSessions: true });
      changePassword.reset();
      if (result) result.textContent = "Password changed. Other sessions were signed out.";
    } catch (error) {
      if (result) result.textContent = identityError(error, "The password was not changed.");
    }
  });
}

async function initialiseOps(): Promise<void> {
  initializeApprovedMediaViewer(document);
  setupAuthForms();
  setupWorkspace();
  setupAccountDialog();
  await initialiseManagedIdentity();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void initialiseOps(), { once: true });
  else void initialiseOps();
}
