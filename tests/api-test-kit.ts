import type {
  CaseStatus,
  IdentityLifecycleEvent,
  OperatorAlertRecipientClaim,
  OperatorAlertRecipientCompletion,
  PlayerAccessState,
  ReportWorkflowMutation,
  SponsorInquiryCounts,
  SponsorInquiryInput,
  SponsorInquiryRecord,
  SponsorInquiryState,
  SponsorSupportType,
  StoredMedia,
  WaiverAcceptanceInput,
  WaiverAcceptanceRecord,
  WaiverDocumentIdentity,
  WaiverReceiptEnvelope,
  WaiverReceiptCompletion,
  WaiverReceiptJob,
  WaiverReviewRecord
} from "../src/server/types";
import { ApiError } from "../src/server/errors";
import { publicAttributionFromReportSnapshot } from "../src/shared/publication";
import { publicHunterIdentity } from "../src/shared/public-identity";
import {
  hunterReportState,
  isReportReviewState,
  nextReportStates,
  reportTransitionRequiresConfirmation,
  reportTransitionRequiresReason,
} from "../src/shared/report-workflow";

export type Principal = {
  kind: "hunter" | "staff";
  subject: string;
  email: string | null;
};

export const openStatus: CaseStatus = {
  state: "open",
  hours: {
    opens: "09:00",
    closes: "20:00",
    timezone: "America/Edmonton"
  },
  updatedAt: "2026-07-11T16:00:00.000Z",
  nextClue: null,
  version: 1
};

const sponsorCursor = (record: SponsorInquiryRecord) =>
  btoa(`${record.createdAt}\n${record.id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const parseSponsorCursor = (cursor: string | null | undefined) => {
  if (!cursor) return null;
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const separator = decoded.indexOf("\n");
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (separator < 1 || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !id) throw new Error();
    return { createdAt, id };
  } catch {
    throw new ApiError(400, "invalid_cursor", "The sponsor inquiry cursor is invalid.");
  }
};

type ModerationCursor = { createdAt: string; id: string };

const isModerationTimestamp = (input: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input) &&
  !Number.isNaN(Date.parse(input)) && new Date(input).toISOString() === input;

const invalidModerationCursor = () =>
  new ApiError(400, "invalid_cursor", "The moderation cursor is invalid.");

const moderationCursor = (createdAt: unknown, id: unknown) => {
  const encoded = btoa(JSON.stringify([String(createdAt ?? ""), String(id ?? "")]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `m1.${encoded}`;
};

const parseModerationCursor = (cursor: string | null | undefined): ModerationCursor | null => {
  if (cursor === null || cursor === undefined) return null;
  if (!cursor.startsWith("m1.")) throw invalidModerationCursor();
  try {
    const encoded = cursor.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    if (
      !Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" ||
      !isModerationTimestamp(parsed[0]) || typeof parsed[1] !== "string" || parsed[1].length === 0 ||
      cursor !== moderationCursor(parsed[0], parsed[1])
    ) {
      throw new Error();
    }
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    throw invalidModerationCursor();
  }
};

const reportPublicAttribution = (
  report: Record<string, unknown>,
  profile: Record<string, unknown> | null
) => publicAttributionFromReportSnapshot({
  hunterSubject: typeof report.hunterSubject === "string" ? report.hunterSubject : null,
  publicAttribution: report.publicAttribution,
  attributionKind: report.attributionKind,
  protectsMinor: profile?.participationBasis === "minor_guardian_permission"
});

const reportPublicationPreview = (
  report: Record<string, unknown>,
  profile: Record<string, unknown> | null,
  participationUnlocked: boolean
) => {
  const hunterSubject = typeof report.hunterSubject === "string" ? report.hunterSubject : null;
  const terminal = report.status === "rejected" || report.status === "resolved";
  const resolvedAttribution = reportPublicAttribution(report, profile);
  const protectsMinor = profile?.participationBasis === "minor_guardian_permission";
  const hasCurrentAccess = !hunterSubject || Boolean(profile) && participationUnlocked;
  const publicAttribution = protectsMinor || !hunterSubject
    ? resolvedAttribution
    : !terminal && hasCurrentAccess
      ? resolvedAttribution
      : null;
  const publicationEligible = !terminal && Boolean(resolvedAttribution) &&
    hasCurrentAccess;
  return {
    publicAttribution,
    publicationEligible,
    publicationEligibilityReason: publicationEligible
      ? "eligible"
      : terminal
        ? "report_state_invalid"
        : hunterSubject && !hasCurrentAccess
          ? "current_legal_acceptance_required"
          : "public_attribution_required"
  };
};

const beforeModerationCursor = (record: Record<string, unknown>, cursor: ModerationCursor | null) =>
  !cursor || String(record.createdAt ?? "") < cursor.createdAt ||
    (String(record.createdAt ?? "") === cursor.createdAt && String(record.id ?? "") < cursor.id);

const compareModerationRecords = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")) ||
  String(right.id ?? "").localeCompare(String(left.id ?? ""));

export class FakeStore {
  status: CaseStatus | null = openStatus;
  updates: Array<Record<string, unknown>> = [
    {
      id: "update-1",
      title: "Case opened",
      body: "The search is active.",
      publishedAt: "2026-07-11T16:00:00.000Z",
      publisherName: "Campaign Ops"
    }
  ];
  rules = {
    id: "rules-1",
    version: "2026.1",
    title: "Official rules",
    body: "Search only in approved areas.",
    lastUpdatedAt: "2026-07-11T16:00:00.000Z"
  };
  zones = [
    {
      id: "zone-1",
      slug: "public-trail",
      label: "Public trail",
      state: "open",
      instruction: "Stay on marked routes.",
      verifiedAt: "2026-07-11T16:00:00.000Z",
      geojson: null
    }
  ];
  waypoints = [
    {
      id: 1,
      name: "Waypoint One",
      description: "A public route description.",
      zoneState: "open",
      exactUrl: "https://maps.example.test/private"
    }
  ];
  board: Array<Record<string, unknown>> = [];
  profiles = new Map<string, Record<string, unknown>>();
  accounts = new Map<string, Record<string, unknown>>();
  legalEvents: Array<Record<string, unknown>> = [];
  waiverReviews = new Map<string, WaiverReviewRecord>();
  waiverAcceptances = new Map<string, WaiverAcceptanceRecord>();
  waiverReceiptInProgress = new Set<string>();
  waiverAcceptanceKeys = new Map<string, string>();
  waiverSequence = 0;
  identityEvents = new Set<string>();
  waiverStatus: "pending" | "accepted" = "pending";
  participationUnlocked = false;
  progress: Array<Record<string, unknown>> = [];
  reports: Array<Record<string, unknown>> = [];
  reportEvents: Array<Record<string, unknown>> = [];
  notes: Array<Record<string, unknown>> = [];
  noteIdempotency = new Map<string, string>();
  replies: Array<Record<string, unknown>> = [];
  flags: Array<Record<string, unknown>> = [];
  staff = new Set(["staff-1"]);
  operatorEmails = new Set(["operator@example.test"]);
  operatorAlertClaims = new Map<string, OperatorAlertRecipientClaim[]>();
  operatorAlertCompletions: Array<{
    claim: OperatorAlertRecipientClaim;
    result: OperatorAlertRecipientCompletion;
  }> = [];
  reconciledOperatorAlertJobs: string[] = [];
  invitedStaffEmails = new Set<string>();
  audits: Array<Record<string, unknown>> = [];
  private privateReportIds = new Map<string, string>();
  private reportCaseNotes = new Map<string, Record<string, unknown>>();
  private reportCaseNoteMedia = new Map<string, string[]>();
  private sponsorInquiries = new Map<string, SponsorInquiryRecord>();
  private sponsorInquiryIds = new Map<string, string>();
  private sponsorInquirySequence = 0;
  private reportPublicationIds = new Map<string, string>();
  private reportPublicationMedia = new Map<string, string[]>();
  publicMedia = new Map<string, {
    key: string;
    contentType: string;
    cacheControl: "immutable" | "no-store";
  }>();
  subscribers = [
    {
      id: "hunter-1",
      verifiedEmail: "hunter@example.test",
      fullName: "A Hunter",
      publicHandle: "Hunter A7F3",
      townArea: "Seba Beach",
      consents: { huntEmail: true, marketing: false },
      createdAt: "2026-07-11T16:00:00.000Z",
      updatedAt: "2026-07-11T17:00:00.000Z"
    }
  ];

  async getStatus() {
    if (!this.status) throw new Error("status unavailable");
    return this.status;
  }

  async listUpdates() {
    const currentTime = Date.now();
    return {
      items: this.updates.filter((update) =>
        !update.status || update.status === "published" ||
        (update.status === "scheduled" && typeof update.scheduledFor === "string" &&
          new Date(update.scheduledFor).getTime() <= currentTime)
      ).map(({ status: _status, scheduledFor: _scheduledFor, uploads: _uploads, ...publicUpdate }) =>
        typeof publicUpdate.publisherName === "string" &&
        /^(?:campaign ops|campaign operator)$/i.test(publicUpdate.publisherName.trim())
          ? { ...publicUpdate, publisherName: "A representative from SebaHub" }
          : publicUpdate
      ),
      nextCursor: null
    };
  }

  async getCurrentRules() {
    return this.rules;
  }

  async listZones() {
    return this.zones;
  }

  async listWaypoints() {
    return this.waypoints.map(({ exactUrl: _exactUrl, ...waypoint }) => waypoint);
  }

  async listBoard(waypointId: number | null) {
    const publicItems = this.board.filter(
      (item) => item.noteKind !== "operator_reviewed" || item.status === "published"
    );
    const items = waypointId
      ? publicItems.filter((item) => item.waypointId === waypointId)
      : publicItems;
    return {
      items: items.map((item) => ({
        ...item,
        replies: Array.isArray(item.replies)
          ? item.replies.filter((reply) => {
              const stored = this.replies.find((candidate) => candidate.id === reply.id);
              return (stored?.status ?? reply.status ?? "published") === "published";
            })
          : []
      })),
      nextCursor: null
    };
  }

  async getPublicMedia(id: string) {
    return this.publicMedia.get(id) ?? null;
  }

  async getReportByIdempotencyKey(idempotencyKey: string) {
    const reportId = this.privateReportIds.get(idempotencyKey);
    return reportId ? this.reports.find((report) => report.id === reportId) ?? null : null;
  }

  async createReport(input: Record<string, unknown>, idempotencyKey: string) {
    const existing = this.privateReportIds.get(idempotencyKey);
    if (existing) {
      const value = this.reports.find((report) => report.id === existing);
      if (!value) throw new Error("idempotency fixture is inconsistent");
      return {
        value,
        replayed: true,
        operatorAlertJobId: null
      };
    }
    const value = {
      ...input,
      id: `report-${this.reports.length + 1}`,
      status: "received",
      createdAt: "2026-07-11T17:00:00.000Z"
    };
    this.reports.push(value);
    this.privateReportIds.set(idempotencyKey, String(value.id));
    const operatorAlertJobId = `operator-report-job-${this.reports.length}`;
    this.operatorAlertClaims.set(
      operatorAlertJobId,
      [...this.operatorEmails].map((email, index) => ({
        id: `${operatorAlertJobId}-recipient-${index + 1}`,
        jobId: operatorAlertJobId,
        kind: "operator_private_report",
        targetRecordId: String(value.id),
        email,
        attempts: 1,
        leaseToken: `${operatorAlertJobId}-lease-${index + 1}`,
        correlationId: `${operatorAlertJobId}-correlation-${index + 1}`
      }))
    );
    return { value, replayed: false, operatorAlertJobId };
  }

  async getSponsorInquiryByIdempotencyKey(key: string): Promise<SponsorInquiryRecord | null> {
    const inquiryId = this.sponsorInquiryIds.get(key);
    return inquiryId ? this.sponsorInquiries.get(inquiryId) ?? null : null;
  }

  async createSponsorInquiry(
    input: SponsorInquiryInput,
    key: string
  ): Promise<{ value: SponsorInquiryRecord; replayed: boolean }> {
    const existing = await this.getSponsorInquiryByIdempotencyKey(key);
    if (existing) return { value: existing, replayed: true };

    this.sponsorInquirySequence += 1;
    const sequence = this.sponsorInquirySequence;
    const id = `sponsor-${sequence}`;
    const createdAt = new Date(Date.UTC(2026, 6, 13, 20, 0, sequence)).toISOString();
    const record: SponsorInquiryRecord = {
      ...input,
      id,
      referenceCode: `SP-${String(sequence).padStart(8, "0")}`,
      state: "new",
      createdAt,
      updatedAt: createdAt
    };
    this.sponsorInquiries.set(id, record);
    this.sponsorInquiryIds.set(key, id);
    return { value: record, replayed: false };
  }

  async listSponsorInquiries(
    options: {
      limit?: number;
      cursor?: string | null;
      state?: SponsorInquiryState | null;
      supportType?: SponsorSupportType | null;
      query?: string | null;
    } = {}
  ) {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
    const query = options.query?.trim().toLocaleLowerCase();
    const cursor = parseSponsorCursor(options.cursor);
    const records = [...this.sponsorInquiries.values()]
      .filter((record) => !options.state || record.state === options.state)
      .filter((record) => !options.supportType || record.supportType === options.supportType)
      .filter(
        (record) =>
          !query ||
          record.contactName.toLocaleLowerCase().includes(query) ||
          record.organization.toLocaleLowerCase().includes(query) ||
          record.email.toLocaleLowerCase().includes(query)
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      )
      .filter(
        (record) =>
          !cursor ||
          record.createdAt < cursor.createdAt ||
          (record.createdAt === cursor.createdAt && record.id < cursor.id)
      );
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? sponsorCursor(items[items.length - 1]!) : null
    };
  }

  async countSponsorInquiriesByState(): Promise<SponsorInquiryCounts> {
    const counts: SponsorInquiryCounts = {
      new: 0,
      contacted: 0,
      qualified: 0,
      accepted: 0,
      closed: 0
    };
    for (const inquiry of this.sponsorInquiries.values()) counts[inquiry.state] += 1;
    return counts;
  }

  async updateSponsorInquiry(
    id: string,
    input: { state: SponsorInquiryState; note: string | null },
    _actorSubject: string
  ): Promise<SponsorInquiryRecord | null> {
    const current = this.sponsorInquiries.get(id);
    if (!current) return null;
    if (input.state === current.state && !input.note?.trim()) return current;

    const updated: SponsorInquiryRecord = {
      ...current,
      state: input.state,
      updatedAt: new Date(Date.parse(current.updatedAt) + 1_000).toISOString()
    };
    this.sponsorInquiries.set(id, updated);
    return updated;
  }

  async getProfile(subject: string) {
    return this.profiles.get(subject) ?? null;
  }

  async getPlayerAccount(subject: string) {
    return this.accounts.get(subject) ?? null;
  }

  async upsertPlayerAccount(subject: string, verifiedEmail: string): Promise<Record<string, unknown>> {
    const account = {
      subject,
      verifiedEmail,
      accountState: "active",
      createdAt: "2026-07-11T16:00:00.000Z",
      updatedAt: "2026-07-11T17:00:00.000Z"
    };
    this.accounts.set(subject, account);
    return account;
  }

  async getPlayerAccess(subject: string): Promise<PlayerAccessState> {
    const account = this.accounts.get(subject);
    const accountState = account?.accountState === "deleted"
      ? "deleted"
      : account
        ? "active"
        : "missing";
    const profileComplete = this.profiles.has(subject);
    const currentPrivacyEvent = [...this.legalEvents].reverse().find(
      (event) => event.subject === subject && event.documentType === "privacy_media"
    );
    const privacyAccepted = Boolean(currentPrivacyEvent) &&
      (currentPrivacyEvent?.action === undefined || currentPrivacyEvent.action === "accepted");
    const acceptedWaiver = await this.getParticipationWaiver(subject);
    const legacyAcceptedOverride = subject === "hunter-1" && this.waiverStatus === "accepted";
    const waiverAccepted = Boolean(acceptedWaiver) ||
      (legacyAcceptedOverride && this.participationUnlocked);
    return {
      accountState,
      profileComplete,
      privacyMediaRequired: !privacyAccepted,
      privacyMediaVersion: privacyAccepted ? "2026.2" : null,
      waiverStatus: acceptedWaiver || legacyAcceptedOverride ? "accepted" : "pending",
      waiverVersion: acceptedWaiver?.documentVersion ?? (legacyAcceptedOverride ? "test-waiver" : null),
      participationUnlocked: accountState === "active" && profileComplete && privacyAccepted &&
        waiverAccepted
    };
  }

  async recordWaiverReview(subject: string, document: WaiverDocumentIdentity) {
    const id = `review-${this.waiverReviews.size + 1}`;
    const review: WaiverReviewRecord = {
      id,
      subject,
      documentVersion: document.version,
      documentHash: document.hash,
      reviewedAt: "2026-07-13T18:00:00.000Z"
    };
    this.waiverReviews.set(id, review);
    return { ...review };
  }

  async getWaiverReview(subject: string, reviewEventId: string) {
    const review = this.waiverReviews.get(reviewEventId);
    return review?.subject === subject ? { ...review } : null;
  }

  async acceptParticipationWaiver(subject: string, input: WaiverAcceptanceInput) {
    const key = `${subject}:${input.idempotencyKey}`;
    const existingId = this.waiverAcceptanceKeys.get(key);
    if (existingId) {
      const existing = this.waiverAcceptances.get(existingId);
      if (!existing) throw new Error("waiver idempotency fixture is inconsistent");
      return { value: structuredClone(existing), replayed: true };
    }
    const review = await this.getWaiverReview(subject, input.reviewEventId);
    if (!review || review.documentVersion !== input.documentVersion || review.documentHash !== input.documentHash) {
      throw new Error("matching waiver review is required");
    }
    const id = `waiver-${++this.waiverSequence}`;
    const profile = this.profiles.get(subject);
    const participationBasis = profile?.participationBasis === "minor_guardian_permission"
      ? "minor_guardian_permission"
      : "adult";
    const accountName = typeof profile?.fullName === "string" && profile.fullName.trim()
      ? profile.fullName.trim()
      : input.adultName;
    const guardianPermissionAttested = participationBasis === "minor_guardian_permission" &&
      typeof profile?.guardianPermissionAttestedAt === "string" &&
      profile.guardianPermissionAttestedAt.trim().length > 0;
    const record: WaiverAcceptanceRecord = {
      id,
      subject,
      documentVersion: input.documentVersion,
      documentHash: input.documentHash,
      acceptedAt: "2026-07-13T18:05:00.000Z",
      referenceCode: `TLS-W-${id.slice(0, 8).toUpperCase()}`,
      participants: [
        {
          role: participationBasis === "minor_guardian_permission" ? "minor" : "adult",
          participationBasis,
          fullName: accountName,
          birthYear: null,
          guardianAttested: guardianPermissionAttested
        },
        ...input.minors.map((minor) => ({
          role: "minor" as const,
          fullName: minor.fullName,
          birthYear: minor.birthYear,
          guardianAttested: input.guardianAttested
        }))
      ],
      receipt: {
        jobId: `waiver-receipt-${id}`,
        status: "pending",
        attempts: 0,
        sentAt: null
      }
    };
    this.waiverAcceptances.set(id, record);
    this.waiverAcceptanceKeys.set(key, id);
    this.waiverStatus = "accepted";
    this.participationUnlocked = true;
    return { value: structuredClone(record), replayed: false };
  }

  async getParticipationWaiver(subject: string) {
    const record = [...this.waiverAcceptances.values()].reverse().find((entry) => entry.subject === subject);
    return record ? structuredClone(record) : null;
  }

  async requeueWaiverReceiptForAcceptanceReplay(subject: string, acceptanceId: string) {
    const record = this.waiverAcceptances.get(acceptanceId);
    if (
      !record ||
      record.subject !== subject ||
      record.receipt.status === "sent" ||
      record.receipt.status === "uncertain" ||
      this.waiverReceiptInProgress.has(acceptanceId)
    ) {
      return false;
    }
    record.receipt.status = "pending";
    record.receipt.sentAt = null;
    return true;
  }

  async queueWaiverReceiptResend(subject: string, acceptanceId: string) {
    const record = this.waiverAcceptances.get(acceptanceId);
    if (!record || record.subject !== subject) return null;
    if (record.receipt.status === "uncertain") return structuredClone(record);
    record.receipt.status = "pending";
    record.receipt.sentAt = null;
    return structuredClone(record);
  }

  async claimWaiverReceiptJob(acceptanceId: string) {
    const record = this.waiverAcceptances.get(acceptanceId);
    if (!record || record.receipt.status === "sent" || record.receipt.status === "uncertain") return null;
    record.receipt.attempts += 1;
    return {
      id: record.receipt.jobId,
      acceptanceId,
      attempts: record.receipt.attempts,
      leaseToken: `fake-lease-${record.receipt.attempts}`
    };
  }

  async getWaiverReceiptEnvelope(acceptanceId: string): Promise<WaiverReceiptEnvelope | null> {
    const record = this.waiverAcceptances.get(acceptanceId);
    const account = record ? this.accounts.get(record.subject) : null;
    const verifiedEmail = account?.verifiedEmail;
    return record && typeof verifiedEmail === "string"
      ? { acceptance: structuredClone(record), verifiedEmail }
      : null;
  }

  async completeWaiverReceiptJob(
    job: WaiverReceiptJob,
    result: WaiverReceiptCompletion
  ) {
    const record = [...this.waiverAcceptances.values()].find((entry) => entry.receipt.jobId === job.id);
    if (!record) return;
    record.receipt.status =
      result.status === "failed" && result.errorCode === "provider_delivery_uncertain"
        ? "uncertain"
        : result.status;
    record.receipt.sentAt = result.status === "sent" ? "2026-07-13T18:06:00.000Z" : null;
  }

  async getOpsWaiverDetail(subject: string) {
    return this.getParticipationWaiver(subject);
  }

  async getAndAuditOpsWaiverDetail(subject: string, actorSubject: string) {
    const detail = await this.getOpsWaiverDetail(subject);
    if (!detail) return null;
    this.audits.push({
      action: "player.waiver-detail.viewed",
      actorSubject,
      target: detail.id,
      occurredAt: new Date().toISOString()
    });
    return detail;
  }

  async queueOpsWaiverReceiptResend(
    subject: string,
    acceptanceId: string,
    actorSubject: string,
    allowUncertainRetry = false
  ) {
    if (this.waiverReceiptInProgress.has(acceptanceId)) return { status: "in_progress" as const };
    const current = this.waiverAcceptances.get(acceptanceId);
    if (current?.subject === subject && current.receipt.status === "uncertain" && !allowUncertainRetry) {
      return { status: "uncertain" as const };
    }
    const confirmedUncertainRetry =
      current?.subject === subject && current.receipt.status === "uncertain" && allowUncertainRetry;
    if (confirmedUncertainRetry) current.receipt.status = "failed";
    const acceptance = await this.queueWaiverReceiptResend(subject, acceptanceId);
    if (!acceptance) return { status: "not_found" as const };
    this.audits.push({
      action: "player.waiver-receipt.requested",
      actorSubject,
      target: acceptanceId,
      subject
    });
    if (confirmedUncertainRetry) {
      this.audits.push({
        action: "player.waiver-receipt.uncertain-retry-confirmed",
        actorSubject,
        target: acceptanceId,
        subject
      });
    }
    return { status: "queued" as const, acceptance };
  }

  async upsertProfile(subject: string, input: Record<string, unknown>) {
    if (input.privacyMediaAccepted === true) {
      this.legalEvents.push({
        subject,
        documentType: "privacy_media",
        version: input.privacyMediaVersion,
        documentHash: input.privacyMediaHash
      });
    }
    const profile = { subject, ...input, updatedAt: "2026-07-11T17:00:00.000Z" };
    this.profiles.set(subject, profile);
    return profile;
  }

  async getMemberWaypoint(id: number) {
    return this.waypoints.find((waypoint) => waypoint.id === id) ?? null;
  }

  async upsertProgress(subject: string, waypointId: number, state: string) {
    const value = { subject, waypointId, state, updatedAt: "2026-07-11T17:00:00.000Z" };
    this.progress = this.progress.filter(
      (item) => item.subject !== subject || item.waypointId !== waypointId
    );
    this.progress.push(value);
    return value;
  }

  async getHunterDashboard(subject: string) {
    return {
      profile: await this.getProfile(subject),
      status: await this.getStatus(),
      latestUpdate: this.updates[0] ?? null,
      waypoints: this.waypoints,
      progress: this.progress.filter((item) => item.subject === subject),
      reports: this.reports
        .filter((item) => item.hunterSubject === subject)
        .flatMap((item) => {
          if (!isReportReviewState(item.status)) return [];
          const publications: Array<{
            kind: "case_note" | "official_update";
            label: "Published in Case Notes" | "Used in an Official Update";
            href: "/clue-board" | "/updates";
          }> = [];
          if (this.reportCaseNotes.get(String(item.id))?.status === "published") {
            publications.push({
              kind: "case_note",
              label: "Published in Case Notes",
              href: "/clue-board",
            });
          }
          const publicationId = this.reportPublicationIds.get(String(item.id));
          const update = publicationId
            ? this.updates.find((candidate) => candidate.id === publicationId)
            : null;
          const scheduledFor = typeof update?.scheduledFor === "string" ? update.scheduledFor : null;
          const updateIsPublic = update?.status === "published" ||
            (update?.status === "scheduled" && scheduledFor !== null &&
              new Date(scheduledFor).getTime() <= Date.now());
          if (updateIsPublic) {
            publications.push({
              kind: "official_update",
              label: "Used in an Official Update",
              href: "/updates",
            });
          }
          return [{
            id: item.id,
            type: item.type,
            hunterStatus: hunterReportState(item.status),
            createdAt: item.createdAt,
            publications,
          }];
        }),
      notes: this.notes.filter((item) => item.authorSubject === subject)
    };
  }

  async getFieldNoteByIdempotencyKey(subject: string, idempotencyKey: string) {
    const noteId = this.noteIdempotency.get(`${subject}:${idempotencyKey}`);
    return noteId ? this.notes.find((item) => item.id === noteId) ?? null : null;
  }

  async createFieldNote(input: Record<string, unknown>, idempotencyKey: string) {
    const subject = String(input.authorSubject ?? "");
    const replay = await this.getFieldNoteByIdempotencyKey(subject, idempotencyKey);
    if (replay) return { value: replay, replayed: true, operatorAlertJobId: null };
    const value = {
      ...input,
      id: `note-${this.notes.length + 1}`,
      status: "pending",
      createdAt: "2026-07-11T17:00:00.000Z"
    };
    this.notes.push(value);
    this.noteIdempotency.set(`${subject}:${idempotencyKey}`, String(value.id));
    const operatorAlertJobId = `operator-note-job-${this.notes.length}`;
    this.operatorAlertClaims.set(
      operatorAlertJobId,
      [...this.operatorEmails].map((email, index) => ({
        id: `${operatorAlertJobId}-recipient-${index + 1}`,
        jobId: operatorAlertJobId,
        kind: "operator_field_note_moderation",
        targetRecordId: String(value.id),
        email,
        attempts: 1,
        leaseToken: `${operatorAlertJobId}-lease-${index + 1}`,
        correlationId: `${operatorAlertJobId}-correlation-${index + 1}`
      }))
    );
    return { value, replayed: false, operatorAlertJobId };
  }

  async claimOperatorAlertRecipients(jobId: string) {
    const claims = this.operatorAlertClaims.get(jobId) ?? [];
    const [claim, ...remaining] = claims;
    this.operatorAlertClaims.set(jobId, remaining);
    return claim ? [claim] : [];
  }

  async completeOperatorAlertRecipient(
    claim: OperatorAlertRecipientClaim,
    result: OperatorAlertRecipientCompletion
  ) {
    this.operatorAlertCompletions.push({ claim, result });
  }

  async reconcileOperatorAlertJob(jobId: string) {
    this.reconciledOperatorAlertJobs.push(jobId);
  }

  async createReply(input: Record<string, unknown>) {
    const value = {
      ...input,
      id: `reply-${this.replies.length + 1}`,
      status: "published",
      createdAt: "2026-07-11T17:00:00.000Z"
    };
    this.replies.push(value);
    return value;
  }

  async createFlag(input: Record<string, unknown>) {
    if (!this.reportableFlagTarget(input.targetKind, input.targetId)) {
      throw new ApiError(404, "content_not_found", "Community content not found.");
    }
    const value = {
      ...input,
      id: `flag-${this.flags.length + 1}`,
      status: "received",
      createdAt: "2026-07-17T18:00:00.000Z"
    };
    this.flags.push(value);
    return value;
  }

  async listModerationReplies(options: { limit?: number; cursor?: string | null } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
    const cursor = parseModerationCursor(options.cursor);
    const replies = this.replies
      .filter((reply) => reply.status === "published" || reply.status === "hidden")
      .filter((reply) => this.approvedModerationNote(reply.noteId ?? reply.fieldNoteId) !== null)
      .filter((reply) => this.publicAuthorProfile(reply) !== null)
      .filter((reply) => beforeModerationCursor(reply, cursor))
      .sort(compareModerationRecords);
    const selected = replies.slice(0, limit);
    return {
      items: selected
        .map((reply) => {
          const note = this.approvedModerationNote(reply.noteId ?? reply.fieldNoteId)!;
          return {
            id: reply.id,
            noteId: reply.noteId ?? reply.fieldNoteId,
            noteExcerpt: note?.body ?? null,
            waypointRouteOrder: note?.waypointRouteOrder ?? null,
            waypointName: note?.waypointName ?? null,
            body: reply.body,
            authorHandle: this.publicAuthorHandle(reply),
            status: reply.status,
            flagCount: this.flags.filter((flag) =>
              flag.targetKind === "reply" && flag.targetId === reply.id &&
              (flag.status === "received" || flag.status === "reviewing")
            ).length,
            createdAt: reply.createdAt,
            moderatedAt: reply.moderatedAt ?? null
          };
        }),
      nextCursor: replies.length > limit
        ? moderationCursor(selected.at(-1)?.createdAt, selected.at(-1)?.id)
        : null
    };
  }

  async listContentFlags(options: { limit?: number; cursor?: string | null } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 50);
    const cursor = parseModerationCursor(options.cursor);
    const flags = this.flags
      .filter((flag) => flag.status === "received" || flag.status === "reviewing")
      .flatMap((flag) => {
        const context = this.moderationFlagContext(flag);
        if (!context) return [];
        const { target, note } = context;
        return [{
          id: flag.id,
          targetKind: flag.targetKind,
          targetId: flag.targetId,
          targetExcerpt: target.body,
          authorHandle: this.publicAuthorHandle(target),
          targetStatus: target.status ?? "published",
          noteExcerpt: note?.body ?? null,
          waypointRouteOrder: note?.waypointRouteOrder ?? null,
          waypointName: note?.waypointName ?? null,
          reason: flag.reason,
          status: flag.status,
          createdAt: flag.createdAt
        }];
      })
      .filter((flag) => beforeModerationCursor(flag, cursor))
      .sort(compareModerationRecords);
    const selected = flags.slice(0, limit);
    return {
      items: selected,
      nextCursor: flags.length > limit
        ? moderationCursor(selected.at(-1)?.createdAt, selected.at(-1)?.id)
        : null
    };
  }

  async moderateReply(id: string, action: "hide" | "restore", reason: string, actorSubject: string) {
    const reply = this.replies.find((candidate) => candidate.id === id);
    const expected = action === "hide" ? "published" : "hidden";
    if (!reply || reply.status !== expected) return null;
    const timestamp = "2026-07-17T18:00:00.000Z";
    reply.status = action === "hide" ? "hidden" : "published";
    reply.moderatedAt = timestamp;
    reply.moderatedBy = actorSubject;
    if (action === "hide") {
      for (const flag of this.flags) {
        if (flag.targetKind === "reply" && flag.targetId === id &&
          (flag.status === "received" || flag.status === "reviewing")) {
          flag.status = "resolved";
          flag.resolvedAt = timestamp;
          flag.resolvedBy = actorSubject;
        }
      }
    }
    this.audits.push({
      action: action === "hide" ? "reply.hidden" : "reply.restored",
      actorSubject,
      targetId: id,
      reason
    });
    return { id, status: reply.status, moderatedAt: timestamp };
  }

  async moderateContentFlag(
    id: string,
    action: "dismiss" | "hide_target",
    reason: string,
    actorSubject: string
  ) {
    const flag = this.flags.find((candidate) => candidate.id === id);
    if (!flag || (flag.status !== "received" && flag.status !== "reviewing")) return null;
    const timestamp = "2026-07-17T18:00:00.000Z";
    if (action === "dismiss") {
      flag.status = "dismissed";
      flag.resolvedAt = timestamp;
      flag.resolvedBy = actorSubject;
      this.audits.push({ action: "content_flag.dismissed", actorSubject, targetId: id, reason });
      return { id, status: "dismissed", resolvedAt: timestamp };
    }
    if (flag.targetKind === "reply") {
      const reply = this.replies.find((candidate) => candidate.id === flag.targetId);
      if (!reply || reply.status !== "published") return null;
      reply.status = "hidden";
      reply.moderatedAt = timestamp;
      reply.moderatedBy = actorSubject;
      for (const candidate of this.flags) {
        if (candidate.targetKind === "reply" && candidate.targetId === reply.id &&
          (candidate.status === "received" || candidate.status === "reviewing")) {
          candidate.status = "resolved";
          candidate.resolvedAt = timestamp;
          candidate.resolvedBy = actorSubject;
        }
      }
    } else if (flag.targetKind === "note") {
      const note = this.board.find(
        (candidate) => candidate.id === flag.targetId &&
          candidate.noteKind === "operator_reviewed" && candidate.status === "published"
      );
      if (!note) return null;
      note.status = "hidden";
      for (const candidate of this.flags) {
        if (candidate.targetKind === "note" && candidate.targetId === note.id &&
          (candidate.status === "received" || candidate.status === "reviewing")) {
          candidate.status = "resolved";
          candidate.resolvedAt = timestamp;
          candidate.resolvedBy = actorSubject;
        }
      }
      for (const [reportId, candidate] of this.reportCaseNotes) {
        if (candidate.id !== note.id) continue;
        for (const mediaId of this.reportCaseNoteMedia.get(reportId) ?? []) {
          this.publicMedia.delete(mediaId);
        }
        break;
      }
    } else {
      return null;
    }
    this.audits.push({ action: "content_flag.target_hidden", actorSubject, targetId: id, reason });
    return { id, status: "resolved", resolvedAt: timestamp };
  }

  async isActiveStaff(subject: string, email: string | null) {
    if (this.staff.has(subject)) return true;
    if (email && this.invitedStaffEmails.delete(email)) {
      this.staff.add(subject);
      this.audits.push({ action: "staff.activated", actorSubject: subject });
      return true;
    }
    return false;
  }

  async getOpsDashboard() {
    return {
      status: await this.getStatus(),
      counts: {
        pendingNotes: this.notes.filter((note) => note.status === "pending").length,
        receivedReports: this.reports.filter((report) => report.status === "received").length,
        receivedFlags: this.flags.filter(
          (flag) => (flag.status === "received" || flag.status === "reviewing") &&
            this.moderationFlagContext(flag) !== null
        ).length
      },
      killSwitches: { boardVisible: true, notesEnabled: true, repliesEnabled: true }
    };
  }

  async updateStatus(input: Record<string, unknown>, actorSubject: string) {
    this.status = {
      ...openStatus,
      ...input,
      version: (this.status?.version ?? 0) + 1,
      updatedAt: "2026-07-11T18:00:00.000Z"
    };
    this.audits.push({ action: "status.updated", actorSubject, input });
    return this.status;
  }

  async createUpdate(input: Record<string, unknown>, actorSubject: string) {
    const update = {
      ...input,
      id: `update-${this.updates.length + 1}`,
      publisherName: "Campaign Ops",
      publishedAt: "2026-07-11T18:00:00.000Z"
    };
    this.updates.unshift(update);
    this.audits.push({ action: "update.published", actorSubject });
    return update;
  }

  async listReports() {
    return { items: this.reports, nextCursor: null };
  }

  async getReportDetail(id: string, actorSubject: string) {
    const report = this.reports.find((item) => item.id === id);
    if (!report) return null;
    this.audits.push({ action: "report.detail.viewed", actorSubject, targetId: id });
    const media = Array.isArray(report.media)
      ? report.media.map((item) => {
          const record = item as Record<string, unknown>;
          return {
            id: record.id,
            contentType: record.contentType,
            size: record.size,
            status: record.status
          };
        })
      : [];
    const {
      participationBasis: _privateParticipationBasis,
      publicHandle: _privatePublicHandle,
      ...safeReport
    } = report;
    const hunterSubject = typeof report.hunterSubject === "string" ? report.hunterSubject : null;
    const profile = hunterSubject ? this.profiles.get(hunterSubject) : null;
    const access = hunterSubject ? await this.getPlayerAccess(hunterSubject) : null;
    const attributionPreview = reportPublicationPreview(
      report,
      profile ?? null,
      access?.participationUnlocked ?? false
    );
    const publicationId = this.reportPublicationIds.get(id) ?? null;
    const linkedUpdate = publicationId ? this.updates.find((update) => update.id === publicationId) : null;
    const updateStatus = typeof linkedUpdate?.status === "string" ? linkedUpdate.status : null;
    const scheduledFor = typeof linkedUpdate?.scheduledFor === "string" ? linkedUpdate.scheduledFor : null;
    const published = updateStatus === "published" ||
      (updateStatus === "scheduled" && scheduledFor !== null && new Date(scheduledFor).getTime() <= Date.now());
    const caseNote = this.reportCaseNotes.get(id);
    return {
      ...safeReport,
      media,
      ...attributionPreview,
      publication: {
        published,
        updateId: publicationId,
        status: updateStatus,
        scheduledFor,
        title: typeof linkedUpdate?.title === "string" ? linkedUpdate.title : null,
        body: typeof linkedUpdate?.body === "string" ? linkedUpdate.body : null,
        mediaIds: this.reportPublicationMedia.get(id) ?? [],
        uploads: Array.isArray(linkedUpdate?.uploads) ? linkedUpdate.uploads : []
      },
      caseNote: {
        published: caseNote?.status === "published",
        noteId: caseNote?.id ?? null,
        status: caseNote?.status ?? null
      },
      history: this.reportEvents
        .filter((event) => event.reportId === id && (
          String(event.type ?? "").startsWith("status.") || event.type === "assignment.unassigned"
        ))
        .sort((left, right) =>
          String(right.occurredAt ?? "").localeCompare(String(left.occurredAt ?? "")) ||
          String(right.id ?? "").localeCompare(String(left.id ?? ""))
        )
        .slice(0, 8)
        .map((event) => ({
          id: event.id,
          type: event.type,
          actor: event.actor ?? null,
          note: event.note ?? null,
          occurredAt: event.occurredAt,
        }))
    };
  }

  async getReportMedia(reportId: string, mediaId: string, actorSubject: string) {
    const report = this.reports.find((item) => item.id === reportId);
    const media = Array.isArray(report?.media)
      ? report.media.find((item) => (item as Record<string, unknown>).id === mediaId)
      : null;
    const record = media as Record<string, unknown> | null;
    const key = typeof record?.derivativeObjectKey === "string" ? record.derivativeObjectKey : "";
    if (!record || record.status !== "ready" || !key.startsWith("derivatives/") || key === "derivatives/") {
      return null;
    }
    this.audits.push({
      action: "report.media.viewed",
      actorSubject,
      targetId: reportId,
      mediaId
    });
    return { key, contentType: String(record.contentType ?? "application/octet-stream") };
  }

  async updateReport(id: string, input: ReportWorkflowMutation, actorSubject: string) {
    const report = this.reports.find((item) => item.id === id);
    if (!report) return null;
    const currentStatus = report.status;
    if (!isReportReviewState(currentStatus) || currentStatus !== input.expectedStatus) {
      throw new ApiError(409, "report_transition_stale", "The report changed. Refresh and try again.");
    }
    const previousAssignedTo = typeof report.assignedTo === "string" && report.assignedTo
      ? report.assignedTo
      : null;
    const note = input.note?.trim() || null;
    const publicationId = this.reportPublicationIds.get(id);
    const linkedUpdate = publicationId ? this.updates.find((update) => update.id === publicationId) : null;
    const activeOfficialUpdate = linkedUpdate?.status === "draft" ||
      linkedUpdate?.status === "scheduled" || linkedUpdate?.status === "published";
    const publicCaseNote = this.reportCaseNotes.get(id)?.status === "published";
    let status = currentStatus;
    let assignedTo: string | null = previousAssignedTo;
    let eventType = "assignment.unassigned";
    let auditAction = "report.unassigned";

    if (input.operation === "transition") {
      status = input.status;
      if (!nextReportStates(currentStatus).includes(status)) {
        throw new ApiError(
          409,
          "report_transition_invalid",
          `Invalid report transition: cannot move from ${currentStatus} to ${status}.`
        );
      }
      if (reportTransitionRequiresReason(currentStatus, status) && !note) {
        throw new ApiError(
          422,
          "report_transition_reason_required",
          "Record a private reason for this status change."
        );
      }
      if (reportTransitionRequiresConfirmation(currentStatus, status) && !input.confirmed) {
        throw new ApiError(
          422,
          "report_transition_confirmation_required",
          "Confirm this audited status change."
        );
      }
      const officialUpdateBlocks = activeOfficialUpdate && (
        status === "resolved" || status === "rejected" ||
        (currentStatus === "verified" && status === "reviewing")
      );
      if (officialUpdateBlocks) {
        throw new ApiError(
          409,
          "report_official_update_active",
          "Withdraw the linked Official Update before changing this report to that state.",
          { destination: "official_update", action: "withdraw" }
        );
      }
      if (publicCaseNote && status === "rejected") {
        throw new ApiError(
          409,
          "report_case_note_active",
          "Withdraw the linked Case Note before rejecting this report.",
          { destination: "case_note", action: "withdraw" }
        );
      }
      assignedTo = status === "reviewing" &&
          (currentStatus === "received" || currentStatus === "rejected" || currentStatus === "resolved")
        ? actorSubject
        : previousAssignedTo ?? actorSubject;
      eventType = `status.${status}`;
      auditAction = "report.updated";
    } else {
      if (!input.confirmed) {
        throw new ApiError(
          422,
          "report_transition_confirmation_required",
          "Confirm this audited status change."
        );
      }
      if (!previousAssignedTo) {
        throw new ApiError(409, "report_assignment_stale", "The report assignment changed. Refresh and try again.");
      }
      assignedTo = null;
    }

    const occurredAt = new Date().toISOString();
    report.status = status;
    report.assignedTo = assignedTo;
    report.updatedAt = occurredAt;
    this.reportEvents.push({
      id: `report-event-${this.reportEvents.length + 1}`,
      reportId: id,
      type: eventType,
      actor: actorSubject,
      note,
      occurredAt,
    });
    this.audits.push({
      action: auditAction,
      actorSubject,
      targetId: id,
      metadata: {
        operation: input.operation,
        previousStatus: currentStatus,
        status,
        reason: note,
        previousAssignedTo,
        assignedTo,
        assignmentChanged: previousAssignedTo !== assignedTo,
      },
    });
    return report;
  }

  async publishReport(
    reportId: string,
    input: {
      title: string;
      body: string;
      mediaIds: string[];
      mediaSelections?: Array<{ id: string; altText: string | null; caption: string | null }>;
      action?: "save_draft" | "schedule" | "publish_now";
      scheduledFor?: string | null;
    },
    actorSubject: string
  ) {
    const report = this.reports.find((item) => item.id === reportId);
    if (!report) return null;
    if (report.status === "rejected" || report.status === "resolved") {
      throw new ApiError(
        409,
        "report_publication_state_invalid",
        "This report cannot be published from its current state."
      );
    }
    const action = input.action ?? "publish_now";
    if ((action === "schedule" || action === "publish_now") && report.status !== "verified") {
      throw new ApiError(
        409,
        "report_update_requires_verification",
        "Verify this private report before scheduling or publishing an Official Update."
      );
    }
    const existingUpdateId = this.reportPublicationIds.get(reportId);
    const linkedUpdate = existingUpdateId ? this.updates.find((item) => item.id === existingUpdateId) : null;
    const reportMedia = [
      ...(Array.isArray(report.media) ? report.media as Array<Record<string, unknown>> : []),
      ...(Array.isArray(linkedUpdate?.uploads) ? linkedUpdate.uploads as Array<Record<string, unknown>> : []),
    ];
    const selected = input.mediaIds.map((mediaId, position) => {
      const media = reportMedia.find((item) => item.id === mediaId);
      const key = typeof media?.derivativeObjectKey === "string" ? media.derivativeObjectKey : "";
      if (!media || media.status !== "ready" || !key.startsWith("derivatives/") || key === "derivatives/") {
        throw new ApiError(422, "publication_media_invalid", "Selected report media is not ready for publication.");
      }
      const metadata = input.mediaSelections?.[position];
      if (Array.isArray(linkedUpdate?.uploads) && linkedUpdate.uploads.includes(media) && !metadata?.altText) {
        throw new ApiError(422, "publication_media_alt_required", "Direct Update image alt text is required.");
      }
      return {
        id: mediaId,
        url: `/api/v1/media/${mediaId}`,
        contentType: String(media.contentType ?? "application/octet-stream"),
        key,
        alt: metadata?.altText ?? null,
        caption: metadata?.caption ?? null,
      };
    });
    const profile = typeof report.hunterSubject === "string"
      ? this.profiles.get(report.hunterSubject)
      : null;
    const access = typeof report.hunterSubject === "string"
      ? await this.getPlayerAccess(report.hunterSubject)
      : null;
    const attributionPreview = reportPublicationPreview(
      report,
      profile ?? null,
      access?.participationUnlocked ?? false
    );
    if (!attributionPreview.publicationEligible || !attributionPreview.publicAttribution) {
      throw new ApiError(
        409,
        "report_publication_ineligible",
        "This report is not eligible for a public attribution."
      );
    }
    const publisherName = attributionPreview.publicAttribution;
    const updateId = existingUpdateId ??
      `approved-report-${this.reportPublicationIds.size + 1}`;
    const previousMedia = this.reportPublicationMedia.get(reportId) ?? [];
    for (const mediaId of previousMedia) this.publicMedia.delete(mediaId);
    const status = action === "save_draft" ? "draft" : action === "schedule" ? "scheduled" : "published";
    const scheduledFor = action === "schedule" ? input.scheduledFor ?? null : null;
    if (status === "published") {
      for (const media of selected) {
        this.publicMedia.set(media.id, {
          key: media.key,
          contentType: media.contentType,
          cacheControl: "no-store"
        });
      }
    }
    this.reportPublicationIds.set(reportId, updateId);
    this.reportPublicationMedia.set(reportId, selected.map((media) => media.id));
    const update = {
      id: updateId,
      kind: "approved_report",
      title: input.title,
      body: input.body,
      publisherName,
      waypointId: typeof report.waypointId === "number" ? report.waypointId : null,
      latitude: typeof report.latitude === "number" ? report.latitude : null,
      longitude: typeof report.longitude === "number" ? report.longitude : null,
      media: selected.map(({ id, url, contentType, alt, caption }) => ({
        id,
        url,
        contentType,
        ...(alt ? { alt } : {}),
        ...(caption ? { caption } : {})
      })),
      publishedAt: status === "scheduled" ? scheduledFor : "2026-07-15T21:00:00.000Z",
      scheduledFor,
      status
    };
    this.updates = this.updates.filter((item) => item.id !== updateId);
    this.updates.unshift(update);
    this.audits.push({
      action: status === "draft"
        ? "report.update.draft_saved"
        : status === "scheduled"
          ? "report.update.scheduled"
          : "report.published",
      actorSubject,
      targetId: reportId
    });
    return update;
  }

  async publishReportToCaseNotes(
    reportId: string,
    input: { body: string; mediaIds: string[] },
    actorSubject: string
  ) {
    const existing = this.reportCaseNotes.get(reportId);
    if (existing) {
      if (existing.status === "withdrawn") {
        throw new ApiError(
          409,
          "report_case_note_withdrawn",
          "This report's Case Note is withdrawn. Create a new editorial action before republishing it."
        );
      }
      if (existing.status !== "published") {
        throw new ApiError(
          409,
          "report_case_note_state_invalid",
          "This report's Case Note cannot be published from its current moderation state."
        );
      }
      return existing;
    }
    const report = this.reports.find((item) => item.id === reportId);
    if (!report) return null;
    if (!["reviewing", "contacted", "escalated", "verified"].includes(String(report.status))) {
      throw new ApiError(409, "report_case_note_state_invalid", "Begin private review first.");
    }
    const reportMedia = Array.isArray(report.media) ? report.media as Array<Record<string, unknown>> : [];
    const selected = input.mediaIds.map((mediaId) => {
      const media = reportMedia.find((item) => item.id === mediaId);
      const key = typeof media?.derivativeObjectKey === "string" ? media.derivativeObjectKey : "";
      if (!media || media.status !== "ready" || !key.startsWith("derivatives/") || key === "derivatives/") {
        throw new ApiError(422, "publication_media_invalid", "Selected report media is not ready.");
      }
      this.publicMedia.set(mediaId, {
        key,
        contentType: String(media.contentType ?? "application/octet-stream"),
        cacheControl: "no-store"
      });
      return { id: mediaId, url: `/api/v1/media/${mediaId}`, contentType: media.contentType };
    });
    const note = {
      id: `operator-reviewed-note-${this.reportCaseNotes.size + 1}`,
      noteKind: "operator_reviewed",
      authorHandle: String(report.publicAttribution ?? "Community Hunter"),
      waypointId: typeof report.waypointId === "number" ? report.waypointId : null,
      waypointRouteOrder: null,
      waypointName: null,
      latitude: typeof report.latitude === "number" ? report.latitude : null,
      longitude: typeof report.longitude === "number" ? report.longitude : null,
      body: input.body,
      status: "published",
      createdAt: "2026-07-17T18:00:00.000Z",
      publishedAt: "2026-07-17T18:00:00.000Z",
      media: selected,
      replies: []
    };
    this.reportCaseNotes.set(reportId, note);
    this.reportCaseNoteMedia.set(reportId, input.mediaIds);
    this.board.unshift(note);
    this.audits.push({ action: "report.case-note.published", actorSubject, targetId: reportId });
    return note;
  }

  async withdrawReportCaseNote(reportId: string, actorSubject: string) {
    const note = this.reportCaseNotes.get(reportId);
    if (!note) return null;
    if (note.status === "withdrawn") return note;
    if (note.status !== "published") {
      throw new ApiError(
        409,
        "report_case_note_state_invalid",
        "This report's Case Note cannot be withdrawn from its current moderation state."
      );
    }
    const timestamp = "2026-07-17T18:00:00.000Z";
    note.status = "withdrawn";
    for (const flag of this.flags) {
      if (flag.targetKind === "note" && flag.targetId === note.id &&
        (flag.status === "received" || flag.status === "reviewing")) {
        flag.status = "resolved";
        flag.resolvedAt = timestamp;
        flag.resolvedBy = actorSubject;
      }
    }
    this.board = this.board.filter((item) => item.id !== note.id);
    for (const mediaId of this.reportCaseNoteMedia.get(reportId) ?? []) this.publicMedia.delete(mediaId);
    this.audits.push({ action: "report.case-note.withdrawn", actorSubject, targetId: reportId });
    return note;
  }

  async unpublishReport(reportId: string, actorSubject: string) {
    const report = this.reports.find((item) => item.id === reportId);
    if (!report) return null;
    const updateId = this.reportPublicationIds.get(reportId);
    const update = updateId ? this.updates.find((item) => item.id === updateId) : null;
    if (update) {
      update.status = "withdrawn";
      update.scheduledFor = null;
    }
    for (const mediaId of this.reportPublicationMedia.get(reportId) ?? []) {
      this.publicMedia.delete(mediaId);
    }
    this.reportPublicationMedia.delete(reportId);
    this.audits.push({ action: "report.unpublished", actorSubject, targetId: reportId });
    return { id: updateId ?? null, sourceReportId: reportId, status: "withdrawn" };
  }

  async addReportUpdateUploads(reportId: string, media: StoredMedia[], actorSubject: string) {
    const updateId = this.reportPublicationIds.get(reportId);
    const update = updateId ? this.updates.find((item) => item.id === updateId) : null;
    if (!update) return null;
    const uploads = Array.isArray(update.uploads) ? update.uploads as Array<Record<string, unknown>> : [];
    uploads.push(...media.map((item) => ({
      id: item.id,
      contentType: item.contentType,
      size: item.size,
      status: item.status,
      altText: null,
      caption: null,
      position: null,
      key: item.key
    })));
    update.uploads = uploads;
    this.audits.push({ action: "report.update.media_uploaded", actorSubject, targetId: reportId });
    return this.getReportDetail(reportId, actorSubject);
  }

  async getReportUpdateMedia(reportId: string, mediaId: string, actorSubject: string) {
    const updateId = this.reportPublicationIds.get(reportId);
    const update = updateId ? this.updates.find((item) => item.id === updateId) : null;
    const uploads = Array.isArray(update?.uploads) ? update.uploads as Array<Record<string, unknown>> : [];
    const media = uploads.find((item) => item.id === mediaId && item.status === "ready");
    const key = typeof media?.key === "string" ? media.key : "";
    if (!key.startsWith("derivatives/")) return null;
    this.audits.push({ action: "report.update.media_viewed", actorSubject, targetId: reportId });
    return { key, contentType: String(media?.contentType ?? "application/octet-stream") };
  }

  async listPendingNotes() {
    return {
      items: this.notes.filter((note) => note.status === "pending").map((note) => {
        const media = Array.isArray(note.media)
          ? note.media.map((item) => {
              const record = item as Record<string, unknown>;
              return {
                id: record.id,
                contentType: record.contentType,
                size: record.size,
                status: record.status
              };
            })
          : [];
        const { media: _privateMedia, ...safeNote } = note;
        return { ...safeNote, mediaCount: media.length, media };
      }),
      nextCursor: null
    };
  }

  async getFieldNoteMedia(noteId: string, mediaId: string, actorSubject: string) {
    const note = this.notes.find((item) => item.id === noteId);
    const media = Array.isArray(note?.media)
      ? note.media.find((item) => (item as Record<string, unknown>).id === mediaId)
      : null;
    const record = media as Record<string, unknown> | null;
    const key = typeof record?.derivativeObjectKey === "string" ? record.derivativeObjectKey : "";
    if (!record || record.status !== "ready" || !key.startsWith("derivatives/") || key === "derivatives/") {
      return null;
    }
    this.audits.push({ action: "note.media.viewed", actorSubject, targetId: noteId, mediaId });
    return { key, contentType: String(record.contentType ?? "application/octet-stream") };
  }

  async moderateNote(id: string, decision: string, reason: string | null, actorSubject: string) {
    const note = this.notes.find((item) => item.id === id);
    if (!note) return null;
    note.status = decision;
    this.audits.push({ action: "note.moderated", actorSubject, targetId: id, reason });
    return note;
  }

  async listStaff() {
    return [...this.staff].map((subject) => ({
      id: subject,
      subject,
      email: "operator@example.test",
      status: "active"
    }));
  }

  async listSubscribers() {
    return {
      counts: { totalProfiles: 1, huntEmail: 1, marketing: 0 },
      items: this.subscribers,
      nextCursor: null
    };
  }

  async applyIdentityEvent(event: IdentityLifecycleEvent) {
    const id = String(event.id);
    if (this.identityEvents.has(id)) return { replayed: true };
    this.identityEvents.add(id);
    const data = event.data as Record<string, unknown>;
    if (event.type === "user.deleted") this.accounts.delete(String(data.subject));
    else await this.upsertPlayerAccount(String(data.subject), String(data.verifiedEmail));
    return { replayed: false };
  }

  async listPlayers(): Promise<{
    counts: { verifiedAccounts: number; completedProfiles: number; huntEmail: number; marketing: number };
    items: Record<string, unknown>[];
    nextCursor: null;
  }> {
    return {
      counts: {
        verifiedAccounts: this.accounts.size,
        completedProfiles: this.profiles.size,
        huntEmail: 1,
        marketing: 0
      },
      items: [...this.accounts.values()].map((account) => {
        const subject = String(account.subject);
        const profile = this.profiles.get(subject);
        const acceptance = [...this.waiverAcceptances.values()]
          .reverse()
          .find((entry) => entry.subject === subject);
        return {
          ...account,
          profileComplete: Boolean(profile),
          fullName: profile?.fullName ?? null,
          publicHandle: profile?.publicHandle ?? null,
          townArea: profile?.townArea ?? null,
          privacyMediaVersion: this.legalEvents.some(
            (event) => event.subject === subject && event.documentType === "privacy_media"
          ) ? "2026.2" : null,
          waiverStatus: acceptance ? "accepted" : "required",
          waiverVersion: acceptance?.documentVersion ?? null,
          acceptedAt: acceptance?.acceptedAt ?? null,
          minorCount: acceptance?.participants.filter((participant) => participant.role === "minor").length ?? 0,
          receiptStatus: acceptance?.receipt.status ?? null,
          participationUnlocked: Boolean(acceptance),
          consents: { huntEmail: false, marketing: false }
        };
      }),
      nextCursor: null
    };
  }

  async listAudit() {
    return {
      items: this.audits.map((event, index) => ({
        id: `audit-${index + 1}`,
        createdAt: "2026-07-11T18:00:00.000Z",
        actor: event.actorSubject ?? "System",
        action: event.action,
        target: event.targetId ?? event.target ?? null,
        result: event.reason ?? "recorded"
      })),
      nextCursor: null
    };
  }

  async getStaffPrincipal(id: string) {
    if (!this.staff.has(id)) return null;
    return {
      id,
      subject: id,
      email: "operator@example.test",
      status: "active"
    };
  }

  async recordStaffAction(action: string, target: string, actorSubject: string) {
    const result = { action, target, status: "queued" };
    this.audits.push({ ...result, action: `staff.${action}.requested`, actorSubject });
    return result;
  }

  async recordPlayerAction(action: string, target: string, actorSubject: string) {
    const result = { action, target, status: "queued" };
    this.audits.push({ ...result, action: `player.${action}.requested`, actorSubject });
    return result;
  }

  private publicAuthorHandle(record: Record<string, unknown>) {
    const profile = this.publicAuthorProfile(record);
    if (profile) {
      return publicHunterIdentity({
        participationBasis: typeof profile.participationBasis === "string"
          ? profile.participationBasis
          : typeof profile.participation_basis === "string"
            ? profile.participation_basis
            : null,
        publicDisplayName: typeof profile.publicDisplayName === "string"
          ? profile.publicDisplayName
          : typeof profile.public_display_name === "string"
            ? profile.public_display_name
            : null,
        publicHandle: typeof profile.publicHandle === "string"
          ? profile.publicHandle
          : typeof profile.public_handle === "string"
            ? profile.public_handle
            : null
      });
    }
    return typeof record.authorHandle === "string" ? record.authorHandle : "Community Hunter";
  }

  private approvedModerationNote(id: unknown) {
    return this.board.find((candidate) => candidate.id === id && candidate.status === "approved") ?? null;
  }

  private reportableFlagTarget(kind: unknown, targetId: unknown) {
    if (kind === "note") {
      const note = this.board.find((candidate) => candidate.id === targetId);
      if (!note) return false;
      const publicationIsCurrent = typeof note.publishedAt === "string" &&
        Number.isFinite(new Date(note.publishedAt).getTime()) &&
        new Date(note.publishedAt).getTime() <= Date.now();
      if (note.noteKind === "operator_reviewed") return note.status === "published" && publicationIsCurrent;
      return note.status === "approved" && publicationIsCurrent && this.publicAuthorProfile(note) !== null;
    }
    if (kind !== "reply") return false;
    const reply = this.replies.find(
      (candidate) => candidate.id === targetId && candidate.status === "published"
    );
    if (!reply || !this.publicAuthorProfile(reply)) return false;
    const parent = this.approvedModerationNote(reply.noteId ?? reply.fieldNoteId);
    if (!parent || !this.publicAuthorProfile(parent) || typeof parent.publishedAt !== "string") return false;
    const publishedAt = new Date(parent.publishedAt).getTime();
    return Number.isFinite(publishedAt) && publishedAt <= Date.now();
  }

  private moderationFlagContext(flag: Record<string, unknown>) {
    if (flag.targetKind !== "note" && flag.targetKind !== "reply") return null;
    const reply = flag.targetKind === "reply"
      ? this.replies.find((candidate) => candidate.id === flag.targetId)
      : null;
    if (flag.targetKind === "reply" && !reply) return null;
    if (reply && reply.status !== "published" && reply.status !== "hidden") return null;
    const noteId = reply?.noteId ?? reply?.fieldNoteId ?? flag.targetId;
    const note = this.board.find((candidate) => {
      if (candidate.id !== noteId) return false;
      return candidate.noteKind === "operator_reviewed"
        ? candidate.status === "published" || candidate.status === "hidden"
        : candidate.status === "approved";
    });
    const target = reply ?? note;
    if (!target || !note) return null;
    if (reply && !this.publicAuthorProfile(reply)) return null;
    if (!reply && note.noteKind !== "operator_reviewed" && !this.publicAuthorProfile(note)) return null;
    return { target, note };
  }

  private publicAuthorProfile(record: Record<string, unknown>) {
    const subject = typeof record.authorSubject === "string"
      ? record.authorSubject
      : typeof record.author_subject === "string"
        ? record.author_subject
        : typeof record.subject === "string"
          ? record.subject
          : null;
    return subject ? this.profiles.get(subject) ?? null : null;
  }
}

export async function grantFakeCurrentPlayerAccess(store: FakeStore, subject: string) {
  await store.upsertPlayerAccount(subject, `${subject}@example.test`);
  store.legalEvents.push({ subject, documentType: "privacy_media" });
  const document = { version: "test-waiver", hash: "a".repeat(64) };
  const review = await store.recordWaiverReview(subject, document);
  await store.acceptParticipationWaiver(subject, {
    reviewEventId: review.id,
    idempotencyKey: `publication-access:${subject}`,
    adultName: typeof store.profiles.get(subject)?.fullName === "string"
      ? String(store.profiles.get(subject)?.fullName)
      : "Test Hunter",
    minors: [],
    guardianAttested: false,
    documentVersion: document.version,
    documentHash: document.hash
  });
}

export class FakeIdentity {
  async authenticateHunter(request: Request): Promise<Principal | null> {
    if (request.headers.get("authorization") !== "Bearer hunter-token") return null;
    return { kind: "hunter", subject: "hunter-1", email: "hunter@example.test" };
  }

  async authenticateStaff(request: Request): Promise<Principal | null> {
    const authorization = request.headers.get("authorization");
    if (authorization === "Bearer staff-token") {
      return { kind: "staff", subject: "staff-1", email: "operator@example.test" };
    }
    if (authorization === "Bearer staff-2-token") {
      return { kind: "staff", subject: "staff-2", email: "operator-two@example.test" };
    }
    return null;
  }
}

export class FakeTurnstile {
  constructor(private readonly acceptedToken = "human-token") {}

  async verify(token: string | null) {
    return token === this.acceptedToken;
  }
}

export class FakeUploads {
  saved: Array<{ name: string; type: string; size: number }> = [];
  contexts: Array<{ kind: "field_note" | "report" | "official_update"; subject: string | null }> = [];

  async save(
    files: File[],
    context: { kind: "field_note" | "report" | "official_update"; subject: string | null }
  ): Promise<StoredMedia[]> {
    this.contexts.push(context);
    const saved = files.map((file, index) => {
      this.saved.push({ name: file.name, type: file.type, size: file.size });
      return {
        id: `media-${this.saved.length}`,
        key: `private/${this.saved.length}-${index}`,
        status: "processing" as const
      };
    });
    return saved;
  }

  async read(key: string) {
    if (!new Set(["derivatives/media-ready.webp", "derivatives/media-selected.webp"]).has(key)) {
      return null;
    }
    return {
      body: new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])]).stream(),
      contentType: "image/webp",
      etag: "etag-ready"
    };
  }
}

export class FakeStaffAccounts {
  actions: Array<{ action: string; target: Record<string, unknown> }> = [];

  async execute(action: string, target: Record<string, unknown>) {
    this.actions.push({ action, target });
    return { status: action === "recovery" ? "instructions_sent" : "completed" };
  }
}

export class FakeRateLimits {
  seen: Array<{ scope: string; identifiers: string[]; limit: number; windowSeconds: number }> = [];
  counts = new Map<string, number>();

  constructor(private readonly overrides: Record<string, number> = {}) {}

  async consume(input: {
    scope: string;
    identifiers: string[];
    limit: number;
    windowSeconds: number;
  }) {
    this.seen.push(input);
    const key = `${input.scope}:${input.identifiers.join(":")}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    const limit = this.overrides[input.scope] ?? input.limit;
    return { allowed: count <= limit, retryAfter: input.windowSeconds };
  }
}

export class FakeEnvironment {
  checks = 0;

  async assertWritable() {
    this.checks += 1;
  }
}

export class FakeLegalReceiptSender {
  calls: string[] = [];

  constructor(private readonly result: "sent" | "failed" = "sent") {}

  async deliver(acceptanceId: string) {
    this.calls.push(acceptanceId);
    return { status: this.result } as const;
  }
}

export class FakeOperatorAlertSender {
  calls: string[] = [];

  constructor(private readonly shouldReject = false) {}

  async deliver(jobId: string) {
    this.calls.push(jobId);
    if (this.shouldReject) throw new Error("operator alert delivery failed");
    return { status: "sent" as const, sent: 1, failed: 0 };
  }
}

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
  headers: {
    "content-type": "application/json",
    origin: "https://www.timlostsomething.com",
    ...headers
  },
  body: JSON.stringify(body)
});

export const responseJson = async (response: Response): Promise<any> => response.json();
