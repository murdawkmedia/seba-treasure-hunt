import type { CaseStatus, IdentityLifecycleEvent, PlayerAccessState, StoredMedia } from "../src/server/types";

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
    return {
      accountState: this.accounts.has(subject) ? "active" : "missing",
      profileComplete: this.profiles.has(subject),
      privacyMediaRequired: !privacyAccepted,
      privacyMediaVersion: privacyAccepted ? "2026.1" : null,
      waiverStatus: this.waiverStatus,
      waiverVersion: this.waiverStatus === "accepted" ? "test-waiver" : null,
      participationUnlocked: this.participationUnlocked
    };
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

  async listPlayers() {
    return {
      counts: {
        verifiedAccounts: this.accounts.size,
        completedProfiles: this.profiles.size,
        huntEmail: 1,
        marketing: 0
      },
      items: [...this.accounts.values()],
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

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body)
});

export const responseJson = async (response: Response): Promise<any> => response.json();
