import { ApiError, ConflictError, StatusUnavailableError } from "./errors";
import { participationWaiverDocument, privacyMediaDocument } from "./legal-documents";
import type {
  CaseStatus,
  DataStore,
  IdentityLifecycleEvent,
  OpsWaiverReceiptResendResult,
  Page,
  PlayerAccessState,
  SponsorContributionRange,
  SponsorInquiryCounts,
  SponsorInquiryInput,
  SponsorInquiryRecord,
  SponsorInquiryState,
  SponsorSupportType,
  StoredMedia,
  WaiverAcceptanceInput,
  WaiverAcceptanceRecord,
  WaiverDocumentIdentity,
  WaiverReceiptErrorCode,
  WaiverReceiptCompletion,
  WaiverReceiptEnvelope,
  WaiverReceiptJob,
  WaiverReviewRecord,
  ZoneState
} from "./types";

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const value = (input: unknown): string => (typeof input === "string" ? input : "");
const nullable = (input: unknown): string | null =>
  typeof input === "string" && input.length > 0 ? input : null;
const numberOrNull = (input: unknown): number | null =>
  typeof input === "number" && Number.isFinite(input) ? input : null;
const json = (input: unknown) => JSON.stringify(input ?? null);

const parseJson = <T>(input: unknown, fallback: T): T => {
  if (typeof input !== "string") return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
};

const pageLimit = (limit: number | undefined) => Math.min(Math.max(limit ?? 25, 1), 50);

const statusFromRow = (row: Row): CaseStatus => ({
  state: row.state as CaseStatus["state"],
  hours: {
    opens: value(row.hours_open),
    closes: value(row.hours_close),
    timezone: value(row.timezone)
  },
  updatedAt: value(row.updated_at),
  nextClue:
    row.next_clue_title && row.next_clue_at
      ? { title: value(row.next_clue_title), releasesAt: value(row.next_clue_at) }
      : null,
  version: Number(row.version)
});

const sponsorFromRow = (row: Row): SponsorInquiryRecord => ({
  id: value(row.id),
  referenceCode: value(row.reference_code),
  contactName: value(row.contact_name),
  organization: value(row.organization),
  email: value(row.email),
  phone: nullable(row.phone),
  supportType: row.support_type as SponsorSupportType,
  contributionRange: nullable(row.contribution_range) as SponsorContributionRange | null,
  desiredOutcome: value(row.desired_outcome),
  acknowledgementVersion: value(row.acknowledgement_version),
  state: row.state as SponsorInquiryState,
  createdAt: value(row.created_at),
  updatedAt: value(row.updated_at)
});

const emptySponsorInquiryCounts = (): SponsorInquiryCounts => ({
  new: 0,
  contacted: 0,
  qualified: 0,
  accepted: 0,
  closed: 0
});

const sponsorInquiryStates = new Set<SponsorInquiryState>([
  "new",
  "contacted",
  "qualified",
  "accepted",
  "closed"
]);

const sponsorReference = () =>
  `SP-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;

const sponsorCursor = (row: Row) =>
  btoa(`${value(row.created_at)}\n${value(row.id)}`)
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
    const sponsorId = decoded.slice(separator + 1);
    if (separator < 1 || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !sponsorId) throw new Error();
    return { createdAt, sponsorId };
  } catch {
    throw new ApiError(400, "invalid_cursor", "The sponsor inquiry cursor is invalid.");
  }
};

const escapeLike = (input: string) =>
  input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

const sponsorColumns = `id, reference_code, contact_name, organization, email, phone,
  support_type, contribution_range, desired_outcome, acknowledgement_version,
  state, created_at, updated_at`;

const isSponsorIdempotencyConflict = (error: unknown) =>
  error instanceof Error &&
  /UNIQUE constraint failed:\s*sponsor_inquiries\.idempotency_key/i.test(error.message);

const waiverIdempotencyScope = (subject: string) => `waiver_acceptance:${subject}`;
const waiverReference = (acceptanceId: string) =>
  `TLS-W-${acceptanceId.slice(0, 8).toUpperCase()}`;
const isWaiverIdempotencyConflict = (error: unknown) =>
  error instanceof Error &&
  /UNIQUE constraint failed:\s*idempotency_keys\.scope,\s*idempotency_keys\.idempotency_key/i.test(
    error.message
  );
const waiverReceiptErrorCodes = new Set<WaiverReceiptErrorCode>([
  "document_mismatch",
  "provider_unavailable",
  "provider_rejected",
  "provider_response_invalid",
  "provider_delivery_uncertain"
]);

const safeProviderReference = /^[\x20-\x7e]{1,128}$/;

const validProviderAcceptance = (
  result: Extract<WaiverReceiptCompletion, { status: "sent" }>
) => {
  const providerKindMatches =
    (result.provider === "microsoft_graph" &&
      (result.providerReferenceKind === "graph_request_id" ||
        result.providerReferenceKind === "client_request_id")) ||
    (result.provider === "resend" && result.providerReferenceKind === "resend_message_id");
  const referenceIsSafe =
    typeof result.providerReference === "string" &&
    result.providerReference === result.providerReference.trim() &&
    safeProviderReference.test(result.providerReference);
  const parsedAcceptedAt =
    typeof result.acceptedAt === "string" ? new Date(result.acceptedAt) : null;
  const acceptedAtIsCanonical =
    parsedAcceptedAt !== null &&
    Number.isFinite(parsedAcceptedAt.getTime()) &&
    parsedAcceptedAt.toISOString() === result.acceptedAt;
  return providerKindMatches && referenceIsSafe && acceptedAtIsCanonical;
};

const waiverReviewFromRow = (row: Row): WaiverReviewRecord => ({
  id: value(row.id),
  subject: value(row.hunter_subject),
  documentVersion: value(row.document_version),
  documentHash: value(row.document_hash),
  reviewedAt: value(row.reviewed_at)
});

const mediaFromInput = (input: unknown): StoredMedia[] =>
  Array.isArray(input)
    ? input.filter(
        (item): item is StoredMedia =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as StoredMedia).id === "string" &&
              typeof (item as StoredMedia).key === "string"
          )
      )
    : [];

export const featureSwitches = (rows: Row[]) => {
  const values = Object.fromEntries(rows.map((row) => [value(row.key), row.enabled === 1]));
  return {
    boardVisible: values.board_visible === true,
    notesEnabled: values.notes_enabled === true,
    repliesEnabled: values.replies_enabled === true
  };
};

const consentProjection = (row: Row) => ({
  huntEmail: row.hunt_email_consent === 1,
  marketing: row.marketing_consent === 1
});

const subscriberCursor = (row: Row) =>
  btoa(`${value(row.updated_at)}\n${value(row.subject)}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const parseSubscriberCursor = (cursor: string | null | undefined) => {
  if (!cursor) return null;
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const separator = decoded.indexOf("\n");
    const updatedAt = decoded.slice(0, separator);
    const subject = decoded.slice(separator + 1);
    if (separator < 1 || !/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !subject) throw new Error();
    return { updatedAt, subject };
  } catch {
    throw new ApiError(400, "invalid_cursor", "The subscriber cursor is invalid.");
  }
};

export class D1DataStore implements DataStore {
  constructor(private readonly db: D1Database) {}

  async getStatus(): Promise<CaseStatus> {
    const row = await this.db.prepare("SELECT * FROM case_status WHERE id = 1").first<Row>();
    if (!row) throw new StatusUnavailableError();
    return statusFromRow(row);
  }

  async listUpdates(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? now();
    const result = await this.db
      .prepare(
        `SELECT id, title, body, publisher_name, published_at
         FROM official_updates
         WHERE status = 'published' AND published_at <= ?
         ORDER BY published_at DESC, id DESC LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      publishedAt: row.published_at,
      publisherName: row.publisher_name
    }));
    return {
      items,
      nextCursor: hasMore ? value(rows[limit - 1]?.published_at) : null
    };
  }

  async getCurrentRules(): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT id, version, title, body, updated_at
         FROM rules_versions WHERE status = 'published' LIMIT 1`
      )
      .first<Row>();
    return row
      ? {
          id: row.id,
          version: row.version,
          title: row.title,
          body: row.body,
          lastUpdatedAt: row.updated_at
        }
      : null;
  }

  async listZones(): Promise<Record<string, unknown>[]> {
    const result = await this.db
      .prepare(
        `SELECT id, slug, label, state, instruction, geojson, verified_at
         FROM zones WHERE is_published = 1 ORDER BY label`
      )
      .all<Row>();
    return result.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      label: row.label,
      state: row.state,
      instruction: row.instruction,
      geojson: parseJson(row.geojson, null),
      verifiedAt: row.verified_at
    }));
  }

  async listWaypoints(): Promise<Record<string, unknown>[]> {
    const result = await this.db
      .prepare(
        `SELECT w.id, w.name, w.description, COALESCE(z.state, 'temporarily_closed') AS zone_state
         FROM waypoints w LEFT JOIN zones z ON z.id = w.zone_id
         WHERE w.is_published = 1 ORDER BY w.id`
      )
      .all<Row>();
    return result.results.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description,
      zoneState: row.zone_state
    }));
  }

  async listBoard(
    waypointId: number | null,
    options: { limit?: number; cursor?: string | null } = {}
  ): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? now();
    const condition = waypointId ? "AND n.waypoint_id = ?" : "";
    let notesStatement = this.db.prepare(
        `SELECT n.id, n.waypoint_id, n.body, n.created_at, n.published_at, p.public_handle
         FROM field_notes n JOIN hunter_profiles p ON p.subject = n.author_subject
         WHERE n.status = 'approved' AND n.published_at <= ? ${condition}
         ORDER BY n.published_at DESC, n.id DESC LIMIT ?`
      );
    notesStatement = waypointId
      ? notesStatement.bind(cursor, waypointId, limit + 1)
      : notesStatement.bind(cursor, limit + 1);
    const notesResult = await notesStatement.all<Row>();
    const rows = notesResult.results;
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const noteIds = selected.map((row) => value(row.id));
    const repliesByNote = new Map<string, Record<string, unknown>[]>();
    const mediaByNote = new Map<string, Record<string, unknown>[]>();

    if (noteIds.length > 0) {
      const placeholders = noteIds.map(() => "?").join(",");
      const [repliesResult, mediaResult] = await Promise.all([
        this.db
          .prepare(
            `SELECT r.id, r.field_note_id, r.body, r.created_at, p.public_handle
             FROM field_note_replies r JOIN hunter_profiles p ON p.subject = r.author_subject
             WHERE r.status = 'published' AND r.field_note_id IN (${placeholders})
             ORDER BY r.created_at`
          )
          .bind(...noteIds)
          .all<Row>(),
        this.db
          .prepare(
            `SELECT id, owner_id FROM media_uploads
             WHERE owner_kind = 'field_note' AND status = 'ready' AND owner_id IN (${placeholders})
             ORDER BY created_at`
          )
          .bind(...noteIds)
          .all<Row>()
      ]);
      for (const row of repliesResult.results) {
        const owner = value(row.field_note_id);
        const replies = repliesByNote.get(owner) ?? [];
        replies.push({
          id: row.id,
          body: row.body,
          authorHandle: row.public_handle,
          createdAt: row.created_at
        });
        repliesByNote.set(owner, replies);
      }
      for (const row of mediaResult.results) {
        const owner = value(row.owner_id);
        const media = mediaByNote.get(owner) ?? [];
        media.push({ id: row.id, url: `/api/v1/media/${row.id}` });
        mediaByNote.set(owner, media);
      }
    }

    const items = selected.map((row) => ({
      id: row.id,
      waypointId: Number(row.waypoint_id),
      body: row.body,
      authorHandle: row.public_handle,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      media: mediaByNote.get(value(row.id)) ?? [],
      replies: repliesByNote.get(value(row.id)) ?? []
    }));
    return {
      items,
      nextCursor: hasMore ? value(selected.at(-1)?.publishedAt) : null
    };
  }

  async getPublicMedia(mediaId: string): Promise<{ key: string; contentType: string } | null> {
    const row = await this.db
      .prepare(
        `SELECT m.derivative_object_key, m.content_type
         FROM media_uploads m
         JOIN field_notes n ON n.id = m.owner_id AND m.owner_kind = 'field_note'
         WHERE m.id = ? AND m.status = 'ready' AND n.status = 'approved'
           AND m.derivative_object_key IS NOT NULL
         LIMIT 1`
      )
      .bind(mediaId)
      .first<Row>();
    if (!row || !value(row.derivative_object_key).startsWith("derivatives/")) return null;
    return {
      key: value(row.derivative_object_key),
      contentType: value(row.content_type)
    };
  }

  async getReportByIdempotencyKey(idempotencyKey: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT record_id FROM idempotency_keys
         WHERE scope = 'report' AND idempotency_key = ? AND expires_at > ? LIMIT 1`
      )
      .bind(idempotencyKey, now())
      .first<Row>();
    return row ? this.reportById(value(row.record_id)) : null;
  }

  async createReport(
    input: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<{ value: Record<string, unknown>; replayed: boolean }> {
    const replay = await this.db
      .prepare("SELECT record_id FROM idempotency_keys WHERE scope = 'report' AND idempotency_key = ?")
      .bind(idempotencyKey)
      .first<Row>();
    if (replay) {
      const existing = await this.reportById(value(replay.record_id));
      if (existing) return { value: existing, replayed: true };
    }

    const reportId = id();
    const createdAt = now();
    const media = mediaFromInput(input.media);
    const statements = [
      this.db
        .prepare(
          `INSERT INTO private_reports
           (id, report_type, hunter_subject, reporter_name, reporter_email, reporter_phone,
            waypoint_id, location_description, latitude, longitude, details, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`
        )
        .bind(
          reportId,
          input.type,
          input.hunterSubject ?? null,
          input.name,
          input.email,
          input.phone ?? null,
          input.waypointId ?? null,
          input.locationDescription,
          input.latitude ?? null,
          input.longitude ?? null,
          input.details,
          createdAt,
          createdAt
        ),
      this.db
        .prepare(
          `INSERT INTO report_events (id, report_id, event_type, actor_subject, occurred_at)
           VALUES (?, ?, 'received', ?, ?)`
        )
        .bind(id(), reportId, input.hunterSubject ?? null, createdAt),
      this.db
        .prepare(
          `INSERT INTO idempotency_keys (scope, idempotency_key, record_id, created_at, expires_at)
           VALUES ('report', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+24 hours'))`
        )
        .bind(idempotencyKey, reportId, createdAt, createdAt),
      this.db
        .prepare(
          `INSERT INTO notification_jobs
           (id, kind, target_record_id, status, attempts, created_at, updated_at)
           VALUES (?, 'report_received', ?, 'pending', 0, ?, ?)`
        )
        .bind(id(), reportId, createdAt, createdAt)
    ];
    for (const item of media) statements.push(this.mediaStatement(item, "report", reportId, nullable(input.hunterSubject)));

    try {
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.db
        .prepare("SELECT record_id FROM idempotency_keys WHERE scope = 'report' AND idempotency_key = ?")
        .bind(idempotencyKey)
        .first<Row>();
      if (raced) {
        const existing = await this.reportById(value(raced.record_id));
        if (existing) return { value: existing, replayed: true };
      }
      throw error;
    }
    const created = await this.reportById(reportId);
    return { value: created!, replayed: false };
  }

  async getSponsorInquiryByIdempotencyKey(key: string): Promise<SponsorInquiryRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${sponsorColumns}
         FROM sponsor_inquiries WHERE idempotency_key = ? LIMIT 1`
      )
      .bind(key)
      .first<Row>();
    return row ? sponsorFromRow(row) : null;
  }

  async createSponsorInquiry(
    input: SponsorInquiryInput,
    key: string
  ): Promise<{ value: SponsorInquiryRecord; replayed: boolean }> {
    const existing = await this.getSponsorInquiryByIdempotencyKey(key);
    if (existing) return { value: existing, replayed: true };

    const inquiryId = id();
    const referenceCode = sponsorReference();
    const createdAt = now();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO sponsor_inquiries
           (id, reference_code, idempotency_key, contact_name, organization, email, phone,
            support_type, contribution_range, desired_outcome, acknowledgement_version,
            acknowledged_at, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
        )
        .bind(
          inquiryId,
          referenceCode,
          key,
          input.contactName,
          input.organization,
          input.email,
          input.phone,
          input.supportType,
          input.contributionRange,
          input.desiredOutcome,
          input.acknowledgementVersion,
          createdAt,
          createdAt,
          createdAt
        ),
      this.db
        .prepare(
          `INSERT INTO sponsor_inquiry_events
           (id, inquiry_id, actor_subject, event_type, from_state, to_state, note, created_at)
           VALUES (?, ?, NULL, 'submitted', NULL, 'new', NULL, ?)`
        )
        .bind(id(), inquiryId, createdAt)
    ];

    try {
      await this.db.batch(statements);
    } catch (error) {
      if (!isSponsorIdempotencyConflict(error)) throw error;
      const replay = await this.getSponsorInquiryByIdempotencyKey(key);
      if (replay) return { value: replay, replayed: true };
      throw error;
    }

    const created = await this.sponsorById(inquiryId);
    if (!created) throw new Error("The sponsor inquiry was not available after creation.");
    return { value: created, replayed: false };
  }

  async listSponsorInquiries(
    options: {
      limit?: number;
      cursor?: string | null;
      state?: SponsorInquiryState | null;
      supportType?: SponsorSupportType | null;
      query?: string | null;
    } = {}
  ): Promise<Page<SponsorInquiryRecord>> {
    const limit = pageLimit(options.limit);
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (options.state) {
      conditions.push("state = ?");
      bindings.push(options.state);
    }
    if (options.supportType) {
      conditions.push("support_type = ?");
      bindings.push(options.supportType);
    }
    const query = options.query?.trim();
    if (query) {
      const pattern = `%${escapeLike(query)}%`;
      conditions.push(
        "(contact_name LIKE ? ESCAPE '\\' OR organization LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"
      );
      bindings.push(pattern, pattern, pattern);
    }
    const cursor = parseSponsorCursor(options.cursor);
    if (cursor) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.sponsorId);
    }
    bindings.push(limit + 1);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.db
      .prepare(
        `SELECT ${sponsorColumns}
         FROM sponsor_inquiries
         ${where}
         ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .bind(...bindings)
      .all<Row>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    return {
      items: selected.map(sponsorFromRow),
      nextCursor: hasMore && selected.length > 0 ? sponsorCursor(selected[selected.length - 1]!) : null
    };
  }

  async countSponsorInquiriesByState(): Promise<SponsorInquiryCounts> {
    const result = await this.db
      .prepare(
        `SELECT state, COUNT(*) AS count
         FROM sponsor_inquiries
         GROUP BY state`
      )
      .all<Row>();
    const counts = emptySponsorInquiryCounts();
    for (const row of result.results) {
      const state = value(row.state) as SponsorInquiryState;
      const count = Number(row.count);
      if (sponsorInquiryStates.has(state) && Number.isSafeInteger(count) && count >= 0) {
        counts[state] = count;
      }
    }
    return counts;
  }

  async updateSponsorInquiry(
    sponsorId: string,
    input: { state: SponsorInquiryState; note: string | null },
    actorSubject: string
  ): Promise<SponsorInquiryRecord | null> {
    const current = await this.sponsorById(sponsorId);
    if (!current) return null;

    const note = input.note && input.note.trim().length > 0 ? input.note : null;
    const stateChanged = input.state !== current.state;
    if (!stateChanged && !note) return current;

    const updatedAt = now();
    const eventType = stateChanged ? "state_changed" : "note_added";
    const [eventResult, updateResult] = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO sponsor_inquiry_events
           (id, inquiry_id, actor_subject, event_type, from_state, to_state, note, created_at)
           SELECT ?, id, ?, ?, ?, ?, ?, ?
           FROM sponsor_inquiries WHERE id = ? AND state = ?`
        )
        .bind(
          id(),
          actorSubject,
          eventType,
          current.state,
          input.state,
          note,
          updatedAt,
          sponsorId,
          current.state
        ),
      this.db
        .prepare(
          `UPDATE sponsor_inquiries SET state = ?, updated_at = ?
           WHERE id = ? AND state = ?`
        )
        .bind(input.state, updatedAt, sponsorId, current.state)
    ]);
    if (Number(eventResult?.meta.changes) !== 1 || Number(updateResult?.meta.changes) !== 1) {
      throw new ConflictError("This sponsor inquiry changed. Refresh and try again.");
    }
    return this.sponsorById(sponsorId);
  }

  async getPlayerAccount(subject: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT subject, verified_email, account_state, created_at, updated_at,
                last_seen_at, profile_completed_at, deleted_at
         FROM player_accounts WHERE subject = ?`
      )
      .bind(subject)
      .first<Row>();
    return row ? {
      subject: row?.subject,
      verifiedEmail: row?.verified_email,
      accountState: row?.account_state,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
      lastSeenAt: row?.last_seen_at,
      profileCompletedAt: row?.profile_completed_at,
      deletedAt: row?.deleted_at
    } : null;
  }

  async upsertPlayerAccount(subject: string, verifiedEmail: string): Promise<Record<string, unknown>> {
    const timestamp = now();
    await this.db
      .prepare(
        `INSERT INTO player_accounts
         (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
         VALUES (?, ?, 'active', ?, ?, ?)
         ON CONFLICT(subject) DO UPDATE SET
           verified_email = excluded.verified_email, account_state = 'active',
           updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at,
           deleted_at = NULL`
      )
      .bind(subject, verifiedEmail.trim().toLowerCase(), timestamp, timestamp, timestamp)
      .run();
    return (await this.getPlayerAccount(subject))!;
  }

  async getPlayerAccess(subject: string): Promise<PlayerAccessState> {
    const row = await this.db
      .prepare(
        `SELECT a.account_state, p.subject AS profile_subject,
          (SELECT action FROM legal_acceptance_events l
           WHERE l.hunter_subject = a.subject AND l.document_type = 'privacy_media'
             AND l.document_version = ? AND l.document_hash = ?
           ORDER BY l.accepted_at DESC, l.id DESC LIMIT 1) AS privacy_action,
          (SELECT document_version FROM legal_acceptance_events l
           WHERE l.hunter_subject = a.subject AND l.document_type = 'privacy_media'
             AND l.document_version = ? AND l.document_hash = ? AND l.action = 'accepted'
           ORDER BY l.accepted_at DESC, l.id DESC LIMIT 1) AS privacy_version
          ,(SELECT action FROM legal_acceptance_events l
           WHERE l.hunter_subject = a.subject AND l.document_type = 'participation_waiver'
             AND l.document_version = ? AND l.document_hash = ?
           ORDER BY l.accepted_at DESC, l.id DESC LIMIT 1) AS waiver_action
         FROM player_accounts a LEFT JOIN hunter_profiles p ON p.subject = a.subject
         WHERE a.subject = ?`
      )
      .bind(
        privacyMediaDocument.version,
        privacyMediaDocument.hash,
        privacyMediaDocument.version,
        privacyMediaDocument.hash,
        participationWaiverDocument.version,
        participationWaiverDocument.hash,
        subject
      )
      .first<Row>();
    if (!row) {
      return {
        accountState: "missing",
        profileComplete: false,
        privacyMediaRequired: true,
        privacyMediaVersion: null,
        waiverStatus: "pending",
        waiverVersion: null,
        participationUnlocked: false
      };
    }
    const privacyAccepted = row.privacy_action === "accepted";
    const active = row.account_state === "active";
    const waiverAccepted = row.waiver_action === "accepted";
    const profileComplete = Boolean(row.profile_subject);
    return {
      accountState: row.account_state as PlayerAccessState["accountState"],
      profileComplete,
      privacyMediaRequired: !privacyAccepted,
      privacyMediaVersion: privacyAccepted ? value(row.privacy_version) : null,
      waiverStatus: active ? (waiverAccepted ? "accepted" : "required") : "pending",
      waiverVersion: waiverAccepted ? participationWaiverDocument.version : null,
      participationUnlocked: active && profileComplete && privacyAccepted && waiverAccepted
    };
  }

  private assertCurrentWaiverDocument(document: WaiverDocumentIdentity) {
    if (
      document.version !== participationWaiverDocument.version ||
      document.hash !== participationWaiverDocument.hash
    ) {
      throw new ApiError(
        409,
        "waiver_document_stale",
        "The participation waiver changed. Review the current version before accepting."
      );
    }
  }

  async recordWaiverReview(
    subject: string,
    document: WaiverDocumentIdentity
  ): Promise<WaiverReviewRecord> {
    this.assertCurrentWaiverDocument(document);
    const account = await this.db
      .prepare("SELECT account_state FROM player_accounts WHERE subject = ?")
      .bind(subject)
      .first<Row>();
    if (account?.account_state !== "active") {
      throw new ApiError(409, "player_account_required", "An active player account is required.");
    }
    const review: WaiverReviewRecord = {
      id: id(),
      subject,
      documentVersion: document.version,
      documentHash: document.hash,
      reviewedAt: now()
    };
    await this.db
      .prepare(
        `INSERT INTO legal_document_review_events
         (id, hunter_subject, document_type, document_version, document_hash, reviewed_at)
         VALUES (?, ?, 'participation_waiver', ?, ?, ?)`
      )
      .bind(
        review.id,
        subject,
        review.documentVersion,
        review.documentHash,
        review.reviewedAt
      )
      .run();
    return review;
  }

  async getWaiverReview(subject: string, reviewEventId: string): Promise<WaiverReviewRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, hunter_subject, document_version, document_hash, reviewed_at
         FROM legal_document_review_events
         WHERE id = ? AND hunter_subject = ? AND document_type = 'participation_waiver'
         LIMIT 1`
      )
      .bind(reviewEventId, subject)
      .first<Row>();
    return row ? waiverReviewFromRow(row) : null;
  }

  private async waiverAcceptanceById(
    acceptanceId: string,
    subject: string | null = null,
    currentOnly = false
  ): Promise<WaiverAcceptanceRecord | null> {
    const conditions = [
      "l.id = ?",
      "l.document_type = 'participation_waiver'",
      "l.action = 'accepted'"
    ];
    const bindings: unknown[] = [acceptanceId];
    if (subject !== null) {
      conditions.push("l.hunter_subject = ?");
      bindings.push(subject);
    }
    if (currentOnly) {
      conditions.push("l.document_version = ?", "l.document_hash = ?");
      bindings.push(participationWaiverDocument.version, participationWaiverDocument.hash);
    }
    const row = await this.db
      .prepare(
        `SELECT l.id, l.hunter_subject, l.document_version, l.document_hash, l.accepted_at,
                j.id AS job_id, j.status AS job_status, j.attempts AS job_attempts,
                j.last_error_code AS job_last_error_code,
                (SELECT occurred_at FROM notification_delivery_events d
                 WHERE d.notification_job_id = j.id AND d.event_type = 'sent'
                 ORDER BY d.occurred_at DESC, d.id DESC LIMIT 1) AS sent_at
         FROM legal_acceptance_events l
         JOIN notification_jobs j
           ON j.target_record_id = l.id AND j.kind = 'waiver_receipt'
         WHERE ${conditions.join(" AND ")}
         LIMIT 1`
      )
      .bind(...bindings)
      .first<Row>();
    if (!row) return null;
    const participants = await this.db
      .prepare(
        `SELECT participant_role, full_name, birth_year, guardian_attested
         FROM waiver_acceptance_participants
         WHERE acceptance_event_id = ?
         ORDER BY CASE participant_role WHEN 'adult' THEN 0 ELSE 1 END, id`
      )
      .bind(acceptanceId)
      .all<Row>();
    return {
      id: value(row.id),
      subject: value(row.hunter_subject),
      documentVersion: value(row.document_version),
      documentHash: value(row.document_hash),
      acceptedAt: value(row.accepted_at),
      referenceCode: waiverReference(value(row.id)),
      participants: participants.results.map((participant) => ({
        role: participant.participant_role as "adult" | "minor",
        fullName: value(participant.full_name),
        birthYear: numberOrNull(participant.birth_year),
        guardianAttested: participant.guardian_attested === 1
      })),
      receipt: {
        jobId: value(row.job_id),
        status:
          row.job_status === "failed" && row.job_last_error_code === "provider_delivery_uncertain"
            ? "uncertain"
            : (row.job_status as WaiverAcceptanceRecord["receipt"]["status"]),
        attempts: Number(row.job_attempts),
        sentAt: nullable(row.sent_at)
      }
    };
  }

  private async waiverReplay(
    subject: string,
    idempotencyKey: string
  ): Promise<WaiverAcceptanceRecord | null> {
    const replay = await this.db
      .prepare("SELECT record_id FROM idempotency_keys WHERE scope = ? AND idempotency_key = ?")
      .bind(waiverIdempotencyScope(subject), idempotencyKey)
      .first<Row>();
    if (!replay) return null;
    return this.waiverAcceptanceById(value(replay.record_id), subject);
  }

  async acceptParticipationWaiver(
    subject: string,
    input: WaiverAcceptanceInput
  ): Promise<{ value: WaiverAcceptanceRecord; replayed: boolean }> {
    this.assertCurrentWaiverDocument({
      version: input.documentVersion,
      hash: input.documentHash
    });
    const replay = await this.waiverReplay(subject, input.idempotencyKey);
    if (replay) return { value: replay, replayed: true };

    const review = await this.db
      .prepare(
        `SELECT r.id, r.hunter_subject, r.document_version, r.document_hash, r.reviewed_at
         FROM legal_document_review_events r
         JOIN player_accounts a ON a.subject = r.hunter_subject AND a.account_state = 'active'
         WHERE r.id = ? AND r.hunter_subject = ?
           AND r.document_type = 'participation_waiver'
           AND r.document_version = ? AND r.document_hash = ?
         LIMIT 1`
      )
      .bind(
        input.reviewEventId,
        subject,
        participationWaiverDocument.version,
        participationWaiverDocument.hash
      )
      .first<Row>();
    if (!review) {
      throw new ApiError(
        409,
        "waiver_review_required",
        "Review the current participation waiver before accepting."
      );
    }
    if (!input.adultName.trim() || (input.minors.length > 0 && !input.guardianAttested)) {
      throw new ApiError(
        422,
        "waiver_participants_invalid",
        "The adult and guardian attestations are incomplete."
      );
    }

    const timestamp = now();
    const acceptanceId = id();
    const jobId = id();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO legal_acceptance_events
           (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
           SELECT ?, r.hunter_subject, 'participation_waiver',
                  r.document_version, r.document_hash, 'accepted', ?
           FROM legal_document_review_events r
           JOIN player_accounts a
             ON a.subject = r.hunter_subject AND a.account_state = 'active'
           WHERE r.id = ? AND r.hunter_subject = ?
             AND r.document_type = 'participation_waiver'
             AND r.document_version = ? AND r.document_hash = ?`
        )
        .bind(
          acceptanceId,
          timestamp,
          input.reviewEventId,
          subject,
          participationWaiverDocument.version,
          participationWaiverDocument.hash
        ),
      this.db
        .prepare(
          `INSERT INTO waiver_acceptance_participants
           (id, acceptance_event_id, participant_role, full_name, birth_year, guardian_attested, created_at)
           VALUES (?, ?, 'adult', ?, NULL, 0, ?)`
        )
        .bind(id(), acceptanceId, input.adultName.trim(), timestamp),
      ...input.minors.map((minor) =>
        this.db
          .prepare(
            `INSERT INTO waiver_acceptance_participants
             (id, acceptance_event_id, participant_role, full_name, birth_year, guardian_attested, created_at)
             VALUES (?, ?, 'minor', ?, ?, 1, ?)`
          )
          .bind(id(), acceptanceId, minor.fullName.trim(), minor.birthYear, timestamp)
      ),
      this.db
        .prepare(
          `INSERT INTO notification_jobs
           (id, kind, target_record_id, status, attempts, created_at, updated_at)
           VALUES (?, 'waiver_receipt', ?, 'pending', 0, ?, ?)`
        )
        .bind(jobId, acceptanceId, timestamp, timestamp),
      this.db
        .prepare(
          `INSERT INTO notification_delivery_events
           (id, notification_job_id, event_type, occurred_at)
           VALUES (?, ?, 'queued', ?)`
        )
        .bind(id(), jobId, timestamp),
      this.db
        .prepare(
          `INSERT INTO idempotency_keys
           (scope, idempotency_key, record_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, '9999-12-31T23:59:59.999Z')`
        )
        .bind(waiverIdempotencyScope(subject), input.idempotencyKey, acceptanceId, timestamp),
      this.db
        .prepare(
          `UPDATE player_accounts SET updated_at = ?, last_seen_at = ?
           WHERE subject = ? AND account_state = 'active'`
        )
        .bind(timestamp, timestamp, subject)
    ];

    try {
      await this.db.batch(statements);
    } catch (error) {
      if (!isWaiverIdempotencyConflict(error)) throw error;
      const winner = await this.waiverReplay(subject, input.idempotencyKey);
      if (!winner) throw error;
      return { value: winner, replayed: true };
    }
    const accepted = await this.waiverAcceptanceById(acceptanceId, subject);
    if (!accepted) throw new ConflictError("The waiver acceptance could not be read after saving.");
    return { value: accepted, replayed: false };
  }

  async getParticipationWaiver(subject: string): Promise<WaiverAcceptanceRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, action FROM legal_acceptance_events
         WHERE hunter_subject = ? AND document_type = 'participation_waiver'
           AND document_version = ? AND document_hash = ?
         ORDER BY accepted_at DESC, id DESC LIMIT 1`
      )
      .bind(subject, participationWaiverDocument.version, participationWaiverDocument.hash)
      .first<Row>();
    return row?.action === "accepted"
      ? this.waiverAcceptanceById(value(row.id), subject, true)
      : null;
  }

  async getOpsWaiverDetail(subject: string): Promise<WaiverAcceptanceRecord | null> {
    return this.getParticipationWaiver(subject);
  }

  async getAndAuditOpsWaiverDetail(
    subject: string,
    actorSubject: string
  ): Promise<WaiverAcceptanceRecord | null> {
    const detail = await this.getOpsWaiverDetail(subject);
    if (!detail) return null;
    // The endpoint receives no private detail until this append succeeds. The legal
    // acceptance is immutable, so its exact ID remains a stable audit target.
    await this.audit(
      actorSubject,
      "player.waiver-detail.viewed",
      "legal_acceptance",
      detail.id,
      {}
    );
    return detail;
  }

  async getWaiverReceiptEnvelope(acceptanceId: string): Promise<WaiverReceiptEnvelope | null> {
    const acceptance = await this.waiverAcceptanceById(acceptanceId);
    if (!acceptance) return null;
    const account = await this.db
      .prepare(
        `SELECT verified_email FROM player_accounts
         WHERE subject = ? AND account_state = 'active' LIMIT 1`
      )
      .bind(acceptance.subject)
      .first<Row>();
    const verifiedEmail = nullable(account?.verified_email);
    return verifiedEmail ? { acceptance, verifiedEmail } : null;
  }

  private async requeueWaiverReceiptJob(
    acceptance: WaiverAcceptanceRecord,
    additionalStatements: (requeueToken: string) => D1PreparedStatement[] = () => [],
    guardStatements: (requeueToken: string) => D1PreparedStatement[] = () => [],
    unsentOnly = false,
    allowUncertainRetry = false
  ): Promise<boolean> {
    const timestamp = now();
    const requeueToken = id();
    const deliveryEventId = id();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO notification_job_leases
           (notification_job_id, lease_token, attempt_generation, lease_until, claimed_at)
           SELECT j.id, ?, j.attempts, ?, ?
           FROM notification_jobs j
           WHERE j.id = ? AND j.kind = 'waiver_receipt' AND j.target_record_id = ?
             AND (? = 0 OR j.status IN ('pending', 'failed'))
             AND (
               (? = 1 AND j.status = 'failed'
                 AND j.last_error_code = 'provider_delivery_uncertain')
               OR
               (? = 0 AND COALESCE(j.last_error_code, '') <> 'provider_delivery_uncertain')
             )
             AND NOT EXISTS (
               SELECT 1 FROM notification_job_leases active
               WHERE active.notification_job_id = j.id AND active.lease_until > ?
             )
           ON CONFLICT(notification_job_id) DO UPDATE SET
             lease_token = excluded.lease_token,
             attempt_generation = excluded.attempt_generation,
             lease_until = excluded.lease_until,
             claimed_at = excluded.claimed_at
           WHERE notification_job_leases.lease_until <= ?`
        )
        .bind(
          requeueToken,
          timestamp,
          timestamp,
          acceptance.receipt.jobId,
          acceptance.id,
          unsentOnly ? 1 : 0,
          allowUncertainRetry ? 1 : 0,
          allowUncertainRetry ? 1 : 0,
          timestamp,
          timestamp
        ),
      ...guardStatements(requeueToken),
      this.db
        .prepare(
          `UPDATE notification_jobs
           SET status = 'pending', next_attempt_at = NULL, last_error_code = NULL, updated_at = ?
           WHERE id = ? AND kind = 'waiver_receipt' AND target_record_id = ?
             AND EXISTS (
               SELECT 1 FROM notification_job_leases lease
               WHERE lease.notification_job_id = notification_jobs.id AND lease.lease_token = ?
             )`
        )
        .bind(timestamp, acceptance.receipt.jobId, acceptance.id, requeueToken),
      this.db
        .prepare(
          `INSERT INTO notification_delivery_events
           (id, notification_job_id, event_type, occurred_at)
           SELECT ?, ?, 'requeued', ?
           WHERE EXISTS (
             SELECT 1 FROM notification_job_leases lease
             JOIN notification_jobs job ON job.id = lease.notification_job_id
             WHERE lease.notification_job_id = ? AND lease.lease_token = ?
               AND job.status = 'pending' AND job.next_attempt_at IS NULL
           )`
        )
        .bind(
          deliveryEventId,
          acceptance.receipt.jobId,
          timestamp,
          acceptance.receipt.jobId,
          requeueToken
        ),
      ...additionalStatements(requeueToken),
      this.db
        .prepare(
          `DELETE FROM notification_job_leases
           WHERE notification_job_id = ? AND lease_token = ?`
        )
        .bind(acceptance.receipt.jobId, requeueToken)
    ]);
    const delivery = await this.db
      .prepare(
        `SELECT 1 AS requeued FROM notification_delivery_events
         WHERE id = ? AND notification_job_id = ? AND event_type = 'requeued'`
      )
      .bind(deliveryEventId, acceptance.receipt.jobId)
      .first<Row>();
    return Boolean(delivery);
  }

  async requeueWaiverReceiptForAcceptanceReplay(
    subject: string,
    acceptanceId: string
  ): Promise<boolean> {
    const acceptance = await this.waiverAcceptanceById(acceptanceId, subject, true);
    if (!acceptance) return false;
    return this.requeueWaiverReceiptJob(acceptance, () => [], () => [], true);
  }

  async queueWaiverReceiptResend(
    subject: string,
    acceptanceId: string
  ): Promise<WaiverAcceptanceRecord | null> {
    const acceptance = await this.waiverAcceptanceById(acceptanceId, subject, true);
    if (!acceptance) return null;
    await this.requeueWaiverReceiptJob(acceptance);
    return this.waiverAcceptanceById(acceptanceId, subject, true);
  }

  async queueOpsWaiverReceiptResend(
    subject: string,
    acceptanceId: string,
    actorSubject: string,
    allowUncertainRetry = false
  ): Promise<OpsWaiverReceiptResendResult> {
    const acceptance = await this.waiverAcceptanceById(acceptanceId, subject, true);
    if (!acceptance) return { status: "not_found" };
    if (acceptance.receipt.status === "uncertain" && !allowUncertainRetry) {
      return { status: "uncertain" };
    }
    const confirmedUncertainRetry =
      acceptance.receipt.status === "uncertain" && allowUncertainRetry;
    const timestamp = now();
    const requeued = await this.requeueWaiverReceiptJob(
      acceptance,
      (requeueToken) => [
        this.db
          .prepare(
            `INSERT INTO audit_events
             (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
             SELECT ?, ?, 'player.waiver-receipt.requested', 'legal_acceptance', ?, '{}', ?
             WHERE EXISTS (
               SELECT 1 FROM notification_job_leases lease
               WHERE lease.notification_job_id = ? AND lease.lease_token = ?
             )`
          )
          .bind(
            id(),
            actorSubject,
            acceptanceId,
            timestamp,
            acceptance.receipt.jobId,
            requeueToken
          ),
        ...(confirmedUncertainRetry
          ? [
              this.db
                .prepare(
                  `INSERT INTO audit_events
                   (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
                   SELECT ?, ?, 'player.waiver-receipt.uncertain-retry-confirmed',
                          'legal_acceptance', ?, '{}', ?
                   WHERE EXISTS (
                     SELECT 1 FROM notification_job_leases lease
                     WHERE lease.notification_job_id = ? AND lease.lease_token = ?
                   )`
                )
                .bind(
                  id(),
                  actorSubject,
                  acceptanceId,
                  timestamp,
                  acceptance.receipt.jobId,
                  requeueToken
                )
            ]
          : [])
      ],
      (requeueToken) => [
        this.db
          .prepare(
            `DELETE FROM notification_job_leases
             WHERE notification_job_id = ? AND lease_token = ?
               AND NOT EXISTS (
                 SELECT 1 FROM legal_acceptance_events current
                 WHERE current.id = ? AND current.hunter_subject = ?
                   AND current.document_type = 'participation_waiver'
                   AND current.document_version = ? AND current.document_hash = ?
                   AND current.action = 'accepted'
                   AND NOT EXISTS (
                     SELECT 1 FROM legal_acceptance_events newer
                     WHERE newer.hunter_subject = current.hunter_subject
                       AND newer.document_type = current.document_type
                       AND newer.document_version = current.document_version
                       AND newer.document_hash = current.document_hash
                       AND (
                         newer.accepted_at > current.accepted_at OR
                         (newer.accepted_at = current.accepted_at AND newer.id > current.id)
                       )
                   )
               )`
          )
          .bind(
            acceptance.receipt.jobId,
            requeueToken,
            acceptanceId,
            subject,
            participationWaiverDocument.version,
            participationWaiverDocument.hash
          )
      ],
      false,
      confirmedUncertainRetry
    );
    if (!requeued) {
      const latest = await this.db
        .prepare(
          `SELECT id, action FROM legal_acceptance_events
           WHERE hunter_subject = ? AND document_type = 'participation_waiver'
             AND document_version = ? AND document_hash = ?
           ORDER BY accepted_at DESC, id DESC LIMIT 1`
        )
        .bind(subject, participationWaiverDocument.version, participationWaiverDocument.hash)
        .first<Row>();
      return latest?.id === acceptanceId && latest.action === "accepted"
        ? { status: "in_progress" }
        : { status: "not_found" };
    }
    const queued = await this.waiverAcceptanceById(acceptanceId, subject, true);
    return queued
      ? { status: "queued", acceptance: queued }
      : { status: "not_found" };
  }

  async claimWaiverReceiptJob(acceptanceId: string): Promise<WaiverReceiptJob | null> {
    const timestamp = now();
    const row = await this.db
      .prepare(
        `SELECT id, target_record_id, attempts
         FROM notification_jobs
         WHERE kind = 'waiver_receipt' AND target_record_id = ?
           AND status IN ('pending', 'failed')
           AND COALESCE(last_error_code, '') <> 'provider_delivery_uncertain'
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         LIMIT 1`
      )
      .bind(acceptanceId, timestamp)
      .first<Row>();
    if (!row) return null;
    const attempts = Number(row.attempts) + 1;
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const leaseToken = id();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO notification_job_leases
           (notification_job_id, lease_token, attempt_generation, lease_until, claimed_at)
           SELECT j.id, ?, ?, ?, ?
           FROM notification_jobs j
           WHERE j.id = ? AND j.kind = 'waiver_receipt' AND j.attempts = ?
             AND j.status IN ('pending', 'failed')
             AND COALESCE(j.last_error_code, '') <> 'provider_delivery_uncertain'
             AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
           ON CONFLICT(notification_job_id) DO UPDATE SET
             lease_token = excluded.lease_token,
             attempt_generation = excluded.attempt_generation,
             lease_until = excluded.lease_until,
             claimed_at = excluded.claimed_at
           WHERE notification_job_leases.lease_until <= ?`
        )
        .bind(
          leaseToken,
          attempts,
          leaseUntil,
          timestamp,
          value(row.id),
          Number(row.attempts),
          timestamp,
          timestamp
        ),
      this.db
        .prepare(
          `UPDATE notification_jobs
           SET status = 'pending', attempts = ?, next_attempt_at = ?, updated_at = ?, last_error_code = NULL
           WHERE id = ? AND kind = 'waiver_receipt' AND attempts = ?
             AND EXISTS (
               SELECT 1 FROM notification_job_leases lease
               WHERE lease.notification_job_id = notification_jobs.id
                 AND lease.lease_token = ? AND lease.attempt_generation = ?
             )`
        )
        .bind(
          attempts,
          leaseUntil,
          timestamp,
          value(row.id),
          Number(row.attempts),
          leaseToken,
          attempts
        ),
      this.db
        .prepare(
          `INSERT INTO notification_delivery_events
           (id, notification_job_id, event_type, occurred_at)
           SELECT ?, ?, 'attempted', ?
           WHERE EXISTS (
             SELECT 1 FROM notification_job_leases lease
             JOIN notification_jobs job ON job.id = lease.notification_job_id
             WHERE lease.notification_job_id = ? AND lease.lease_token = ?
               AND lease.attempt_generation = ? AND job.attempts = ?
           )`
        )
        .bind(id(), value(row.id), timestamp, value(row.id), leaseToken, attempts, attempts)
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) return null;
    return { id: value(row.id), acceptanceId, attempts, leaseToken };
  }

  async completeWaiverReceiptJob(
    job: WaiverReceiptJob,
    result: WaiverReceiptCompletion
  ): Promise<void> {
    if (result.status === "failed" && !waiverReceiptErrorCodes.has(result.errorCode)) {
      throw new ApiError(422, "waiver_receipt_error_invalid", "The receipt error code is invalid.");
    }
    if (result.status === "sent" && !validProviderAcceptance(result)) {
      throw new ApiError(
        422,
        "waiver_receipt_acceptance_invalid",
        "The receipt provider acceptance is invalid."
      );
    }
    const timestamp = now();
    if (result.status === "sent") {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE notification_jobs
             SET status = 'sent', next_attempt_at = NULL, last_error_code = NULL, updated_at = ?
             WHERE id = ? AND kind = 'waiver_receipt' AND attempts = ?
               AND EXISTS (
                 SELECT 1 FROM notification_job_leases lease
                 WHERE lease.notification_job_id = notification_jobs.id
                   AND lease.lease_token = ? AND lease.attempt_generation = ?
               )`
          )
          .bind(timestamp, job.id, job.attempts, job.leaseToken, job.attempts),
        this.db
          .prepare(
            `INSERT INTO notification_delivery_events
             (id, notification_job_id, event_type, provider, provider_message_id,
              provider_reference, provider_reference_kind, occurred_at)
             SELECT ?, ?, 'sent', ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM notification_job_leases lease
               JOIN notification_jobs queued ON queued.id = lease.notification_job_id
               WHERE lease.notification_job_id = ? AND lease.lease_token = ?
                 AND lease.attempt_generation = ? AND queued.attempts = ?
                 AND queued.status = 'sent' AND queued.updated_at = ?
             )`
          )
          .bind(
            id(),
            job.id,
            result.provider,
            result.provider === "resend" &&
            result.providerReferenceKind === "resend_message_id"
              ? result.providerReference
              : null,
            result.providerReference,
            result.providerReferenceKind,
            result.acceptedAt,
            job.id,
            job.leaseToken,
            job.attempts,
            job.attempts,
            timestamp
          ),
        this.db
          .prepare(
            `DELETE FROM notification_job_leases
             WHERE notification_job_id = ? AND lease_token = ? AND attempt_generation = ?`
          )
          .bind(job.id, job.leaseToken, job.attempts)
      ]);
      return;
    }
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE notification_jobs
           SET status = 'failed', last_error_code = ?, updated_at = ?
           WHERE id = ? AND kind = 'waiver_receipt' AND attempts = ?
             AND EXISTS (
               SELECT 1 FROM notification_job_leases lease
               WHERE lease.notification_job_id = notification_jobs.id
                 AND lease.lease_token = ? AND lease.attempt_generation = ?
             )`
        )
        .bind(
          result.errorCode,
          timestamp,
          job.id,
          job.attempts,
          job.leaseToken,
          job.attempts
        ),
      this.db
        .prepare(
          `INSERT INTO notification_delivery_events
           (id, notification_job_id, event_type, error_code, occurred_at)
           SELECT ?, ?, 'failed', ?, ?
           WHERE EXISTS (
             SELECT 1 FROM notification_job_leases lease
             JOIN notification_jobs queued ON queued.id = lease.notification_job_id
             WHERE lease.notification_job_id = ? AND lease.lease_token = ?
               AND lease.attempt_generation = ? AND queued.attempts = ?
               AND queued.status = 'failed' AND queued.updated_at = ?
           )`
        )
        .bind(
          id(),
          job.id,
          result.errorCode,
          timestamp,
          job.id,
          job.leaseToken,
          job.attempts,
          job.attempts,
          timestamp
        ),
      this.db
        .prepare(
          `DELETE FROM notification_job_leases
           WHERE notification_job_id = ? AND lease_token = ? AND attempt_generation = ?`
        )
        .bind(job.id, job.leaseToken, job.attempts)
    ]);
  }

  async applyIdentityEvent(event: IdentityLifecycleEvent): Promise<{ replayed: boolean }> {
    const existing = await this.db
      .prepare("SELECT event_id FROM webhook_events WHERE provider = 'clerk' AND event_id = ?")
      .bind(event.id)
      .first<Row>();
    if (existing) return { replayed: true };

    const timestamp = now();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO webhook_events (provider, event_id, received_at, processed_at)
           VALUES ('clerk', ?, ?, ?)`
        )
        .bind(event.id, timestamp, timestamp)
    ];
    if (event.type === "user.deleted") {
      statements.push(
        this.db
          .prepare(
            `UPDATE player_accounts SET verified_email = NULL, account_state = 'deleted',
              updated_at = ?, last_seen_at = ?, deleted_at = ? WHERE subject = ?`
          )
          .bind(timestamp, timestamp, timestamp, event.data.subject),
        this.db
          .prepare(
            `UPDATE hunter_profiles SET verified_email = '', full_name = 'Deleted player',
              phone = NULL, town_area = NULL, age_band = NULL, interests_json = '[]',
              discovery_source = NULL, updated_at = ? WHERE subject = ?`
          )
          .bind(timestamp, event.data.subject),
        this.db
          .prepare("UPDATE private_reports SET hunter_subject = NULL WHERE hunter_subject = ?")
          .bind(event.data.subject)
      );
    } else if (event.data.verifiedEmail) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO player_accounts
             (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
             VALUES (?, ?, 'active', ?, ?, ?)
             ON CONFLICT(subject) DO UPDATE SET verified_email = excluded.verified_email,
               account_state = 'active', updated_at = excluded.updated_at,
               last_seen_at = excluded.last_seen_at, deleted_at = NULL`
          )
          .bind(
            event.data.subject,
            event.data.verifiedEmail.trim().toLowerCase(),
            timestamp,
            timestamp,
            timestamp
          )
      );
    }
    await this.db.batch(statements);
    return { replayed: false };
  }

  async getProfile(subject: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT p.*,
           COALESCE((SELECT granted FROM consent_events c
             WHERE c.hunter_subject = p.subject AND c.consent_type = 'hunt_email'
             ORDER BY occurred_at DESC, id DESC LIMIT 1), 0) AS hunt_email_consent,
           COALESCE((SELECT granted FROM consent_events c
             WHERE c.hunter_subject = p.subject AND c.consent_type = 'marketing'
             ORDER BY occurred_at DESC, id DESC LIMIT 1), 0) AS marketing_consent
         FROM hunter_profiles p WHERE p.subject = ?`
      )
      .bind(subject)
      .first<Row>();
    return row ? this.profileFromRow(row) : null;
  }

  async upsertProfile(subject: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.upsertPlayerAccount(subject, value(input.verifiedEmail));
    const existing = await this.db
      .prepare("SELECT public_handle, created_at FROM hunter_profiles WHERE subject = ?")
      .bind(subject)
      .first<Row>();
    const timestamp = now();
    const publicHandle = existing?.public_handle ?? `Hunter ${id().slice(0, 4).toUpperCase()}`;
    const statements = [
      this.db.prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, phone, town_area, age_band,
          interests_json, discovery_source, adult_attested_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject) DO UPDATE SET
           verified_email = excluded.verified_email, full_name = excluded.full_name,
           phone = excluded.phone, town_area = excluded.town_area, age_band = excluded.age_band,
           interests_json = excluded.interests_json, discovery_source = excluded.discovery_source,
           adult_attested_at = excluded.adult_attested_at, updated_at = excluded.updated_at`
      )
      .bind(
        subject,
        input.verifiedEmail,
        input.fullName,
        publicHandle,
        null,
        input.townArea ?? null,
        null,
        json(input.interests ?? []),
        input.discoverySource ?? null,
        timestamp,
        existing?.created_at ?? timestamp,
        timestamp
      )
    ];

    const consents = (input.consents ?? {}) as Record<string, unknown>;
    const policyVersion = value(input.policyVersion) || "2026.1";
    statements.push(
      ...[
        ["hunt_email", consents.huntEmail],
        ["marketing", consents.marketing]
      ].map(([type, granted]) =>
        this.db
          .prepare(
            `INSERT INTO consent_events
             (id, hunter_subject, consent_type, granted, policy_version, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(id(), subject, type, granted === true ? 1 : 0, policyVersion, timestamp)
      ),
      this.db
        .prepare(
          `INSERT INTO legal_acceptance_events
           (id, hunter_subject, document_type, document_version, document_hash, action, accepted_at)
           SELECT ?, ?, 'privacy_media', ?, ?, 'accepted', ?
           WHERE COALESCE((
             SELECT action FROM legal_acceptance_events
             WHERE hunter_subject = ? AND document_type = 'privacy_media'
               AND document_version = ? AND document_hash = ?
             ORDER BY accepted_at DESC, id DESC LIMIT 1
           ), '') <> 'accepted'`
        )
        .bind(
          id(),
          subject,
          value(input.privacyMediaVersion),
          value(input.privacyMediaHash),
          timestamp,
          subject,
          value(input.privacyMediaVersion),
          value(input.privacyMediaHash)
        ),
      this.db
        .prepare(
          `UPDATE player_accounts SET profile_completed_at = COALESCE(profile_completed_at, ?),
             updated_at = ?, last_seen_at = ? WHERE subject = ?`
        )
        .bind(timestamp, timestamp, timestamp, subject)
    );
    await this.db.batch(statements);
    return (await this.getProfile(subject))!;
  }

  async getMemberWaypoint(waypointId: number): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT w.id, w.name, w.description, w.member_exact_url, w.member_content,
                COALESCE(z.state, 'temporarily_closed') AS zone_state
         FROM waypoints w LEFT JOIN zones z ON z.id = w.zone_id
         WHERE w.id = ? AND w.is_published = 1 LIMIT 1`
      )
      .bind(waypointId)
      .first<Row>();
    return row
      ? {
          id: Number(row.id),
          name: row.name,
          description: row.description,
          zoneState: row.zone_state,
          exactUrl: row.member_exact_url,
          memberContent: row.member_content
        }
      : null;
  }

  async upsertProgress(subject: string, waypointId: number, state: string): Promise<Record<string, unknown>> {
    const updatedAt = now();
    await this.db
      .prepare(
        `INSERT INTO waypoint_progress (hunter_subject, waypoint_id, state, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(hunter_subject, waypoint_id) DO UPDATE SET
           state = excluded.state, updated_at = excluded.updated_at`
      )
      .bind(subject, waypointId, state, updatedAt)
      .run();
    return { subject, waypointId, state, updatedAt };
  }

  async getHunterDashboard(subject: string): Promise<Record<string, unknown>> {
    const [profile, access, status, updates, waypointResult, progressResult, reportResult, noteResult] = await Promise.all([
      this.getProfile(subject),
      this.getPlayerAccess(subject),
      this.getStatus(),
      this.listUpdates({ limit: 1 }),
      this.db
        .prepare(
          `SELECT w.id, w.name, w.description, w.member_exact_url, w.member_content,
                  COALESCE(z.state, 'temporarily_closed') AS zone_state
           FROM waypoints w LEFT JOIN zones z ON z.id = w.zone_id
           WHERE w.is_published = 1 ORDER BY w.id`
        )
        .all<Row>(),
      this.db
        .prepare("SELECT waypoint_id, state, updated_at FROM waypoint_progress WHERE hunter_subject = ?")
        .bind(subject)
        .all<Row>(),
      this.db
        .prepare("SELECT id, report_type, status, created_at FROM private_reports WHERE hunter_subject = ? ORDER BY created_at DESC")
        .bind(subject)
        .all<Row>(),
      this.db
        .prepare("SELECT id, waypoint_id, body, status, created_at FROM field_notes WHERE author_subject = ? ORDER BY created_at DESC")
        .bind(subject)
        .all<Row>()
    ]);
    const waypoints = waypointResult.results.map((row) => {
      const safe = access.participationUnlocked && status.state === "open" && row.zone_state === "open";
      return {
        id: Number(row.id),
        name: row.name,
        description: row.description,
        zoneState: row.zone_state,
        exactUrl: safe ? row.member_exact_url : null,
        memberContent: safe ? row.member_content : null
      };
    });
    return {
      profile,
      ...access,
      status,
      latestUpdate: updates.items[0] ?? null,
      waypoints,
      progress: progressResult.results.map((row) => ({
        waypointId: Number(row.waypoint_id),
        state: row.state,
        updatedAt: row.updated_at
      })),
      reports: reportResult.results.map((row) => ({
        id: row.id,
        type: row.report_type,
        status: row.status,
        createdAt: row.created_at
      })),
      notes: noteResult.results.map((row) => ({
        id: row.id,
        waypointId: Number(row.waypoint_id),
        body: row.body,
        status: row.status,
        createdAt: row.created_at
      }))
    };
  }

  async createFieldNote(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const noteId = id();
    const createdAt = now();
    const media = mediaFromInput(input.media);
    const statements = [
      this.db
        .prepare(
          `INSERT INTO field_notes
           (id, author_subject, waypoint_id, body, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`
        )
        .bind(noteId, input.authorSubject, input.waypointId, input.body, createdAt, createdAt),
      this.db
        .prepare(
          `INSERT INTO field_note_revisions (id, field_note_id, body, created_at, created_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(id(), noteId, input.body, createdAt, input.authorSubject)
    ];
    for (const item of media) {
      statements.push(this.mediaStatement(item, "field_note", noteId, value(input.authorSubject)));
    }
    await this.db.batch(statements);
    return {
      id: noteId,
      waypointId: input.waypointId,
      body: input.body,
      status: "pending",
      media,
      createdAt
    };
  }

  async createReply(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const replyId = id();
    const createdAt = now();
    await this.db
      .prepare(
        `INSERT INTO field_note_replies
         (id, field_note_id, author_subject, body, status, created_at)
         VALUES (?, ?, ?, ?, 'published', ?)`
      )
      .bind(replyId, input.noteId, input.authorSubject, input.body, createdAt)
      .run();
    return { id: replyId, noteId: input.noteId, body: input.body, status: "published", createdAt };
  }

  async createFlag(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const flagId = id();
    const createdAt = now();
    await this.db
      .prepare(
        `INSERT INTO content_flags
         (id, reporter_subject, target_kind, target_id, reason, details, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'received', ?)`
      )
      .bind(
        flagId,
        input.reporterSubject,
        input.targetKind,
        input.targetId,
        input.reason,
        input.details ?? null,
        createdAt
      )
      .run();
    return { id: flagId, status: "received", createdAt };
  }

  async isActiveStaff(subject: string, normalizedEmail: string | null): Promise<boolean> {
    if (!normalizedEmail) return false;
    const normalized = normalizedEmail.toLowerCase();
    const row = await this.db
      .prepare(
        `SELECT id FROM staff_principals
         WHERE provider_subject = ? AND normalized_email = ? AND status = 'active' LIMIT 1`
      )
      .bind(subject, normalized)
      .first<Row>();
    if (row) return true;

    const invitation = await this.db
      .prepare(
        `SELECT id FROM staff_principals
         WHERE provider_subject IS NULL AND normalized_email = ? AND status = 'invited' LIMIT 1`
      )
      .bind(normalized)
      .first<Row>();
    if (!invitation) return false;
    const timestamp = now();
    try {
      const result = await this.db
        .prepare(
          `UPDATE staff_principals SET provider_subject = ?, status = 'active',
             activated_at = COALESCE(activated_at, ?), last_login_at = ?
           WHERE id = ? AND provider_subject IS NULL AND status = 'invited'`
        )
        .bind(subject, timestamp, timestamp, invitation.id)
        .run();
      if (!result.meta.changes) return false;
      await this.audit(subject, "staff.activated", "staff_principal", value(invitation.id), {});
      return true;
    } catch {
      return false;
    }
  }

  async getOpsDashboard(): Promise<Record<string, unknown>> {
    const [countsResult, flagsResult] = await Promise.all([
      this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM field_notes WHERE status = 'pending') AS pending_notes,
             (SELECT COUNT(*) FROM private_reports WHERE status = 'received') AS received_reports,
             (SELECT COUNT(*) FROM content_flags WHERE status = 'received') AS received_flags`
        )
        .first<Row>(),
      this.db.prepare("SELECT key, enabled FROM feature_flags").all<Row>()
    ]);
    let status: CaseStatus | null = null;
    try {
      status = await this.getStatus();
    } catch {
      // Staff must still be able to initialize an unseeded status record.
    }
    const killSwitches = featureSwitches(flagsResult.results);
    return {
      status,
      initializationRequired: status === null,
      counts: {
        pendingNotes: Number(countsResult?.pending_notes ?? 0),
        receivedReports: Number(countsResult?.received_reports ?? 0),
        receivedFlags: Number(countsResult?.received_flags ?? 0)
      },
      killSwitches
    };
  }

  async updateStatus(input: Record<string, unknown>, actorSubject: string): Promise<CaseStatus> {
    const current = await this.db.prepare("SELECT version FROM case_status WHERE id = 1").first<Row>();
    const expectedVersion = Number(input.version ?? 0);
    const timestamp = now();
    if (!current) {
      if (expectedVersion !== 0) throw new ConflictError();
      await this.db
        .prepare(
          `INSERT INTO case_status
           (id, state, hours_open, hours_close, timezone, next_clue_title, next_clue_at,
            version, updated_at, updated_by)
           VALUES (1, ?, ?, ?, 'America/Edmonton', ?, ?, 1, ?, ?)`
        )
        .bind(
          input.state,
          input.hoursOpen ?? "09:00",
          input.hoursClose ?? "20:00",
          input.nextClueTitle ?? null,
          input.nextClueAt ?? null,
          timestamp,
          actorSubject
        )
        .run();
    } else {
      if (Number(current.version) !== expectedVersion) throw new ConflictError();
      const result = await this.db
        .prepare(
          `UPDATE case_status SET
             state = ?, hours_open = ?, hours_close = ?, next_clue_title = ?, next_clue_at = ?,
             version = version + 1, updated_at = ?, updated_by = ?
           WHERE id = 1 AND version = ?`
        )
        .bind(
          input.state,
          input.hoursOpen ?? "09:00",
          input.hoursClose ?? "20:00",
          input.nextClueTitle ?? null,
          input.nextClueAt ?? null,
          timestamp,
          actorSubject,
          expectedVersion
        )
        .run();
      if (!result.meta.changes) throw new ConflictError();
    }
    await this.audit(actorSubject, "status.updated", "case_status", "1", {
      state: input.state,
      reportId: input.reportId ?? null,
      adjudicationReason: input.adjudicationReason ?? null
    });
    return this.getStatus();
  }

  async createUpdate(input: Record<string, unknown>, actorSubject: string): Promise<Record<string, unknown>> {
    const updateId = id();
    const timestamp = now();
    const scheduledFor = nullable(input.scheduledFor);
    const isScheduled = Boolean(scheduledFor && scheduledFor > timestamp);
    await this.db
      .prepare(
        `INSERT INTO official_updates
         (id, title, body, publisher_subject, publisher_name, published_at, scheduled_for, status)
         VALUES (?, ?, ?, ?, 'Campaign Ops', ?, ?, ?)`
      )
      .bind(
        updateId,
        input.title,
        input.body,
        actorSubject,
        isScheduled ? scheduledFor : timestamp,
        scheduledFor,
        isScheduled ? "scheduled" : "published"
      )
      .run();
    await this.audit(actorSubject, "update.created", "official_update", updateId, {
      scheduled: isScheduled
    });
    return {
      id: updateId,
      title: input.title,
      body: input.body,
      publisherName: "Campaign Ops",
      publishedAt: isScheduled ? scheduledFor : timestamp,
      status: isScheduled ? "scheduled" : "published"
    };
  }

  async listReports(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? now();
    const result = await this.db
      .prepare("SELECT * FROM private_reports WHERE created_at <= ? ORDER BY created_at DESC LIMIT ?")
      .bind(cursor, limit + 1)
      .all<Row>();
    const rows = result.results;
    return {
      items: rows.slice(0, limit).map((row) => this.privateReportFromRow(row)),
      nextCursor: rows.length > limit ? value(rows[limit - 1]?.created_at) : null
    };
  }

  async updateReport(
    reportId: string,
    input: Record<string, unknown>,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.reportById(reportId);
    if (!existing) return null;
    const timestamp = now();
    await this.db
      .prepare(
        `UPDATE private_reports SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?`
      )
      .bind(input.status, input.assignedTo ?? null, timestamp, reportId)
      .run();
    await this.db
      .prepare(
        `INSERT INTO report_events (id, report_id, event_type, actor_subject, note, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id(), reportId, `status.${input.status}`, actorSubject, input.note ?? null, timestamp)
      .run();
    await this.audit(actorSubject, "report.updated", "report", reportId, { status: input.status });
    return this.reportById(reportId);
  }

  async listPendingNotes(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? now();
    const result = await this.db
      .prepare(
        `SELECT n.id, n.waypoint_id, n.body, n.created_at, p.public_handle
         FROM field_notes n JOIN hunter_profiles p ON p.subject = n.author_subject
         WHERE n.status = 'pending' AND n.created_at <= ? ORDER BY n.created_at LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const rows = result.results;
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        waypointId: Number(row.waypoint_id),
        body: row.body,
        authorHandle: row.public_handle,
        createdAt: row.created_at
      })),
      nextCursor: rows.length > limit ? value(rows[limit - 1]?.created_at) : null
    };
  }

  async moderateNote(
    noteId: string,
    decision: string,
    reason: string | null,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const timestamp = now();
    const result = await this.db
      .prepare(
        `UPDATE field_notes SET status = ?, moderation_reason = ?, moderated_at = ?,
         moderated_by = ?, published_at = CASE WHEN ? = 'approved' THEN ? ELSE published_at END,
         updated_at = ? WHERE id = ? AND status = 'pending'`
      )
      .bind(decision, reason, timestamp, actorSubject, decision, timestamp, timestamp, noteId)
      .run();
    if (!result.meta.changes) return null;
    await this.audit(actorSubject, "note.moderated", "field_note", noteId, { decision, reason });
    const row = await this.db
      .prepare("SELECT id, waypoint_id, body, status, created_at, published_at FROM field_notes WHERE id = ?")
      .bind(noteId)
      .first<Row>();
    return row
      ? {
          id: row.id,
          waypointId: Number(row.waypoint_id),
          body: row.body,
          status: row.status,
          createdAt: row.created_at,
          publishedAt: row.published_at
        }
      : null;
  }

  async listStaff(): Promise<Record<string, unknown>[]> {
    const result = await this.db
      .prepare(
        `SELECT id, provider_subject, normalized_email, display_name, status,
                invited_at, activated_at, last_login_at
         FROM staff_principals ORDER BY normalized_email`
      )
      .all<Row>();
    return result.results.map((row) => ({
      id: row.id,
      subject: row.provider_subject,
      email: row.normalized_email,
      displayName: row.display_name,
      status: row.status,
      invitedAt: row.invited_at,
      activatedAt: row.activated_at,
      lastLoginAt: row.last_login_at
    }));
  }

  async listSubscribers(options: { limit?: number; cursor?: string | null } = {}) {
    const limit = pageLimit(options.limit);
    const cursor = parseSubscriberCursor(options.cursor);
    const rankedConsentCte = `
      WITH ranked_consents AS (
        SELECT hunter_subject, consent_type, granted,
               ROW_NUMBER() OVER (
                 PARTITION BY hunter_subject, consent_type
                 ORDER BY occurred_at DESC, id DESC
               ) AS consent_rank
        FROM consent_events
      ), current_consents AS (
        SELECT hunter_subject,
          MAX(CASE WHEN consent_type = 'hunt_email' AND consent_rank = 1 THEN granted ELSE 0 END) AS hunt_email_consent,
          MAX(CASE WHEN consent_type = 'marketing' AND consent_rank = 1 THEN granted ELSE 0 END) AS marketing_consent
        FROM ranked_consents WHERE consent_rank = 1 GROUP BY hunter_subject
      )`;
    const cursorWhere = cursor
      ? "WHERE p.updated_at < ? OR (p.updated_at = ? AND p.subject < ?)"
      : "";
    let itemStatement = this.db.prepare(
      `${rankedConsentCte}
       SELECT p.subject, p.verified_email, p.full_name, p.public_handle,
              p.town_area, p.created_at, p.updated_at,
              COALESCE(c.hunt_email_consent, 0) AS hunt_email_consent,
              COALESCE(c.marketing_consent, 0) AS marketing_consent
       FROM hunter_profiles p LEFT JOIN current_consents c ON c.hunter_subject = p.subject
       ${cursorWhere}
       ORDER BY p.updated_at DESC, p.subject DESC LIMIT ?`
    );
    itemStatement = cursor
      ? itemStatement.bind(cursor.updatedAt, cursor.updatedAt, cursor.subject, limit + 1)
      : itemStatement.bind(limit + 1);

    const [countRow, itemResult] = await Promise.all([
      this.db
        .prepare(
          `${rankedConsentCte}
           SELECT COUNT(*) AS total_profiles,
             COALESCE(SUM(CASE WHEN c.hunt_email_consent = 1 THEN 1 ELSE 0 END), 0) AS hunt_email_count,
             COALESCE(SUM(CASE WHEN c.marketing_consent = 1 THEN 1 ELSE 0 END), 0) AS marketing_count
           FROM hunter_profiles p LEFT JOIN current_consents c ON c.hunter_subject = p.subject`
        )
        .first<Row>(),
      itemStatement.all<Row>()
    ]);
    const rows = itemResult.results;
    const selected = rows.slice(0, limit);
    const items = selected.map((row) => ({
        id: row.subject,
        verifiedEmail: row.verified_email,
        fullName: row.full_name,
        publicHandle: row.public_handle,
        townArea: row.town_area,
        consents: consentProjection(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    return {
      counts: {
        totalProfiles: Number(countRow?.total_profiles ?? 0),
        huntEmail: Number(countRow?.hunt_email_count ?? 0),
        marketing: Number(countRow?.marketing_count ?? 0)
      },
      items,
      nextCursor: rows.length > limit && selected.length > 0 ? subscriberCursor(selected.at(-1)!) : null
    };
  }

  async listPlayers(options: { limit?: number; cursor?: string | null } = {}) {
    const limit = pageLimit(options.limit);
    const cursor = parseSubscriberCursor(options.cursor);
    const ledgerCte = `
      WITH ranked_consents AS (
        SELECT hunter_subject, consent_type, granted,
          ROW_NUMBER() OVER (PARTITION BY hunter_subject, consent_type ORDER BY occurred_at DESC, id DESC) AS rank
        FROM consent_events
      ), current_consents AS (
        SELECT hunter_subject,
          MAX(CASE WHEN consent_type = 'hunt_email' AND rank = 1 THEN granted ELSE 0 END) AS hunt_email_consent,
          MAX(CASE WHEN consent_type = 'marketing' AND rank = 1 THEN granted ELSE 0 END) AS marketing_consent
        FROM ranked_consents WHERE rank = 1 GROUP BY hunter_subject
      ), ranked_legal AS (
        SELECT hunter_subject, document_type, document_version, document_hash, action,
          ROW_NUMBER() OVER (PARTITION BY hunter_subject, document_type ORDER BY accepted_at DESC, id DESC) AS rank
        FROM legal_acceptance_events
      ), current_legal AS (
        SELECT hunter_subject,
          MAX(CASE WHEN document_type = 'privacy_media' AND rank = 1 THEN document_version END) AS privacy_version,
          MAX(CASE WHEN document_type = 'privacy_media' AND rank = 1 THEN document_hash END) AS privacy_hash,
          MAX(CASE WHEN document_type = 'privacy_media' AND rank = 1 THEN action END) AS privacy_action
        FROM ranked_legal WHERE rank = 1 GROUP BY hunter_subject
      ), ranked_current_waiver AS (
        SELECT l.hunter_subject, l.id AS waiver_id, l.document_version AS waiver_version,
               l.action, l.accepted_at,
               ROW_NUMBER() OVER (
                 PARTITION BY l.hunter_subject ORDER BY l.accepted_at DESC, l.id DESC
               ) AS rank
        FROM legal_acceptance_events l
        WHERE l.document_type = 'participation_waiver'
          AND l.document_version = ? AND l.document_hash = ?
      ), current_waiver AS (
        SELECT waiver.hunter_subject, waiver.waiver_id, waiver.waiver_version,
               waiver.accepted_at,
               (SELECT COUNT(*) FROM waiver_acceptance_participants wp
                WHERE wp.acceptance_event_id = waiver.waiver_id
                  AND wp.participant_role = 'minor') AS minor_count,
               CASE
                 WHEN job.status = 'failed'
                   AND job.last_error_code = 'provider_delivery_uncertain'
                 THEN 'uncertain'
                 ELSE job.status
               END AS receipt_status
        FROM ranked_current_waiver waiver
        JOIN notification_jobs job
          ON job.target_record_id = waiver.waiver_id AND job.kind = 'waiver_receipt'
        WHERE waiver.rank = 1 AND waiver.action = 'accepted'
      )`;
    const cursorWhere = cursor
      ? "AND (a.updated_at < ? OR (a.updated_at = ? AND a.subject < ?))"
      : "";
    let itemStatement = this.db.prepare(
      `${ledgerCte}
       SELECT a.subject, a.verified_email, a.account_state, a.created_at, a.updated_at,
              a.last_seen_at, a.profile_completed_at,
              p.full_name, p.public_handle, p.town_area,
              COALESCE(c.hunt_email_consent, 0) AS hunt_email_consent,
              COALESCE(c.marketing_consent, 0) AS marketing_consent,
              l.privacy_version, l.privacy_hash, l.privacy_action,
              w.waiver_id, w.waiver_version, w.accepted_at, w.minor_count, w.receipt_status
       FROM player_accounts a
       LEFT JOIN hunter_profiles p ON p.subject = a.subject
       LEFT JOIN current_consents c ON c.hunter_subject = a.subject
       LEFT JOIN current_legal l ON l.hunter_subject = a.subject
       LEFT JOIN current_waiver w ON w.hunter_subject = a.subject
       WHERE a.account_state = 'active' ${cursorWhere}
       ORDER BY a.updated_at DESC, a.subject DESC LIMIT ?`
    );
    itemStatement = cursor
      ? itemStatement.bind(
          participationWaiverDocument.version,
          participationWaiverDocument.hash,
          cursor.updatedAt,
          cursor.updatedAt,
          cursor.subject,
          limit + 1
        )
      : itemStatement.bind(
          participationWaiverDocument.version,
          participationWaiverDocument.hash,
          limit + 1
        );
    const [countRow, itemResult] = await Promise.all([
      this.db
        .prepare(
          `${ledgerCte}
           SELECT COUNT(*) AS verified_accounts,
             COALESCE(SUM(CASE WHEN p.subject IS NOT NULL THEN 1 ELSE 0 END), 0) AS completed_profiles,
             COALESCE(SUM(CASE WHEN c.hunt_email_consent = 1 THEN 1 ELSE 0 END), 0) AS hunt_email_count,
             COALESCE(SUM(CASE WHEN c.marketing_consent = 1 THEN 1 ELSE 0 END), 0) AS marketing_count
           FROM player_accounts a
           LEFT JOIN hunter_profiles p ON p.subject = a.subject
           LEFT JOIN current_consents c ON c.hunter_subject = a.subject
           WHERE a.account_state = 'active'`
        )
        .bind(participationWaiverDocument.version, participationWaiverDocument.hash)
        .first<Row>(),
      itemStatement.all<Row>()
    ]);
    const rows = itemResult.results;
    const selected = rows.slice(0, limit);
    return {
      counts: {
        verifiedAccounts: Number(countRow?.verified_accounts ?? 0),
        completedProfiles: Number(countRow?.completed_profiles ?? 0),
        huntEmail: Number(countRow?.hunt_email_count ?? 0),
        marketing: Number(countRow?.marketing_count ?? 0)
      },
      items: selected.map((row) => {
        const privacyAccepted =
          row.privacy_action === "accepted" &&
          row.privacy_version === privacyMediaDocument.version &&
          row.privacy_hash === privacyMediaDocument.hash;
        const waiverAccepted = Boolean(row.waiver_id);
        return {
          id: row.subject,
          verifiedEmail: row.verified_email,
          accountState: row.account_state,
          profileComplete: Boolean(row.profile_completed_at),
          fullName: row.full_name,
          publicHandle: row.public_handle,
          townArea: row.town_area,
          privacyMediaVersion: privacyAccepted ? row.privacy_version : null,
          waiverStatus: waiverAccepted ? "accepted" : "required",
          waiverVersion: waiverAccepted ? row.waiver_version : null,
          acceptedAt: waiverAccepted ? row.accepted_at : null,
          minorCount: waiverAccepted ? Number(row.minor_count) : 0,
          receiptStatus: waiverAccepted ? row.receipt_status : null,
          participationUnlocked: Boolean(row.profile_completed_at) && privacyAccepted && waiverAccepted,
          consents: consentProjection(row),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastSeenAt: row.last_seen_at
        };
      }),
      nextCursor: rows.length > limit && selected.length > 0 ? subscriberCursor(selected.at(-1)!) : null
    };
  }

  async getStaffPrincipal(staffId: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT id, provider_subject, normalized_email, display_name, status
         FROM staff_principals WHERE id = ? LIMIT 1`
      )
      .bind(staffId)
      .first<Row>();
    return row
      ? {
          id: row.id,
          subject: row.provider_subject,
          email: row.normalized_email,
          displayName: row.display_name,
          status: row.status
        }
      : null;
  }

  async listAudit(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? now();
    const result = await this.db
      .prepare(
        `SELECT id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at
         FROM audit_events WHERE occurred_at <= ?
         ORDER BY occurred_at DESC, id DESC LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const rows = result.results;
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        createdAt: row.occurred_at,
        actor: row.actor_subject,
        action: row.action,
        target: row.target_id ? `${row.target_kind}:${row.target_id}` : row.target_kind,
        result: row.metadata_json
      })),
      nextCursor: rows.length > limit ? value(rows[limit - 1]?.occurred_at) : null
    };
  }

  async recordStaffAction(
    action: string,
    target: string,
    actorSubject: string
  ): Promise<Record<string, unknown>> {
    const allowed = new Set(["recovery", "revoke-sessions", "suspend", "reactivate", "reset-mfa", "resend-invitation"]);
    if (!allowed.has(action)) throw new ConflictError("Unsupported staff action.");
    if (action === "suspend" || action === "reactivate") {
      await this.db
        .prepare("UPDATE staff_principals SET status = ? WHERE id = ?")
        .bind(action === "suspend" ? "suspended" : "active", target)
        .run();
    }
    await this.audit(actorSubject, `staff.${action}.requested`, "staff_principal", target, {});
    return { action, target, status: "queued" };
  }

  async recordPlayerAction(
    action: string,
    target: string,
    actorSubject: string
  ): Promise<Record<string, unknown>> {
    if (!new Set(["recovery", "revoke-sessions"]).has(action)) {
      throw new ConflictError("Unsupported player action.");
    }
    await this.audit(actorSubject, `player.${action}.requested`, "player_account", target, {});
    return { action, target, status: "queued" };
  }

  private async sponsorById(sponsorId: string): Promise<SponsorInquiryRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${sponsorColumns} FROM sponsor_inquiries WHERE id = ? LIMIT 1`)
      .bind(sponsorId)
      .first<Row>();
    return row ? sponsorFromRow(row) : null;
  }

  private async reportById(reportId: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare("SELECT * FROM private_reports WHERE id = ?")
      .bind(reportId)
      .first<Row>();
    if (!row) return null;
    const media = await this.db
      .prepare(
        `SELECT id, private_object_key, content_type, byte_size, status
         FROM media_uploads WHERE owner_kind = 'report' AND owner_id = ? ORDER BY created_at`
      )
      .bind(reportId)
      .all<Row>();
    return {
      ...this.privateReportFromRow(row),
      media: media.results.map((item) => ({
        id: item.id,
        key: item.private_object_key,
        contentType: item.content_type,
        size: Number(item.byte_size),
        status: item.status
      }))
    };
  }

  private privateReportFromRow(row: Row): Record<string, unknown> {
    return {
      id: row.id,
      type: row.report_type,
      hunterSubject: row.hunter_subject,
      name: row.reporter_name,
      email: row.reporter_email,
      phone: row.reporter_phone,
      waypointId: row.waypoint_id === null ? null : Number(row.waypoint_id),
      locationDescription: row.location_description,
      latitude: numberOrNull(row.latitude),
      longitude: numberOrNull(row.longitude),
      details: row.details,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assignedTo: row.assigned_to
    };
  }

  private profileFromRow(row: Row): Record<string, unknown> {
    return {
      subject: row.subject,
      email: row.verified_email,
      fullName: row.full_name,
      publicHandle: row.public_handle,
      townArea: row.town_area,
      interests: parseJson(row.interests_json, []),
      discoverySource: row.discovery_source,
      consents: consentProjection(row),
      adultAttestedAt: row.adult_attested_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mediaStatement(
    media: StoredMedia,
    ownerKind: "field_note" | "report",
    ownerId: string,
    subject: string | null
  ) {
    return this.db
      .prepare(
        `INSERT INTO media_uploads
         (id, owner_kind, owner_id, uploader_subject, private_object_key, content_type,
          byte_size, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        media.id,
        ownerKind,
        ownerId,
        subject,
        media.key,
        media.contentType ?? "application/octet-stream",
        media.size ?? 0,
        media.status,
        now()
      );
  }

  private async audit(
    actorSubject: string,
    action: string,
    targetKind: string,
    targetId: string | null,
    metadata: Record<string, unknown>
  ) {
    await this.db
      .prepare(
        `INSERT INTO audit_events
         (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id(), actorSubject, action, targetKind, targetId, json(metadata), now())
      .run();
  }
}
