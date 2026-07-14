import type {
  CaseStatus,
  IdentityLifecycleEvent,
  PlayerAccessState,
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
  WaiverReceiptErrorCode,
  WaiverReceiptJob,
  WaiverReviewRecord
} from "../src/server/types";
import { ApiError } from "../src/server/errors";

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

export class FakeStore {
  status: CaseStatus | null = openStatus;
  updates = [
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
  notes: Array<Record<string, unknown>> = [];
  replies: Array<Record<string, unknown>> = [];
  flags: Array<Record<string, unknown>> = [];
  staff = new Set(["staff-1"]);
  invitedStaffEmails = new Set<string>();
  audits: Array<Record<string, unknown>> = [];
  private privateReportIds = new Map<string, string>();
  private sponsorInquiries = new Map<string, SponsorInquiryRecord>();
  private sponsorInquiryIds = new Map<string, string>();
  private sponsorInquirySequence = 0;
  publicMedia = new Map<string, { key: string; contentType: string }>();
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
    return { items: this.updates, nextCursor: null };
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
    const items = waypointId
      ? this.board.filter((item) => item.waypointId === waypointId)
      : this.board;
    return { items, nextCursor: null };
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
        replayed: true
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
    return { value, replayed: false };
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
    const privacyAccepted = this.legalEvents.some(
      (event) => event.subject === subject && event.documentType === "privacy_media"
    );
    const acceptedWaiver = await this.getParticipationWaiver(subject);
    const legacyAcceptedOverride = subject === "hunter-1" && this.waiverStatus === "accepted";
    return {
      accountState: this.accounts.has(subject) ? "active" : "missing",
      profileComplete: this.profiles.has(subject),
      privacyMediaRequired: !privacyAccepted,
      privacyMediaVersion: privacyAccepted ? "2026.2" : null,
      waiverStatus: acceptedWaiver || legacyAcceptedOverride ? "accepted" : "pending",
      waiverVersion: acceptedWaiver?.documentVersion ?? (legacyAcceptedOverride ? "test-waiver" : null),
      participationUnlocked: Boolean(acceptedWaiver) || (legacyAcceptedOverride && this.participationUnlocked)
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
    const record: WaiverAcceptanceRecord = {
      id,
      subject,
      documentVersion: input.documentVersion,
      documentHash: input.documentHash,
      acceptedAt: "2026-07-13T18:05:00.000Z",
      referenceCode: `TLS-W-${id.slice(0, 8).toUpperCase()}`,
      participants: [
        { role: "adult", fullName: input.adultName, birthYear: null, guardianAttested: false },
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

  async queueWaiverReceiptResend(subject: string, acceptanceId: string) {
    const record = this.waiverAcceptances.get(acceptanceId);
    if (!record || record.subject !== subject) return null;
    record.receipt.status = "pending";
    record.receipt.sentAt = null;
    return structuredClone(record);
  }

  async claimWaiverReceiptJob(acceptanceId: string) {
    const record = this.waiverAcceptances.get(acceptanceId);
    if (!record || record.receipt.status === "sent") return null;
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
    result:
      | { status: "sent"; providerMessageId: string }
      | { status: "failed"; errorCode: WaiverReceiptErrorCode }
  ) {
    const record = [...this.waiverAcceptances.values()].find((entry) => entry.receipt.jobId === job.id);
    if (!record) return;
    record.receipt.status = result.status;
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

  async queueOpsWaiverReceiptResend(subject: string, acceptanceId: string, actorSubject: string) {
    if (this.waiverReceiptInProgress.has(acceptanceId)) return { status: "in_progress" as const };
    const acceptance = await this.queueWaiverReceiptResend(subject, acceptanceId);
    if (!acceptance) return { status: "not_found" as const };
    this.audits.push({
      action: "player.waiver-receipt.requested",
      actorSubject,
      target: acceptanceId,
      subject
    });
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
      reports: this.reports.filter((item) => item.hunterSubject === subject),
      notes: this.notes.filter((item) => item.authorSubject === subject)
    };
  }

  async createFieldNote(input: Record<string, unknown>) {
    const value = {
      ...input,
      id: `note-${this.notes.length + 1}`,
      status: "pending",
      createdAt: "2026-07-11T17:00:00.000Z"
    };
    this.notes.push(value);
    return value;
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
    const value = { ...input, id: `flag-${this.flags.length + 1}`, status: "received" };
    this.flags.push(value);
    return value;
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
        receivedReports: this.reports.filter((report) => report.status === "received").length
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
    this.updates.unshift(update as (typeof this.updates)[number]);
    this.audits.push({ action: "update.published", actorSubject });
    return update;
  }

  async listReports() {
    return { items: this.reports, nextCursor: null };
  }

  async updateReport(id: string, input: Record<string, unknown>, actorSubject: string) {
    const report = this.reports.find((item) => item.id === id);
    if (!report) return null;
    Object.assign(report, input);
    this.audits.push({ action: "report.updated", actorSubject, targetId: id });
    return report;
  }

  async listPendingNotes() {
    return { items: this.notes.filter((note) => note.status === "pending"), nextCursor: null };
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
}

export class FakeIdentity {
  async authenticateHunter(request: Request): Promise<Principal | null> {
    if (request.headers.get("authorization") !== "Bearer hunter-token") return null;
    return { kind: "hunter", subject: "hunter-1", email: "hunter@example.test" };
  }

  async authenticateStaff(request: Request): Promise<Principal | null> {
    if (request.headers.get("authorization") !== "Bearer staff-token") return null;
    return { kind: "staff", subject: "staff-1", email: "operator@example.test" };
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

  async save(files: File[]): Promise<StoredMedia[]> {
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
    if (key !== "derivatives/media-ready.webp") return null;
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

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
  headers: {
    "content-type": "application/json",
    origin: "https://www.timlostsomething.com",
    ...headers
  },
  body: JSON.stringify(body)
});

export const responseJson = async (response: Response): Promise<any> => response.json();
