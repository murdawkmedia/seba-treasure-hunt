import { ApiError, ConflictError, StatusUnavailableError } from "./errors";
import { participationWaiverDocument, privacyMediaDocument } from "./legal-documents";
import { isAllowedStaffEmail, staffDisplayName } from "./staff-domains";
import { isReportReviewState, nextReportStates } from "../shared/publication";
import { publicHunterIdentity } from "../shared/public-identity";
import type {
  CaseStatus,
  DataStore,
  IdentityLifecycleEvent,
  OperatorAlertErrorCode,
  OperatorAlertKind,
  OperatorAlertRecipientClaim,
  OperatorAlertRecipientCompletion,
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
const publicImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const canonicalJson = (input: unknown): string => {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(",")}]`;
  const record = input as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const sha256Hex = async (input: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const parseJson = <T>(input: unknown, fallback: T): T => {
  if (typeof input !== "string") return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
};

const pageLimit = (limit: number | undefined) => Math.min(Math.max(limit ?? 25, 1), 50);

type ModerationCursor = { createdAt: string; id: string };

const isModerationTimestamp = (input: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input) &&
  !Number.isNaN(Date.parse(input)) && new Date(input).toISOString() === input;

const invalidModerationCursor = () =>
  new ApiError(400, "invalid_cursor", "The moderation cursor is invalid.");

const moderationCursor = (createdAt: unknown, id: unknown) => {
  const encoded = btoa(JSON.stringify([value(createdAt), value(id)]))
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
const operatorAlertErrorCodes = new Set<OperatorAlertErrorCode>([
  "provider_unavailable",
  "provider_rejected",
  "provider_response_invalid",
  "provider_delivery_uncertain",
  "recipient_invalid",
  "configuration_error"
]);
const operatorAlertKinds = new Set<OperatorAlertKind>([
  "operator_private_report",
  "operator_field_note_moderation"
]);

const safeProviderReference = /^[\x20-\x7e]{1,128}$/;
const isCanonicalTimestamp = (input: string) => {
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === input;
};

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
  const acceptedAtIsCanonical =
    typeof result.acceptedAt === "string" && isCanonicalTimestamp(result.acceptedAt);
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
        `SELECT u.id, u.title, u.body, u.publisher_name,
                CASE WHEN u.status = 'scheduled' THEN u.scheduled_for ELSE u.published_at END AS published_at,
                u.source_report_id,
                u.public_attribution, u.waypoint_id, u.latitude, u.longitude,
                w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM official_updates u
         LEFT JOIN waypoints w ON w.id = u.waypoint_id AND w.is_published = 1
         WHERE (u.status = 'published' AND u.published_at <= ?)
            OR (u.status = 'scheduled' AND u.scheduled_for <= ?)
         ORDER BY published_at DESC, u.id DESC LIMIT ?`
      )
      .bind(cursor, cursor, limit + 1)
      .all<Row>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const reportUpdateIds = selected
      .filter((row) => nullable(row.source_report_id) !== null)
      .map((row) => value(row.id));
    const mediaByUpdate = new Map<string, Record<string, unknown>[]>();
    if (reportUpdateIds.length > 0) {
      const placeholders = reportUpdateIds.map(() => "?").join(",");
      const media = await this.db
        .prepare(
          `SELECT selected.update_id, media.id, media.content_type,
                  selected.alt_text, selected.caption, selected.position
           FROM official_update_media AS selected
           JOIN media_uploads AS media ON media.id = selected.media_id
           WHERE selected.update_id IN (${placeholders})
             AND media.status = 'ready'
             AND media.derivative_object_key IS NOT NULL
           UNION ALL
           SELECT selected.update_id, upload.id, upload.content_type,
                  selected.alt_text, selected.caption, selected.position
           FROM official_update_uploaded_media AS selected
           JOIN official_update_uploads AS upload ON upload.id = selected.upload_id
           WHERE selected.update_id IN (${placeholders})
             AND upload.status = 'ready'
             AND upload.derivative_object_key IS NOT NULL
           ORDER BY position, id`
        )
        .bind(...reportUpdateIds, ...reportUpdateIds)
        .all<Row>();
      for (const row of media.results) {
        const updateId = value(row.update_id);
        const entries = mediaByUpdate.get(updateId) ?? [];
        entries.push({
          id: row.id,
          url: `/api/v1/media/${value(row.id)}`,
          contentType: row.content_type,
          ...(nullable(row.alt_text) ? { alt: row.alt_text } : {}),
          ...(nullable(row.caption) ? { caption: row.caption } : {})
        });
        mediaByUpdate.set(updateId, entries);
      }
    }
    const items = selected.map((row) => {
      const sourceReportId = nullable(row.source_report_id);
      if (!sourceReportId) {
        return {
          id: row.id,
          title: row.title,
          body: row.body,
          publishedAt: row.published_at,
          publisherName: row.publisher_name
        };
      }
      return {
        id: row.id,
        kind: "approved_report",
        title: row.title,
        body: row.body,
        publishedAt: row.published_at,
        publisherName: row.public_attribution,
        waypointId: numberOrNull(row.waypoint_id),
        waypointRouteOrder: numberOrNull(row.waypoint_route_order),
        waypointName: nullable(row.waypoint_name),
        latitude: numberOrNull(row.latitude),
        longitude: numberOrNull(row.longitude),
        media: mediaByUpdate.get(value(row.id)) ?? []
      };
    });
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
        `SELECT w.id, w.route_order, w.name, w.description,
                COALESCE(z.state, 'temporarily_closed') AS zone_state
         FROM waypoints w LEFT JOIN zones z ON z.id = w.zone_id
         WHERE w.is_published = 1 ORDER BY w.route_order`
      )
      .all<Row>();
    return result.results.map((row) => ({
      id: Number(row.id),
      routeOrder: Number(row.route_order),
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
    const condition = waypointId ? "AND notes.waypoint_id = ?" : "";
    let notesStatement = this.db.prepare(
        `SELECT notes.id, notes.waypoint_id, notes.body, notes.created_at, notes.published_at,
                notes.author_handle, notes.author_participation_basis, notes.author_public_display_name,
                notes.author_public_handle, notes.note_kind, notes.latitude, notes.longitude,
                w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM (
           SELECT n.id, n.waypoint_id, n.body, n.created_at, n.published_at,
                  p.public_handle AS author_handle, p.participation_basis AS author_participation_basis,
                  p.public_display_name AS author_public_display_name, p.public_handle AS author_public_handle,
                  'community' AS note_kind,
                  NULL AS latitude, NULL AS longitude
           FROM field_notes n
           JOIN hunter_profiles p ON p.subject = n.author_subject
           WHERE n.status = 'approved'
           UNION ALL
           SELECT reviewed.id, reviewed.waypoint_id, reviewed.body, reviewed.created_at,
                  reviewed.published_at, reviewed.public_attribution AS author_handle,
                  NULL AS author_participation_basis, NULL AS author_public_display_name,
                  NULL AS author_public_handle, 'operator_reviewed' AS note_kind,
                  reviewed.latitude, reviewed.longitude
           FROM operator_reviewed_case_notes reviewed
           WHERE reviewed.status = 'published'
         ) notes
         LEFT JOIN waypoints w ON w.id = notes.waypoint_id AND w.is_published = 1
         WHERE notes.published_at <= ? ${condition}
         ORDER BY notes.published_at DESC, notes.id DESC LIMIT ?`
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
            `SELECT r.id, r.field_note_id, r.body, r.created_at, p.participation_basis,
                    p.public_display_name, p.public_handle
             FROM field_note_replies r JOIN hunter_profiles p ON p.subject = r.author_subject
             WHERE r.status = 'published' AND r.field_note_id IN (${placeholders})
             ORDER BY r.created_at`
          )
          .bind(...noteIds)
          .all<Row>(),
        this.db
          .prepare(
            `SELECT m.id, m.owner_id AS note_id, NULL AS alt_text, 0 AS position
             FROM media_uploads m
             WHERE m.owner_kind = 'field_note' AND m.status = 'ready'
               AND m.owner_id IN (${placeholders})
             UNION ALL
             SELECT m.id, selected.note_id, selected.alt_text, selected.position
             FROM operator_reviewed_case_note_media selected
             JOIN media_uploads m ON m.id = selected.media_id
             JOIN operator_reviewed_case_notes note ON note.id = selected.note_id
             WHERE note.status = 'published' AND m.owner_kind = 'report' AND m.status = 'ready'
               AND selected.note_id IN (${placeholders})
             ORDER BY position, id`
          )
          .bind(...noteIds, ...noteIds)
          .all<Row>()
      ]);
      for (const row of repliesResult.results) {
        const owner = value(row.field_note_id);
        const replies = repliesByNote.get(owner) ?? [];
        replies.push({
          id: row.id,
          body: row.body,
          authorHandle: publicHunterIdentity({
            participationBasis: nullable(row.participation_basis),
            publicDisplayName: nullable(row.public_display_name),
            publicHandle: nullable(row.public_handle)
          }),
          createdAt: row.created_at
        });
        repliesByNote.set(owner, replies);
      }
      for (const row of mediaResult.results) {
        const owner = value(row.note_id);
        const media = mediaByNote.get(owner) ?? [];
        const alt = nullable(row.alt_text);
        media.push({ id: row.id, url: `/api/v1/media/${row.id}`, ...(alt ? { alt } : {}) });
        mediaByNote.set(owner, media);
      }
    }

    const items = selected.map((row) => ({
      id: row.id,
      waypointId: Number(row.waypoint_id),
      waypointRouteOrder: numberOrNull(row.waypoint_route_order),
      waypointName: nullable(row.waypoint_name),
      body: row.body,
      authorHandle: row.note_kind === "community"
        ? publicHunterIdentity({
            participationBasis: nullable(row.author_participation_basis),
            publicDisplayName: nullable(row.author_public_display_name),
            publicHandle: nullable(row.author_public_handle)
          })
        : value(row.author_handle),
      noteKind: row.note_kind,
      latitude: numberOrNull(row.latitude),
      longitude: numberOrNull(row.longitude),
      createdAt: row.created_at,
      publishedAt: row.published_at,
      media: mediaByNote.get(value(row.id)) ?? [],
      replies: repliesByNote.get(value(row.id)) ?? []
    }));
    return {
      items,
      nextCursor: hasMore ? value(selected.at(-1)?.published_at) : null
    };
  }

  async getPublicMedia(mediaId: string): Promise<{
    key: string;
    contentType: string;
    cacheControl: "immutable" | "no-store";
  } | null> {
    let row = await this.db
      .prepare(
        `SELECT m.derivative_object_key, m.content_type, m.owner_kind
         FROM media_uploads m
         WHERE m.id = ? AND m.status = 'ready' AND m.derivative_object_key IS NOT NULL
           AND (
             EXISTS (
               SELECT 1 FROM field_notes n
               WHERE n.id = m.owner_id AND m.owner_kind = 'field_note'
                 AND n.status = 'approved'
             )
             OR EXISTS (
               SELECT 1
               FROM official_update_media selected
               JOIN official_updates published_update ON published_update.id = selected.update_id
               WHERE selected.media_id = m.id
                 AND published_update.source_report_id = m.owner_id
                 AND m.owner_kind = 'report'
                 AND (
                   (published_update.status = 'published' AND published_update.published_at <= ?)
                   OR (published_update.status = 'scheduled' AND published_update.scheduled_for <= ?)
                 )
             )
             OR EXISTS (
               SELECT 1
               FROM operator_reviewed_case_note_media selected
               JOIN operator_reviewed_case_notes reviewed ON reviewed.id = selected.note_id
               WHERE selected.media_id = m.id
                 AND reviewed.source_report_id = m.owner_id
                 AND m.owner_kind = 'report'
                 AND reviewed.status = 'published'
                 AND reviewed.published_at <= ?
             )
           )
         LIMIT 1`
      )
      .bind(mediaId, now(), now(), now())
      .first<Row>();
    if (!row) {
      row = await this.db
        .prepare(
          `SELECT upload.derivative_object_key, upload.content_type,
                  'official_update' AS owner_kind
           FROM official_update_uploads upload
           JOIN official_update_uploaded_media selected ON selected.upload_id = upload.id
           JOIN official_updates published_update ON published_update.id = selected.update_id
           WHERE upload.id = ? AND upload.status = 'ready'
             AND upload.derivative_object_key IS NOT NULL
             AND (
               (published_update.status = 'published' AND published_update.published_at <= ?)
               OR (published_update.status = 'scheduled' AND published_update.scheduled_for <= ?)
             )
           LIMIT 1`
        )
        .bind(mediaId, now(), now())
        .first<Row>();
    }
    if (!row || !value(row.derivative_object_key).startsWith("derivatives/")) return null;
    return {
      key: value(row.derivative_object_key),
      contentType: value(row.content_type),
      cacheControl: row.owner_kind === "field_note" ? "immutable" : "no-store"
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
  ): Promise<{
    value: Record<string, unknown>;
    replayed: boolean;
    operatorAlertJobId: string | null;
  }> {
    const replay = await this.db
      .prepare("SELECT record_id FROM idempotency_keys WHERE scope = 'report' AND idempotency_key = ?")
      .bind(idempotencyKey)
      .first<Row>();
    if (replay) {
      const existing = await this.reportById(value(replay.record_id));
      if (existing) return { value: existing, replayed: true, operatorAlertJobId: null };
    }

    const reportId = id();
    const operatorAlertJobId = id();
    const createdAt = now();
    const media = mediaFromInput(input.media);
    const statements = [
      this.db
        .prepare(
          `INSERT INTO private_reports
           (id, report_type, hunter_subject, reporter_name, reporter_email, reporter_phone,
            waypoint_id, location_description, latitude, longitude, details, public_attribution,
            attribution_kind, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`
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
          input.publicAttribution ?? null,
          input.attributionKind ?? null,
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
           VALUES (?, 'operator_private_report', ?, 'pending', 0, ?, ?)`
        )
        .bind(operatorAlertJobId, reportId, createdAt, createdAt),
      this.operatorAlertRecipientSnapshotStatement(operatorAlertJobId, createdAt)
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
        if (existing) return { value: existing, replayed: true, operatorAlertJobId: null };
      }
      throw error;
    }
    const created = await this.reportById(reportId);
    return { value: created!, replayed: false, operatorAlertJobId };
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
             AND (l.action <> 'accepted' OR EXISTS (
               SELECT 1 FROM waiver_account_participants account_participant
               WHERE account_participant.acceptance_event_id = l.id
                 AND account_participant.participation_basis = p.participation_basis
                 AND account_participant.full_name = p.full_name
                 AND account_participant.guardian_permission_attested =
                   CASE p.participation_basis WHEN 'minor_guardian_permission' THEN 1 ELSE 0 END
             ))
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
        `SELECT participant_role, participation_basis, full_name, birth_year,
                guardian_attested, sort_order, participant_id
         FROM (
           SELECT CASE account.participation_basis
                    WHEN 'adult' THEN 'adult' ELSE 'minor' END AS participant_role,
                  account.participation_basis, account.full_name, NULL AS birth_year,
                  account.guardian_permission_attested AS guardian_attested,
                  0 AS sort_order, account.acceptance_event_id AS participant_id
           FROM waiver_account_participants account
           WHERE account.acceptance_event_id = ?
           UNION ALL
           SELECT participant.participant_role, NULL AS participation_basis,
                  participant.full_name, participant.birth_year,
                  participant.guardian_attested, 1 AS sort_order, participant.id AS participant_id
           FROM waiver_acceptance_participants participant
           WHERE participant.acceptance_event_id = ?
         )
         ORDER BY sort_order,
           CASE participant_role WHEN 'adult' THEN 0 ELSE 1 END,
           participant_id`
      )
      .bind(acceptanceId, acceptanceId)
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
        participationBasis: participant.participation_basis === "adult" ||
          participant.participation_basis === "minor_guardian_permission"
            ? participant.participation_basis
            : undefined,
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
    const accountParticipant = await this.db
      .prepare(
        `SELECT full_name, participation_basis, guardian_permission_attested_at
         FROM hunter_profiles WHERE subject = ? LIMIT 1`
      )
      .bind(subject)
      .first<Row>();
    const accountBasis = accountParticipant?.participation_basis;
    const accountName = nullable(accountParticipant?.full_name);
    const guardianPermissionAttested = Boolean(accountParticipant?.guardian_permission_attested_at);
    if (
      !accountName ||
      (accountBasis !== "adult" && accountBasis !== "minor_guardian_permission") ||
      (accountBasis === "adult" && guardianPermissionAttested) ||
      (accountBasis === "minor_guardian_permission" && !guardianPermissionAttested) ||
      (accountBasis === "minor_guardian_permission" && input.minors.length > 0) ||
      (input.minors.length > 0 && !input.guardianAttested)
    ) {
      throw new ApiError(
        422,
        "waiver_participants_invalid",
        "The account participation basis or guardian attestations are incomplete."
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
          `INSERT INTO waiver_account_participants
           (acceptance_event_id, participation_basis, full_name,
            guardian_permission_attested, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          acceptanceId,
          accountBasis,
          accountName,
          accountBasis === "minor_guardian_permission" ? 1 : 0,
          timestamp
        ),
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
      if (!isWaiverIdempotencyConflict(error)) {
        if (error instanceof Error && /waiver account participant must match an accepted waiver profile/i.test(error.message)) {
          throw new ConflictError("The accepted participation waiver could not be recorded for this active profile.");
        }
        throw error;
      }
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
        `SELECT acceptance.id, acceptance.action
         FROM legal_acceptance_events acceptance
         LEFT JOIN hunter_profiles profile ON profile.subject = acceptance.hunter_subject
         WHERE acceptance.hunter_subject = ?
           AND acceptance.document_type = 'participation_waiver'
           AND acceptance.document_version = ? AND acceptance.document_hash = ?
           AND (acceptance.action <> 'accepted' OR EXISTS (
             SELECT 1 FROM waiver_account_participants account_participant
             WHERE account_participant.acceptance_event_id = acceptance.id
               AND account_participant.participation_basis = profile.participation_basis
               AND account_participant.full_name = profile.full_name
               AND account_participant.guardian_permission_attested =
                 CASE profile.participation_basis WHEN 'minor_guardian_permission' THEN 1 ELSE 0 END
           ))
         ORDER BY acceptance.accepted_at DESC, acceptance.id DESC LIMIT 1`
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
    if (input.participationBasis !== "adult" && input.participationBasis !== "minor_guardian_permission") {
      throw new ApiError(
        422,
        "participation_basis_required",
        "Choose whether you are 18 or older or participating with guardian permission."
      );
    }
    await this.upsertPlayerAccount(subject, value(input.verifiedEmail));
    const existing = await this.db
      .prepare("SELECT public_handle, created_at FROM hunter_profiles WHERE subject = ?")
      .bind(subject)
      .first<Row>();
    const timestamp = now();
    const publicHandle = existing?.public_handle ?? `Hunter ${id().slice(0, 4).toUpperCase()}`;
    const participationBasis = input.participationBasis;
    const guardianPermissionAttestedAt = participationBasis === "minor_guardian_permission" &&
      input.guardianPermissionAttested === true
      ? timestamp
      : null;
    const statements = [
      this.db.prepare(
        `INSERT INTO hunter_profiles
         (subject, verified_email, full_name, public_handle, public_display_name, phone, town_area, age_band,
          interests_json, discovery_source, adult_attested_at, participation_basis,
          guardian_permission_attested_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject) DO UPDATE SET
           verified_email = excluded.verified_email, full_name = excluded.full_name,
           public_display_name = excluded.public_display_name,
           phone = excluded.phone, town_area = excluded.town_area, age_band = excluded.age_band,
           interests_json = excluded.interests_json, discovery_source = excluded.discovery_source,
           adult_attested_at = excluded.adult_attested_at,
           participation_basis = excluded.participation_basis,
           guardian_permission_attested_at = excluded.guardian_permission_attested_at,
           updated_at = excluded.updated_at`
      )
      .bind(
        subject,
        input.verifiedEmail,
        input.fullName,
        publicHandle,
        input.publicDisplayName ?? null,
        null,
        input.townArea ?? null,
        null,
        json(input.interests ?? []),
        input.discoverySource ?? null,
        timestamp,
        participationBasis,
        guardianPermissionAttestedAt,
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
        `SELECT w.id, w.route_order, w.name, w.description, w.member_exact_url, w.member_content,
                COALESCE(z.state, 'temporarily_closed') AS zone_state
         FROM waypoints w LEFT JOIN zones z ON z.id = w.zone_id
         WHERE w.id = ? AND w.is_published = 1 LIMIT 1`
      )
      .bind(waypointId)
      .first<Row>();
    return row
      ? {
          id: Number(row.id),
          routeOrder: Number(row.route_order),
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
          `SELECT w.id, w.route_order, w.name, w.description, w.member_exact_url, w.member_content,
                  COALESCE(z.state, 'temporarily_closed') AS zone_state
           FROM waypoints w LEFT JOIN zones z ON z.id = w.zone_id
           WHERE w.is_published = 1 ORDER BY w.route_order`
        )
        .all<Row>(),
      this.db
        .prepare(
          `SELECT progress.waypoint_id, progress.state, progress.updated_at,
                  w.route_order AS waypoint_route_order, w.name AS waypoint_name
           FROM waypoint_progress progress
           LEFT JOIN waypoints w
             ON w.id = progress.waypoint_id AND w.is_published = 1
           WHERE progress.hunter_subject = ?`
        )
        .bind(subject)
        .all<Row>(),
      this.db
        .prepare("SELECT id, report_type, status, created_at FROM private_reports WHERE hunter_subject = ? ORDER BY created_at DESC")
        .bind(subject)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT n.id, n.waypoint_id, n.body, n.status, n.created_at,
                  w.route_order AS waypoint_route_order, w.name AS waypoint_name
           FROM field_notes n
           LEFT JOIN waypoints w ON w.id = n.waypoint_id AND w.is_published = 1
           WHERE n.author_subject = ? ORDER BY n.created_at DESC`
        )
        .bind(subject)
        .all<Row>()
    ]);
    const waypoints = waypointResult.results.map((row) => {
      const safe = access.participationUnlocked && status.state === "open" && row.zone_state === "open";
      return {
        id: Number(row.id),
        routeOrder: Number(row.route_order),
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
        waypointRouteOrder: numberOrNull(row.waypoint_route_order),
        waypointName: nullable(row.waypoint_name),
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
        waypointRouteOrder: numberOrNull(row.waypoint_route_order),
        waypointName: nullable(row.waypoint_name),
        body: row.body,
        status: row.status,
        createdAt: row.created_at
      }))
    };
  }

  async getFieldNoteByIdempotencyKey(
    subject: string,
    idempotencyKey: string
  ): Promise<Record<string, unknown> | null> {
    const scope = `field_note:${subject}`;
    const replay = await this.db
      .prepare(
        `SELECT record_id FROM idempotency_keys
         WHERE scope = ? AND idempotency_key = ? AND expires_at > ? LIMIT 1`
      )
      .bind(scope, idempotencyKey, now())
      .first<Row>();
    if (!replay) return null;
    const row = await this.db
      .prepare(
        `SELECT id, waypoint_id, body, status, created_at
         FROM field_notes WHERE id = ? AND author_subject = ? LIMIT 1`
      )
      .bind(replay.record_id, subject)
      .first<Row>();
    if (!row) return null;
    const media = await this.db
      .prepare(
        `SELECT id, content_type, byte_size, status
         FROM media_uploads WHERE owner_kind = 'field_note' AND owner_id = ? ORDER BY created_at`
      )
      .bind(row.id)
      .all<Row>();
    return {
      id: row.id,
      waypointId: Number(row.waypoint_id),
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
      media: media.results.map((item) => ({
        id: item.id,
        contentType: item.content_type,
        size: Number(item.byte_size),
        status: item.status
      }))
    };
  }

  async createFieldNote(
    input: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<{
    value: Record<string, unknown>;
    operatorAlertJobId: string | null;
    replayed: boolean;
  }> {
    const subject = value(input.authorSubject);
    const replay = await this.getFieldNoteByIdempotencyKey(subject, idempotencyKey);
    if (replay) return { value: replay, operatorAlertJobId: null, replayed: true };
    const noteId = id();
    const operatorAlertJobId = id();
    const createdAt = now();
    const media = mediaFromInput(input.media);
    const statements = [
      this.db
        .prepare(
          `INSERT INTO idempotency_keys (scope, idempotency_key, record_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+24 hours'))`
        )
        .bind(`field_note:${subject}`, idempotencyKey, noteId, createdAt, createdAt),
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
        .bind(id(), noteId, input.body, createdAt, input.authorSubject),
      this.db
        .prepare(
          `INSERT INTO notification_jobs
           (id, kind, target_record_id, status, attempts, created_at, updated_at)
           VALUES (?, 'operator_field_note_moderation', ?, 'pending', 0, ?, ?)`
        )
        .bind(operatorAlertJobId, noteId, createdAt, createdAt),
      this.operatorAlertRecipientSnapshotStatement(operatorAlertJobId, createdAt)
    ];
    for (const item of media) {
      statements.push(this.mediaStatement(item, "field_note", noteId, value(input.authorSubject)));
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      const winner = await this.getFieldNoteByIdempotencyKey(subject, idempotencyKey);
      if (winner) return { value: winner, operatorAlertJobId: null, replayed: true };
      throw error;
    }
    return {
      operatorAlertJobId,
      replayed: false,
      value: {
        id: noteId,
        waypointId: input.waypointId,
        body: input.body,
        status: "pending",
        media,
        createdAt
      }
    };
  }

  async claimOperatorAlertRecipients(
    jobId: string
  ): Promise<OperatorAlertRecipientClaim[]> {
    const timestamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE operator_alert_recipients
           SET status = 'uncertain', lease_token = NULL, lease_expires_at = NULL,
               last_error_code = 'provider_delivery_uncertain', updated_at = ?
           WHERE notification_job_id = ? AND status = 'processing'
             AND lease_expires_at <= ?`
        )
        .bind(timestamp, jobId, timestamp),
      this.db
        .prepare(
          `UPDATE operator_alert_recipients
           SET status = 'cancelled', next_attempt_at = NULL, lease_token = NULL,
               lease_expires_at = NULL, last_error_code = 'recipient_ineligible',
               updated_at = ?
           WHERE notification_job_id = ? AND status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM staff_principals staff
               WHERE staff.id = operator_alert_recipients.staff_principal_id
                 AND staff.status = 'active'
                 AND staff.provider_subject IS NOT NULL
                 AND staff.activated_at IS NOT NULL
                 AND staff.normalized_email = operator_alert_recipients.recipient_email
             )`
        )
        .bind(timestamp, jobId)
    ]);

    const candidates = await this.db
      .prepare(
        `SELECT recipient.id, recipient.recipient_email, recipient.attempts,
                job.kind, job.target_record_id
         FROM operator_alert_recipients recipient
         JOIN notification_jobs job ON job.id = recipient.notification_job_id
         JOIN staff_principals staff ON staff.id = recipient.staff_principal_id
         WHERE recipient.notification_job_id = ?
           AND job.status = 'pending'
           AND job.kind IN ('operator_private_report', 'operator_field_note_moderation')
           AND recipient.status = 'pending'
           AND (recipient.next_attempt_at IS NULL OR recipient.next_attempt_at <= ?)
           AND staff.status = 'active'
           AND staff.provider_subject IS NOT NULL
           AND staff.activated_at IS NOT NULL
           AND staff.normalized_email = recipient.recipient_email
         ORDER BY recipient.created_at, recipient.id
         LIMIT 1`
      )
      .bind(jobId, timestamp)
      .all<Row>();
    if (candidates.results.length === 0) return [];

    const claims = candidates.results.map((row) => ({
      id: value(row.id),
      jobId,
      kind: row.kind as OperatorAlertKind,
      targetRecordId: value(row.target_record_id),
      email: value(row.recipient_email),
      attempts: Number(row.attempts) + 1,
      leaseToken: id(),
      correlationId: `opalert_${id().replaceAll("-", "")}`
    }));
    const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const results = await this.db.batch(
      claims.map((claim, index) =>
        this.db
          .prepare(
            `UPDATE operator_alert_recipients
             SET status = 'processing', attempts = ?, next_attempt_at = NULL,
                 lease_token = ?, lease_expires_at = ?, correlation_id = ?,
                 last_error_code = NULL, updated_at = ?
             WHERE id = ? AND notification_job_id = ? AND status = 'pending'
               AND attempts = ?
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
               AND EXISTS (
                 SELECT 1 FROM staff_principals staff
                 WHERE staff.id = operator_alert_recipients.staff_principal_id
                   AND staff.status = 'active'
                   AND staff.provider_subject IS NOT NULL
                   AND staff.activated_at IS NOT NULL
                   AND staff.normalized_email = operator_alert_recipients.recipient_email
               )`
          )
          .bind(
            claim.attempts,
            claim.leaseToken,
            leaseExpiresAt,
            claim.correlationId,
            timestamp,
            claim.id,
            jobId,
            Number(candidates.results[index]?.attempts),
            timestamp
          )
      )
    );
    return claims.filter((_claim, index) => Number(results[index]?.meta?.changes ?? 0) === 1);
  }

  async completeOperatorAlertRecipient(
    claim: OperatorAlertRecipientClaim,
    result: OperatorAlertRecipientCompletion
  ): Promise<void> {
    if (!operatorAlertKinds.has(claim.kind)) {
      throw new ApiError(422, "operator_alert_kind_invalid", "The alert kind is invalid.");
    }
    if (result.status === "sent") {
      if (!validProviderAcceptance(result)) {
        throw new ApiError(
          422,
          "operator_alert_acceptance_invalid",
          "The alert provider acceptance is invalid."
        );
      }
    } else {
      if (!operatorAlertErrorCodes.has(result.errorCode)) {
        throw new ApiError(
          422,
          "operator_alert_error_invalid",
          "The alert error code is invalid."
        );
      }
      if (result.status === "retry" && !isCanonicalTimestamp(result.nextAttemptAt)) {
        throw new ApiError(
          422,
          "operator_alert_retry_invalid",
          "The alert retry time is invalid."
        );
      }
    }

    const timestamp = now();
    const statement = result.status === "sent"
      ? this.db
          .prepare(
            `UPDATE operator_alert_recipients
             SET status = 'sent', next_attempt_at = NULL, lease_token = NULL,
                 lease_expires_at = NULL, provider = ?, provider_reference = ?,
                 provider_reference_kind = ?, accepted_at = ?, sent_at = ?,
                 last_error_code = NULL, updated_at = ?
             WHERE id = ? AND notification_job_id = ? AND status = 'processing'
               AND attempts = ? AND lease_token = ? AND correlation_id = ?`
          )
          .bind(
            result.provider,
            result.providerReference,
            result.providerReferenceKind,
            result.acceptedAt,
            result.acceptedAt,
            timestamp,
            claim.id,
            claim.jobId,
            claim.attempts,
            claim.leaseToken,
            claim.correlationId
          )
      : this.db
          .prepare(
            `UPDATE operator_alert_recipients
             SET status = ?, next_attempt_at = ?, lease_token = NULL,
                 lease_expires_at = NULL, last_error_code = ?, updated_at = ?
             WHERE id = ? AND notification_job_id = ? AND status = 'processing'
               AND attempts = ? AND lease_token = ? AND correlation_id = ?`
          )
          .bind(
            result.status === "retry" ? "pending" : result.status,
            result.status === "retry" ? result.nextAttemptAt : null,
            result.errorCode,
            timestamp,
            claim.id,
            claim.jobId,
            claim.attempts,
            claim.leaseToken,
            claim.correlationId
          );
    const completion = await statement.run();
    if (Number(completion.meta?.changes ?? 0) !== 1) {
      throw new ApiError(
        409,
        "operator_alert_lease_lost",
        "The operator alert delivery lease is no longer current."
      );
    }
  }

  async reconcileOperatorAlertJob(jobId: string): Promise<void> {
    const timestamp = now();
    await this.db
      .prepare(
        `UPDATE notification_jobs
         SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM operator_alert_recipients recipient
                 WHERE recipient.notification_job_id = notification_jobs.id
                   AND recipient.status IN ('pending', 'processing')
               ) THEN 'pending'
               WHEN EXISTS (
                 SELECT 1 FROM operator_alert_recipients recipient
                 WHERE recipient.notification_job_id = notification_jobs.id
                   AND recipient.status IN ('failed', 'uncertain')
               ) THEN 'failed'
               WHEN EXISTS (
                 SELECT 1 FROM operator_alert_recipients recipient
                 WHERE recipient.notification_job_id = notification_jobs.id
                   AND recipient.status = 'sent'
               ) THEN 'sent'
               ELSE 'cancelled'
             END,
             attempts = COALESCE((
               SELECT MAX(recipient.attempts) FROM operator_alert_recipients recipient
               WHERE recipient.notification_job_id = notification_jobs.id
             ), 0),
             next_attempt_at = (
               SELECT MIN(recipient.next_attempt_at) FROM operator_alert_recipients recipient
               WHERE recipient.notification_job_id = notification_jobs.id
                 AND recipient.status = 'pending'
             ),
             last_error_code = CASE
               WHEN EXISTS (
                 SELECT 1 FROM operator_alert_recipients recipient
                 WHERE recipient.notification_job_id = notification_jobs.id
                   AND recipient.status IN ('pending', 'processing')
               ) THEN NULL
               ELSE (
                 SELECT recipient.last_error_code
                 FROM operator_alert_recipients recipient
                 WHERE recipient.notification_job_id = notification_jobs.id
                   AND recipient.status IN ('uncertain', 'failed')
                 ORDER BY CASE recipient.status WHEN 'uncertain' THEN 0 ELSE 1 END,
                          recipient.updated_at DESC, recipient.id DESC
                 LIMIT 1
               )
             END,
             updated_at = ?
         WHERE id = ?
           AND kind IN ('operator_private_report', 'operator_field_note_moderation')`
      )
      .bind(timestamp, jobId)
      .run();
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

  async listModerationReplies(
    options: { limit?: number; cursor?: string | null } = {}
  ): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = parseModerationCursor(options.cursor);
    const pagination = cursor
      ? "AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))"
      : "AND r.created_at <= ?";
    const bindings = cursor
      ? [cursor.createdAt, cursor.createdAt, cursor.id]
      : [now()];
    const result = await this.db
      .prepare(
        `SELECT r.id, r.field_note_id, r.body, r.status, r.created_at, r.moderated_at,
                p.participation_basis, p.public_display_name, p.public_handle,
                n.body AS note_body, w.route_order AS waypoint_route_order, w.name AS waypoint_name,
                (SELECT COUNT(*) FROM content_flags f
                 WHERE f.target_kind = 'reply' AND f.target_id = r.id
                   AND f.status IN ('received', 'reviewing')) AS flag_count
         FROM field_note_replies r
         JOIN field_notes n ON n.id = r.field_note_id AND n.status = 'approved'
         JOIN hunter_profiles p ON p.subject = r.author_subject
         LEFT JOIN waypoints w ON w.id = n.waypoint_id AND w.is_published = 1
         WHERE r.status IN ('published', 'hidden') ${pagination}
         ORDER BY r.created_at DESC, r.id DESC LIMIT ?`
      )
      .bind(...bindings, limit + 1)
      .all<Row>();
    const rows = result.results;
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        noteId: row.field_note_id,
        noteExcerpt: row.note_body,
        waypointRouteOrder: numberOrNull(row.waypoint_route_order),
        waypointName: nullable(row.waypoint_name),
        body: row.body,
        authorHandle: publicHunterIdentity({
          participationBasis: nullable(row.participation_basis),
          publicDisplayName: nullable(row.public_display_name),
          publicHandle: nullable(row.public_handle)
        }),
        status: row.status,
        flagCount: Number(row.flag_count),
        createdAt: row.created_at,
        moderatedAt: nullable(row.moderated_at)
      })),
      nextCursor: rows.length > limit
        ? moderationCursor(rows[limit - 1]?.created_at, rows[limit - 1]?.id)
        : null
    };
  }

  async listContentFlags(
    options: { limit?: number; cursor?: string | null } = {}
  ): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = parseModerationCursor(options.cursor);
    const pagination = cursor
      ? "AND (f.created_at < ? OR (f.created_at = ? AND f.id < ?))"
      : "AND f.created_at <= ?";
    const bindings = cursor
      ? [cursor.createdAt, cursor.createdAt, cursor.id]
      : [now()];
    const result = await this.db
      .prepare(
        `SELECT f.id, f.target_kind, f.target_id, f.reason, f.status, f.created_at,
                CASE WHEN f.target_kind = 'reply' THEN r.body ELSE n.body END AS target_excerpt,
                CASE WHEN f.target_kind = 'reply' THEN r.status ELSE n.status END AS target_status,
                p.participation_basis, p.public_display_name, p.public_handle,
                n.body AS note_body, w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM content_flags f
         LEFT JOIN field_note_replies r ON f.target_kind = 'reply' AND r.id = f.target_id
         JOIN field_notes n ON n.id = CASE WHEN f.target_kind = 'reply' THEN r.field_note_id ELSE f.target_id END
           AND n.status = 'approved'
         JOIN hunter_profiles p ON p.subject = CASE WHEN f.target_kind = 'reply' THEN r.author_subject ELSE n.author_subject END
         LEFT JOIN waypoints w ON w.id = n.waypoint_id AND w.is_published = 1
         WHERE f.status IN ('received', 'reviewing') ${pagination}
         ORDER BY f.created_at DESC, f.id DESC LIMIT ?`
      )
      .bind(...bindings, limit + 1)
      .all<Row>();
    const rows = result.results;
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        targetKind: row.target_kind,
        targetId: row.target_id,
        targetExcerpt: row.target_excerpt,
        authorHandle: publicHunterIdentity({
          participationBasis: nullable(row.participation_basis),
          publicDisplayName: nullable(row.public_display_name),
          publicHandle: nullable(row.public_handle)
        }),
        targetStatus: row.target_status,
        noteExcerpt: row.note_body,
        waypointRouteOrder: numberOrNull(row.waypoint_route_order),
        waypointName: nullable(row.waypoint_name),
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at
      })),
      nextCursor: rows.length > limit
        ? moderationCursor(rows[limit - 1]?.created_at, rows[limit - 1]?.id)
        : null
    };
  }

  async moderateContentFlag(
    flagId: string,
    action: "dismiss" | "hide_target",
    reason: string,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const timestamp = now();
    if (action === "dismiss") {
      const [flagResult] = await this.db.batch([
        this.db
          .prepare(
            `UPDATE content_flags
             SET status = 'dismissed', resolved_at = ?, resolved_by = ?
             WHERE id = ? AND status IN ('received', 'reviewing')`
          )
          .bind(timestamp, actorSubject, flagId),
        this.auditStatement(
          actorSubject,
          "content_flag.dismissed",
          "content_flag",
          flagId,
          { reason },
          timestamp
        )
      ]);
      if (Number(flagResult?.meta.changes) !== 1) return null;
      return { id: flagId, status: "dismissed", resolvedAt: timestamp };
    }

    const [replyResult] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE field_note_replies
           SET status = 'hidden', moderated_at = ?, moderated_by = ?
           WHERE id = (
             SELECT target_id FROM content_flags
             WHERE id = ? AND target_kind = 'reply' AND status IN ('received', 'reviewing')
           ) AND status = 'published'`
        )
        .bind(timestamp, actorSubject, flagId),
      this.auditStatement(
        actorSubject,
        "content_flag.target_hidden",
        "content_flag",
        flagId,
        { reason },
        timestamp
      ),
      this.db
        .prepare(
          `UPDATE content_flags
           SET status = 'resolved', resolved_at = ?, resolved_by = ?
           WHERE target_kind = 'reply'
             AND target_id = (
               SELECT target_id FROM content_flags
               WHERE id = ? AND target_kind = 'reply' AND status IN ('received', 'reviewing')
             )
             AND status IN ('received', 'reviewing')
             AND EXISTS (
               SELECT 1 FROM field_note_replies r
               WHERE r.id = content_flags.target_id AND r.status = 'hidden'
                 AND r.moderated_at = ? AND r.moderated_by = ?
             )`
        )
        .bind(timestamp, actorSubject, flagId, timestamp, actorSubject)
    ]);
    if (Number(replyResult?.meta.changes) !== 1) return null;
    return { id: flagId, status: "resolved", resolvedAt: timestamp };
  }

  async moderateReply(
    replyId: string,
    action: "hide" | "restore",
    reason: string,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const timestamp = now();
    const nextStatus = action === "hide" ? "hidden" : "published";
    const expectedStatus = action === "hide" ? "published" : "hidden";
    const [replyResult] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE field_note_replies
           SET status = ?, moderated_at = ?, moderated_by = ?
           WHERE id = ? AND status = ?`
        )
        .bind(nextStatus, timestamp, actorSubject, replyId, expectedStatus),
      this.auditStatement(
        actorSubject,
        action === "hide" ? "reply.hidden" : "reply.restored",
        "field_note_reply",
        replyId,
        { reason },
        timestamp
      ),
      ...(action === "hide"
        ? [
            this.db
              .prepare(
                `UPDATE content_flags
                 SET status = 'resolved', resolved_at = ?, resolved_by = ?
                 WHERE target_kind = 'reply' AND target_id = ?
                   AND status IN ('received', 'reviewing')`
              )
              .bind(timestamp, actorSubject, replyId)
          ]
        : [])
    ]);
    if (Number(replyResult?.meta.changes) !== 1) return null;
    return { id: replyId, status: nextStatus, moderatedAt: timestamp };
  }

  async isActiveStaff(subject: string, normalizedEmail: string | null): Promise<boolean> {
    if (!normalizedEmail) return false;
    const normalized = normalizedEmail.trim().toLowerCase();
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
        `SELECT id, provider_subject, status FROM staff_principals
         WHERE normalized_email = ? LIMIT 1`
      )
      .bind(normalized)
      .first<Row>();
    if (invitation) {
      if (invitation.provider_subject || invitation.status !== "invited") return false;
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

    if (!isAllowedStaffEmail(normalized)) return false;
    const timestamp = now();
    const principalId = id();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO staff_principals
             (id, provider_subject, normalized_email, display_name, status,
              invited_at, activated_at, last_login_at)
             VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
          )
          .bind(
            principalId,
            subject,
            normalized,
            staffDisplayName(normalized),
            timestamp,
            timestamp,
            timestamp
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events
             (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
             VALUES (?, ?, 'staff.domain_activated', 'staff_principal', ?, ?, ?)`
          )
          .bind(id(), subject, principalId, json({ domain: normalized.split("@")[1] }), timestamp)
      ]);
      return true;
    } catch {
      const raced = await this.db
        .prepare(
          `SELECT id FROM staff_principals
           WHERE provider_subject = ? AND normalized_email = ? AND status = 'active' LIMIT 1`
        )
        .bind(subject, normalized)
        .first<Row>();
      return Boolean(raced);
    }
  }

  async getOpsDashboard(): Promise<Record<string, unknown>> {
    const [countsResult, flagsResult] = await Promise.all([
      this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM field_notes WHERE status = 'pending') AS pending_notes,
             (SELECT COUNT(*) FROM private_reports WHERE status = 'received') AS received_reports,
             (SELECT COUNT(*)
              FROM content_flags flag
              LEFT JOIN field_note_replies reply ON flag.target_kind = 'reply' AND reply.id = flag.target_id
              JOIN field_notes note ON note.id = CASE WHEN flag.target_kind = 'reply' THEN reply.field_note_id ELSE flag.target_id END
                AND note.status = 'approved'
              JOIN hunter_profiles author ON author.subject = CASE WHEN flag.target_kind = 'reply' THEN reply.author_subject ELSE note.author_subject END
              WHERE flag.status IN ('received', 'reviewing')) AS received_flags`
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
      .prepare(
        `SELECT r.*, w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM private_reports r
         LEFT JOIN waypoints w ON w.id = r.waypoint_id
         WHERE r.created_at <= ? ORDER BY r.created_at DESC LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const rows = result.results;
    return {
      items: rows.slice(0, limit).map((row) => this.privateReportFromRow(row)),
      nextCursor: rows.length > limit ? value(rows[limit - 1]?.created_at) : null
    };
  }

  async getReportDetail(
    reportId: string,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const report = await this.reportById(reportId);
    if (!report) return null;
    const [publication, caseNote] = await Promise.all([
      this.reportPublicationPreview(reportId),
      this.reportCaseNoteBySource(reportId)
    ]);
    await this.audit(actorSubject, "report.detail.viewed", "report", reportId, {});
    return {
      ...report,
      ...publication,
      caseNote: {
        published: caseNote?.status === "published",
        noteId: caseNote?.status === "published" ? caseNote.id : null,
        status: caseNote?.status ?? null
      }
    };
  }

  async getReportMedia(
    reportId: string,
    mediaId: string,
    actorSubject: string
  ): Promise<{ key: string; contentType: string } | null> {
    const row = await this.db
      .prepare(
        `SELECT derivative_object_key, content_type
         FROM media_uploads
         WHERE id = ? AND owner_kind = 'report' AND owner_id = ? AND status = 'ready'
           AND derivative_object_key IS NOT NULL
         LIMIT 1`
      )
      .bind(mediaId, reportId)
      .first<Row>();
    const key = value(row?.derivative_object_key);
    if (!row || !key.startsWith("derivatives/") || key === "derivatives/") return null;
    await this.audit(actorSubject, "report.media.viewed", "report", reportId, { mediaId });
    return { key, contentType: value(row.content_type) };
  }

  async updateReport(
    reportId: string,
    input: Record<string, unknown>,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.reportById(reportId);
    if (!existing) return null;
    const requestedStatus = input.status;
    const currentStatus = existing.status;
    const terminal = requestedStatus === "rejected" || requestedStatus === "resolved";
    if (terminal) {
      const activePublication = await this.db
        .prepare(
          `SELECT 1 AS active FROM official_updates
           WHERE source_report_id = ?
             AND (status = 'published' OR (status = 'scheduled' AND scheduled_for <= ?))
           LIMIT 1`
        )
        .bind(reportId, now())
        .first<Row>();
      if (activePublication) {
        throw new ApiError(
          409,
          "report_publication_active",
          "Unpublish the linked report post before moving this report to a terminal state."
        );
      }
    }
    if (
      !isReportReviewState(currentStatus) ||
      !isReportReviewState(requestedStatus) ||
      !nextReportStates(currentStatus).includes(requestedStatus)
    ) {
      throw new ApiError(
        409,
        "report_transition_invalid",
        `Invalid report transition: cannot move from ${String(currentStatus)} to ${String(requestedStatus)}.`
      );
    }
    const timestamp = now();
    const assignedTo = nullable(input.assignedTo) ?? nullable(existing.assignedTo) ??
      (requestedStatus === "reviewing" ? actorSubject : null);
    const operationToken = `report-status:${id()}`;
    const eventId = id();
    const auditId = id();
    const update = terminal
      ? this.db.prepare(
          `UPDATE private_reports
           SET status = ?, assigned_to = ?, updated_at = ?
           WHERE id = ? AND status = ?
             AND NOT EXISTS (
               SELECT 1 FROM official_updates
               WHERE source_report_id = ?
                 AND (status = 'published' OR (status = 'scheduled' AND scheduled_for <= ?))
             )`
        ).bind(requestedStatus, operationToken, timestamp, reportId, currentStatus, reportId, timestamp)
      : this.db.prepare(
          `UPDATE private_reports SET status = ?, assigned_to = ?, updated_at = ?
           WHERE id = ? AND status = ?`
        ).bind(requestedStatus, operationToken, timestamp, reportId, currentStatus);
    const results = await this.db.batch([
      update,
      this.db.prepare(
        `INSERT INTO report_events (id, report_id, event_type, actor_subject, note, occurred_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM private_reports WHERE id = ? AND assigned_to = ?
         )`
      ).bind(
        eventId,
        reportId,
        `status.${requestedStatus}`,
        actorSubject,
        input.note ?? null,
        timestamp,
        reportId,
        operationToken
      ),
      this.db.prepare(
        `INSERT INTO audit_events
         (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
         SELECT ?, ?, 'report.updated', 'report', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM private_reports WHERE id = ? AND assigned_to = ?
         )`
      ).bind(
        auditId,
        actorSubject,
        reportId,
        json({ status: requestedStatus }),
        timestamp,
        reportId,
        operationToken
      ),
      this.db.prepare(
        `UPDATE private_reports SET assigned_to = ?
         WHERE id = ? AND assigned_to = ?
           AND EXISTS (SELECT 1 FROM report_events WHERE id = ?)
           AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`
      ).bind(assignedTo, reportId, operationToken, eventId, auditId)
    ]);
    const updateChanged = Number(results[0]?.meta.changes) === 1;
    const historyComplete = results.every((result) => Number(result.meta.changes) === 1);
    if (terminal && !updateChanged) {
      throw new ConflictError("The report changed. Refresh and try again.");
    }
    if (!updateChanged || !historyComplete) {
      throw new ConflictError("The report changed. Refresh and try again.");
    }
    return this.reportById(reportId);
  }

  async publishReportToCaseNotes(
    reportId: string,
    input: { body: string; mediaIds: string[] },
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.reportCaseNoteBySource(reportId);
    if (existing) {
      if (existing.status === "withdrawn") {
        throw new ApiError(
          409,
          "report_case_note_withdrawn",
          "This report's Case Note is withdrawn. Create a new editorial action before republishing it."
        );
      }
      return existing;
    }
    const report = await this.db
      .prepare(
        `SELECT id, status, waypoint_id, latitude, longitude, public_attribution, attribution_kind
         FROM private_reports WHERE id = ? LIMIT 1`
      )
      .bind(reportId)
      .first<Row>();
    if (!report) return null;
    if (!["reviewing", "contacted", "escalated", "verified"].includes(value(report.status))) {
      throw new ApiError(
        409,
        "report_case_note_state_invalid",
        "Begin or complete private review before publishing a Case Note."
      );
    }
    const body = input.body.trim();
    if (!body || body.length > 1_200) {
      throw new ApiError(422, "validation_failed", "Case Note copy must be 1 to 1,200 characters.");
    }
    const mediaIds = [...new Set(input.mediaIds)];
    if (mediaIds.length !== input.mediaIds.length || mediaIds.length > 3) {
      throw new ApiError(422, "publication_media_invalid", "Select up to three unique report images.");
    }
    if (mediaIds.length > 0) {
      const placeholders = mediaIds.map(() => "?").join(",");
      const selected = await this.db
        .prepare(
          `SELECT id, derivative_object_key FROM media_uploads
           WHERE owner_kind = 'report' AND owner_id = ? AND status = 'ready'
             AND derivative_object_key IS NOT NULL AND id IN (${placeholders})`
        )
        .bind(reportId, ...mediaIds)
        .all<Row>();
      if (
        selected.results.length !== mediaIds.length ||
        selected.results.some((row) => {
          const key = value(row.derivative_object_key);
          return !key.startsWith("derivatives/") || key === "derivatives/";
        })
      ) {
        throw new ApiError(
          422,
          "publication_media_invalid",
          "Selected report media is not ready for publication."
        );
      }
    }
    const preview = await this.reportPublicationPreview(reportId);
    if (!preview.publicationEligible || !preview.publicAttribution) {
      throw new ApiError(
        409,
        "report_publication_ineligible",
        "This report is not eligible for a public attribution."
      );
    }
    const rawKind = nullable(report.attribution_kind);
    const attributionKind = rawKind === "display_name" || rawKind === "hunter_handle" ||
      rawKind === "community" || rawKind === "young_hunter"
      ? rawKind
      : preview.publicAttribution === "Young Hunter"
        ? "young_hunter"
        : preview.publicAttribution === "Community Hunter"
          ? "community"
          : "hunter_handle";
    const noteId = id();
    const timestamp = now();
    const statements = [
      this.db.prepare(
        `INSERT INTO operator_reviewed_case_notes
         (id, source_report_id, public_attribution, attribution_kind, waypoint_id,
          latitude, longitude, body, status, created_at, published_at, moderated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`
      ).bind(
        noteId,
        reportId,
        preview.publicAttribution,
        attributionKind,
        report.waypoint_id ?? null,
        report.latitude ?? null,
        report.longitude ?? null,
        body,
        timestamp,
        timestamp,
        actorSubject
      ),
      this.db.prepare(
        `INSERT INTO report_events (id, report_id, event_type, actor_subject, note, occurred_at)
         VALUES (?, ?, 'case_note.published', ?, ?, ?)`
      ).bind(id(), reportId, actorSubject, `Operator-reviewed Case Note ${noteId}`, timestamp),
      this.db.prepare(
        `INSERT INTO audit_events
         (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
         VALUES (?, ?, 'report.case-note.published', 'report', ?, ?, ?)`
      ).bind(
        id(),
        actorSubject,
        reportId,
        json({ destination: "case_note", noteId, mediaIds }),
        timestamp
      )
    ];
    for (const [position, mediaId] of mediaIds.entries()) {
      statements.push(
        this.db.prepare(
          `INSERT INTO operator_reviewed_case_note_media
           (note_id, media_id, selected_by, selected_at, position)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(noteId, mediaId, actorSubject, timestamp, position)
      );
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      const winner = await this.reportCaseNoteBySource(reportId);
      if (winner) return winner;
      throw error;
    }
    return this.reportCaseNoteBySource(reportId);
  }

  async withdrawReportCaseNote(
    reportId: string,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.reportCaseNoteBySource(reportId);
    if (!existing) return null;
    if (existing.status === "withdrawn") return existing;
    const noteId = value(existing.id);
    const timestamp = now();
    const operationToken = `case-note-withdraw:${id()}`;
    const reportEventId = id();
    const auditId = id();
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE operator_reviewed_case_notes
         SET status = 'withdrawn', withdrawn_at = ?, withdrawn_by = ?
         WHERE id = ? AND source_report_id = ? AND status = 'published'`
      ).bind(timestamp, operationToken, noteId, reportId),
      this.db.prepare(
        `INSERT INTO report_events (id, report_id, event_type, actor_subject, note, occurred_at)
         SELECT ?, ?, 'case_note.withdrawn', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM operator_reviewed_case_notes
           WHERE id = ? AND withdrawn_by = ?
         )`
      ).bind(
        reportEventId,
        reportId,
        actorSubject,
        `Operator-reviewed Case Note ${noteId}`,
        timestamp,
        noteId,
        operationToken
      ),
      this.db.prepare(
        `INSERT INTO audit_events
         (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
         SELECT ?, ?, 'report.case-note.withdrawn', 'report', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM operator_reviewed_case_notes
           WHERE id = ? AND withdrawn_by = ?
         )`
      ).bind(
        auditId,
        actorSubject,
        reportId,
        json({ destination: "case_note", noteId }),
        timestamp,
        noteId,
        operationToken
      ),
      this.db.prepare(
        `UPDATE operator_reviewed_case_notes SET withdrawn_by = ?
         WHERE id = ? AND withdrawn_by = ?
           AND EXISTS (SELECT 1 FROM report_events WHERE id = ?)
           AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`
      ).bind(actorSubject, noteId, operationToken, reportEventId, auditId)
    ]);
    if (results.some((result) => Number(result.meta.changes) !== 1)) {
      throw new ConflictError("The Case Note changed. Refresh and try again.");
    }
    return this.reportCaseNoteBySource(reportId);
  }

  async publishReport(
    reportId: string,
    input: {
      title: string;
      body: string;
      mediaIds: string[];
      mediaSelections?: Array<{
        id: string;
        altText: string | null;
        caption: string | null;
      }>;
      action?: "save_draft" | "schedule" | "publish_now";
      scheduledFor?: string | null;
    },
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const report = await this.db
      .prepare(
        `SELECT r.id, r.status, r.hunter_subject, r.created_at, r.waypoint_id,
                r.latitude, r.longitude, profile.public_handle, profile.full_name,
                profile.participation_basis, profile.guardian_permission_attested_at,
                report_time.id AS report_time_event_id,
                report_time.action AS report_time_action,
                report_account.participation_basis AS report_time_basis
         FROM private_reports r
         LEFT JOIN hunter_profiles profile ON profile.subject = r.hunter_subject
         LEFT JOIN legal_acceptance_events report_time ON report_time.id = (
           SELECT latest.id
           FROM legal_acceptance_events latest
           WHERE latest.hunter_subject = r.hunter_subject
             AND latest.document_type = 'participation_waiver'
             AND latest.accepted_at <= r.created_at
           ORDER BY latest.accepted_at DESC, latest.id DESC LIMIT 1
         )
         LEFT JOIN waiver_account_participants report_account
           ON report_account.acceptance_event_id = report_time.id
         WHERE r.id = ? LIMIT 1`
      )
      .bind(reportId)
      .first<Row>();
    if (!report) return null;
    if (report.status === "rejected" || report.status === "resolved") {
      throw new ApiError(
        409,
        "report_publication_state_invalid",
        "This report cannot be published from its current state."
      );
    }
    const action = input.action ?? "publish_now";
    const desiredStatus = action === "save_draft" ? "draft" : action === "schedule" ? "scheduled" : "published";
    const desiredScheduledFor = action === "schedule" ? input.scheduledFor ?? null : null;
    if (action === "schedule" && (!desiredScheduledFor || Number.isNaN(new Date(desiredScheduledFor).getTime()))) {
      throw new ApiError(422, "validation_failed", "A valid schedule time is required.");
    }
    const hunterSubject = nullable(report.hunter_subject);
    const reportTimeEventId = nullable(report.report_time_event_id);
    const reportTimeBasis = nullable(report.report_time_basis);
    if (hunterSubject) {
      if (
        report.report_time_action !== "accepted" ||
        !reportTimeEventId ||
        (reportTimeBasis !== "adult" && reportTimeBasis !== "minor_guardian_permission")
      ) {
        throw new ApiError(
          409,
          "report_publication_legal_required",
          "The report was not submitted under an effective participation waiver."
        );
      }
      const access = await this.getPlayerAccess(hunterSubject);
      if (!access.participationUnlocked) {
        throw new ApiError(
          409,
          "report_publication_legal_required",
          "Current privacy and participation acceptance is required before publication."
        );
      }
    }

    if ((action === "schedule" || action === "publish_now") && report.status !== "verified") {
      throw new ApiError(
        409,
        "report_update_requires_verification",
        "Verify this private report before scheduling or publishing an Official Update."
      );
    }

    const uniqueMediaIds = [...new Set(input.mediaIds)];
    if (uniqueMediaIds.length !== input.mediaIds.length || uniqueMediaIds.length > 3) {
      throw new ApiError(
        422,
        "publication_media_invalid",
        "Select no more than three distinct report images."
      );
    }
    const mediaSelections = uniqueMediaIds.map((mediaId, position) => {
      const supplied = input.mediaSelections?.[position];
      if (input.mediaSelections && supplied?.id !== mediaId) {
        throw new ApiError(
          422,
          "publication_media_invalid",
          "Publication image details must follow the selected image order."
        );
      }
      return {
        id: mediaId,
        position,
        altText: supplied?.altText?.trim() || null,
        caption: supplied?.caption?.trim() || null,
      };
    });
    const publicMediaById = new Map<
      string,
      { id: string; url: string; contentType: string }
    >();
    const publicMediaKindById = new Map<string, "report" | "official_update">();
    if (uniqueMediaIds.length > 0) {
      const placeholders = uniqueMediaIds.map(() => "?").join(",");
      const selected = await this.db
        .prepare(
          `SELECT id, derivative_object_key, content_type, 'report' AS media_kind
           FROM media_uploads
           WHERE owner_kind = 'report' AND owner_id = ?
             AND status = 'ready' AND derivative_object_key IS NOT NULL
             AND id IN (${placeholders})
           UNION ALL
           SELECT upload.id, upload.derivative_object_key, upload.content_type,
                  'official_update' AS media_kind
           FROM official_update_uploads upload
           JOIN official_updates update_record ON update_record.id = upload.update_id
           WHERE update_record.source_report_id = ?
             AND upload.status = 'ready' AND upload.derivative_object_key IS NOT NULL
             AND upload.id IN (${placeholders})`
        )
        .bind(reportId, ...uniqueMediaIds, reportId, ...uniqueMediaIds)
        .all<Row>();
      const validIds = new Set(
        selected.results
          .filter(
            (row) =>
              value(row.derivative_object_key).startsWith("derivatives/") &&
              value(row.derivative_object_key) !== "derivatives/" &&
              publicImageTypes.has(value(row.content_type))
          )
          .map((row) => {
            const mediaId = value(row.id);
            publicMediaById.set(mediaId, {
              id: mediaId,
              url: `/api/v1/media/${mediaId}`,
              contentType: value(row.content_type)
            });
            publicMediaKindById.set(mediaId, value(row.media_kind) === "official_update" ? "official_update" : "report");
            return mediaId;
          })
      );
      if (uniqueMediaIds.some((mediaId) => !validIds.has(mediaId))) {
        throw new ApiError(
          422,
          "publication_media_invalid",
          "Selected report media is not ready for publication."
        );
      }
      if (mediaSelections.some((selection) =>
        publicMediaKindById.get(selection.id) === "official_update" && !selection.altText
      )) {
        throw new ApiError(
          422,
          "publication_media_alt_required",
          "Add concise alt text for every direct Official Update image selected for publication."
        );
      }
    }

    const existing = await this.db
      .prepare(
        `SELECT id, title, body, publisher_name, published_at, scheduled_for, status,
                public_attribution, waypoint_id, latitude, longitude
         FROM official_updates WHERE source_report_id = ? LIMIT 1`
      )
      .bind(reportId)
      .first<Row>();
    const deterministicUpdateId = `approved-report:${(
      await sha256Hex(`official-update:${reportId}`)
    ).slice(0, 32)}`;
    const updateId = existing ? value(existing.id) : deterministicUpdateId;
    const timestamp = now();
    const effectivePublishedAt = desiredStatus === "scheduled" ? desiredScheduledFor! : timestamp;
    const rawLatitude = numberOrNull(report.latitude);
    const rawLongitude = numberOrNull(report.longitude);
    const validCoordinates =
      rawLatitude !== null &&
      rawLongitude !== null &&
      rawLatitude >= -90 &&
      rawLatitude <= 90 &&
      rawLongitude >= -180 &&
      rawLongitude <= 180;
    const latitude = validCoordinates ? rawLatitude : null;
    const longitude = validCoordinates ? rawLongitude : null;
    const currentBasis = nullable(report.participation_basis);
    const publisherName = !hunterSubject
      ? "Community Hunter"
      : reportTimeBasis === "minor_guardian_permission" ||
          currentBasis === "minor_guardian_permission"
        ? "Young Hunter"
        : reportTimeBasis === "adult" && currentBasis === "adult" && nullable(report.public_handle)
          ? value(report.public_handle)
          : "Community Hunter";
    const waypointId = numberOrNull(report.waypoint_id);
    if (
      existing &&
      existing.status === desiredStatus &&
      existing.title === input.title &&
      existing.body === input.body &&
      existing.publisher_name === publisherName &&
      nullable(existing.public_attribution) === publisherName &&
      numberOrNull(existing.waypoint_id) === waypointId &&
      numberOrNull(existing.latitude) === latitude &&
      numberOrNull(existing.longitude) === longitude &&
      nullable(existing.scheduled_for) === desiredScheduledFor
    ) {
      const selected = await this.db
        .prepare(
          `SELECT media_id AS id, position, alt_text, caption, 'report' AS media_kind
           FROM official_update_media WHERE update_id = ?
           UNION ALL
           SELECT upload_id AS id, position, alt_text, caption, 'official_update' AS media_kind
           FROM official_update_uploaded_media WHERE update_id = ?
           ORDER BY position, id`
        )
        .bind(updateId, updateId)
        .all<Row>();
      const existingSelections = selected.results.map((row) => ({
        id: value(row.id),
        position: Number(row.position),
        altText: nullable(row.alt_text),
        caption: nullable(row.caption),
        kind: value(row.media_kind),
      }));
      const requestedSelections = mediaSelections.map((selection) => ({
        ...selection,
        kind: publicMediaKindById.get(selection.id) ?? "report",
      }));
      if (canonicalJson(existingSelections) === canonicalJson(requestedSelections)) {
        return {
          id: updateId,
          kind: "approved_report",
          title: input.title,
          body: input.body,
          publisherName,
          waypointId,
          latitude,
          longitude,
          media: uniqueMediaIds.map((mediaId) => publicMediaById.get(mediaId)!),
          publishedAt: value(existing.published_at),
          scheduledFor: desiredScheduledFor,
          status: desiredStatus
        };
      }
    }
    const publication = {
      kind: "approved_report",
      action,
      status: desiredStatus,
      scheduledFor: desiredScheduledFor,
      title: input.title,
      body: input.body,
      publisherName,
      waypointId,
      latitude,
      longitude,
      mediaIds: uniqueMediaIds
    };
    const publicationHash = await sha256Hex(canonicalJson(publication));
    const operationToken = `publication:${id()}`;
    const reportStatusGuard = desiredStatus === "draft"
      ? "AND r.status NOT IN ('rejected', 'resolved')"
      : "AND r.status = 'verified'";
    const reportEventType = desiredStatus === "draft"
      ? "update_draft_saved"
      : desiredStatus === "scheduled"
        ? "update_scheduled"
        : "published";
    const auditAction = desiredStatus === "draft"
      ? "report.update.draft_saved"
      : desiredStatus === "scheduled"
        ? "report.update.scheduled"
        : "report.published";
    const signedGuard = hunterSubject
      ? `AND r.hunter_subject = ?
         AND profile.full_name = ?
         AND profile.participation_basis = ?
         AND profile.guardian_permission_attested_at IS ?
         AND profile.public_handle IS ?
         AND EXISTS (
           SELECT 1 FROM player_accounts account
           WHERE account.subject = r.hunter_subject AND account.account_state = 'active'
         )
         AND ? = (
           SELECT latest.id
           FROM legal_acceptance_events latest
           WHERE latest.hunter_subject = r.hunter_subject
             AND latest.document_type = 'participation_waiver'
             AND latest.accepted_at <= r.created_at
           ORDER BY latest.accepted_at DESC, latest.id DESC LIMIT 1
         )
         AND EXISTS (
           SELECT 1
           FROM legal_acceptance_events accepted
           JOIN waiver_account_participants account_participant
             ON account_participant.acceptance_event_id = accepted.id
           WHERE accepted.id = ? AND accepted.action = 'accepted'
             AND account_participant.participation_basis = ?
         )
         AND 'accepted' = (
           SELECT current_privacy.action
           FROM legal_acceptance_events current_privacy
           WHERE current_privacy.hunter_subject = r.hunter_subject
             AND current_privacy.document_type = 'privacy_media'
             AND current_privacy.document_version = ?
             AND current_privacy.document_hash = ?
           ORDER BY current_privacy.accepted_at DESC, current_privacy.id DESC LIMIT 1
         )
         AND EXISTS (
           SELECT 1
           FROM legal_acceptance_events current_waiver
           JOIN waiver_account_participants current_participant
             ON current_participant.acceptance_event_id = current_waiver.id
           WHERE current_waiver.id = (
             SELECT latest_current.id
             FROM legal_acceptance_events latest_current
             WHERE latest_current.hunter_subject = r.hunter_subject
               AND latest_current.document_type = 'participation_waiver'
               AND latest_current.document_version = ?
               AND latest_current.document_hash = ?
             ORDER BY latest_current.accepted_at DESC, latest_current.id DESC LIMIT 1
           )
             AND current_waiver.action = 'accepted'
             AND current_participant.participation_basis = profile.participation_basis
             AND current_participant.full_name = profile.full_name
             AND current_participant.guardian_permission_attested =
               CASE profile.participation_basis
                 WHEN 'minor_guardian_permission' THEN 1 ELSE 0
               END
         )`
      : "AND r.hunter_subject IS NULL";
    const signedGuardBindings = hunterSubject
      ? [
          hunterSubject,
          value(report.full_name),
          currentBasis,
          nullable(report.guardian_permission_attested_at),
          nullable(report.public_handle),
          reportTimeEventId,
          reportTimeEventId,
          reportTimeBasis,
          privacyMediaDocument.version,
          privacyMediaDocument.hash,
          participationWaiverDocument.version,
          participationWaiverDocument.hash
        ]
      : [];
    const statements = [
      this.db
        .prepare(
          `INSERT INTO official_updates
           (id, title, body, publisher_subject, publisher_name, published_at, scheduled_for,
            status, source_report_id, public_attribution, waypoint_id, latitude, longitude,
            created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, r.id, ?, ?, ?, ?, ?, ?
           FROM private_reports r
           LEFT JOIN hunter_profiles profile ON profile.subject = r.hunter_subject
           WHERE r.id = ? ${reportStatusGuard}
             AND r.created_at = ? AND r.waypoint_id IS ?
             AND r.latitude IS ? AND r.longitude IS ?
             ${signedGuard}
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             body = excluded.body,
             publisher_subject = excluded.publisher_subject,
             publisher_name = excluded.publisher_name,
             published_at = excluded.published_at,
             scheduled_for = excluded.scheduled_for,
             status = excluded.status,
             source_report_id = excluded.source_report_id,
             public_attribution = excluded.public_attribution,
             waypoint_id = excluded.waypoint_id,
             latitude = excluded.latitude,
             longitude = excluded.longitude,
             updated_at = excluded.updated_at`
        )
        .bind(
          updateId,
          input.title,
          input.body,
          actorSubject,
          publisherName,
          effectivePublishedAt,
          operationToken,
          desiredStatus,
          publisherName,
          waypointId,
          latitude,
          longitude,
          timestamp,
          timestamp,
          reportId,
          value(report.created_at),
          waypointId,
          rawLatitude,
          rawLongitude,
          ...signedGuardBindings
        ),
      this.db
        .prepare(
          `DELETE FROM official_update_media
           WHERE update_id = ? AND EXISTS (
             SELECT 1 FROM official_updates marker
             WHERE marker.id = ? AND marker.scheduled_for = ?
           )`
        )
        .bind(updateId, updateId, operationToken),
      this.db
        .prepare(
          `DELETE FROM official_update_uploaded_media
           WHERE update_id = ? AND EXISTS (
             SELECT 1 FROM official_updates marker
             WHERE marker.id = ? AND marker.scheduled_for = ?
           )`
        )
        .bind(updateId, updateId, operationToken)
    ];
    for (const selection of mediaSelections) {
      if (publicMediaKindById.get(selection.id) === "official_update") {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO official_update_uploaded_media
               (update_id, upload_id, selected_by, selected_at, position, alt_text, caption)
               SELECT ?, ?, ?, ?, ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM official_updates marker
                 WHERE marker.id = ? AND marker.scheduled_for = ?
               )`
            )
            .bind(
              updateId,
              selection.id,
              actorSubject,
              timestamp,
              selection.position,
              selection.altText,
              selection.caption,
              updateId,
              operationToken
            )
        );
      } else {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO official_update_media
               (update_id, media_id, selected_by, selected_at, position, alt_text, caption)
               SELECT ?, ?, ?, ?, ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM official_updates marker
                 WHERE marker.id = ? AND marker.scheduled_for = ?
               )`
            )
            .bind(
              updateId,
              selection.id,
              actorSubject,
              timestamp,
              selection.position,
              selection.altText,
              selection.caption,
              updateId,
              operationToken
            )
        );
      }
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO report_events (id, report_id, event_type, actor_subject, occurred_at)
           SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM official_updates marker
             WHERE marker.id = ? AND marker.scheduled_for = ?
           )`
        )
        .bind(id(), reportId, reportEventType, actorSubject, timestamp, updateId, operationToken),
      this.db
        .prepare(
          `INSERT INTO audit_events
           (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
           SELECT ?, ?, ?, 'report', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM official_updates marker
             WHERE marker.id = ? AND marker.scheduled_for = ?
           )`
        )
        .bind(
          id(),
          actorSubject,
          auditAction,
          reportId,
          json({
            publication,
            publicationHash,
            hashAlgorithm: "sha256"
          }),
          timestamp,
          updateId,
          operationToken
        ),
      this.db
        .prepare(
          `UPDATE official_updates
           SET scheduled_for = ?, status = ?, updated_at = ?
           WHERE id = ? AND scheduled_for = ?`
        )
        .bind(desiredScheduledFor, desiredStatus, timestamp, updateId, operationToken)
    );
    const results = await this.db.batch(statements);
    const firstResult = results[0];
    const finalResult = results[results.length - 1];
    if (Number(firstResult?.meta.changes) !== 1 || Number(finalResult?.meta.changes) !== 1) {
      const latestReport = await this.db
        .prepare("SELECT status FROM private_reports WHERE id = ? LIMIT 1")
        .bind(reportId)
        .first<Row>();
      if (latestReport?.status === "rejected" || latestReport?.status === "resolved") {
        throw new ApiError(
          409,
          "report_publication_state_invalid",
          "This report cannot be published from its current state."
        );
      }
      if (desiredStatus !== "draft" && latestReport?.status !== "verified") {
        throw new ApiError(
          409,
          "report_update_requires_verification",
          "Verify this private report before scheduling or publishing an Official Update."
        );
      }
      if (hunterSubject) {
        throw new ApiError(
          409,
          "report_publication_legal_required",
          "Current privacy and participation acceptance is required before publication."
        );
      }
      throw new ConflictError("The report changed. Refresh and try again.");
    }
    return {
      id: updateId,
      kind: "approved_report",
      title: input.title,
      body: input.body,
      publisherName,
      waypointId,
      latitude,
      longitude,
      media: uniqueMediaIds.map((mediaId) => publicMediaById.get(mediaId)!),
      publishedAt: effectivePublishedAt,
      scheduledFor: desiredScheduledFor,
      status: desiredStatus
    };
  }

  async unpublishReport(
    reportId: string,
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const report = await this.db
      .prepare("SELECT id FROM private_reports WHERE id = ? LIMIT 1")
      .bind(reportId)
      .first<Row>();
    if (!report) return null;
    const update = await this.db
      .prepare("SELECT id, status FROM official_updates WHERE source_report_id = ? LIMIT 1")
      .bind(reportId)
      .first<Row>();
    if (!update) return { id: null, status: "withdrawn" };
    if (update.status === "withdrawn") {
      return { id: update.id, status: "withdrawn" };
    }
    const timestamp = now();
    await this.db.batch([
      this.db
        .prepare("UPDATE official_updates SET status = 'withdrawn' WHERE id = ?")
        .bind(update.id),
      this.db
        .prepare("DELETE FROM official_update_media WHERE update_id = ?")
        .bind(update.id),
      this.db
        .prepare("DELETE FROM official_update_uploaded_media WHERE update_id = ?")
        .bind(update.id),
      this.db
        .prepare(
          `INSERT INTO report_events (id, report_id, event_type, actor_subject, occurred_at)
           VALUES (?, ?, 'unpublished', ?, ?)`
        )
        .bind(id(), reportId, actorSubject, timestamp),
      this.db
        .prepare(
          `INSERT INTO audit_events
           (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
           VALUES (?, ?, 'report.unpublished', 'report', ?, '{}', ?)`
        )
        .bind(id(), actorSubject, reportId, timestamp)
    ]);
    return { id: update.id, status: "withdrawn" };
  }

  async addReportUpdateUploads(
    reportId: string,
    media: StoredMedia[],
    actorSubject: string
  ): Promise<Record<string, unknown> | null> {
    const update = await this.db
      .prepare(
        `SELECT update_record.id, COUNT(upload.id) AS upload_count
         FROM official_updates update_record
         LEFT JOIN official_update_uploads upload ON upload.update_id = update_record.id
         WHERE update_record.source_report_id = ?
         GROUP BY update_record.id LIMIT 1`
      )
      .bind(reportId)
      .first<Row>();
    if (!update) return null;
    if (media.length === 0 || media.length > 3) {
      throw new ApiError(422, "validation_failed", "Choose one to three Update images.");
    }
    if (Number(update.upload_count ?? 0) + media.length > 3) {
      throw new ApiError(422, "validation_failed", "An Official Update can have no more than three direct uploads.");
    }
    const timestamp = now();
    await this.db.batch(media.map((item) => this.db.prepare(
      `INSERT INTO official_update_uploads
       (id, update_id, uploader_subject, private_object_key, content_type,
        byte_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      item.id,
      update.id,
      actorSubject,
      item.key,
      item.contentType ?? "application/octet-stream",
      item.size ?? 0,
      item.status,
      timestamp
    )));
    await this.audit(actorSubject, "report.update.media_uploaded", "report", reportId, {
      updateId: update.id,
      mediaCount: media.length
    });
    return this.reportPublicationPreview(reportId);
  }

  async getReportUpdateMedia(
    reportId: string,
    mediaId: string,
    actorSubject: string
  ): Promise<{ key: string; contentType: string } | null> {
    const row = await this.db.prepare(
      `SELECT upload.derivative_object_key, upload.content_type
       FROM official_update_uploads upload
       JOIN official_updates update_record ON update_record.id = upload.update_id
       WHERE update_record.source_report_id = ? AND upload.id = ?
         AND upload.status = 'ready' AND upload.derivative_object_key IS NOT NULL
       LIMIT 1`
    ).bind(reportId, mediaId).first<Row>();
    const key = nullable(row?.derivative_object_key);
    if (!row || !key?.startsWith("derivatives/") || key === "derivatives/") return null;
    await this.audit(actorSubject, "report.update.media_viewed", "report", reportId, { mediaId });
    return { key, contentType: value(row.content_type) };
  }

  async listPendingNotes(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? now();
    const result = await this.db
      .prepare(
        `SELECT n.id, n.waypoint_id, n.body, n.created_at, p.public_handle,
                w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM field_notes n
         JOIN hunter_profiles p ON p.subject = n.author_subject
         JOIN waypoints w ON w.id = n.waypoint_id
         WHERE n.status = 'pending' AND n.created_at <= ? ORDER BY n.created_at LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const rows = result.results;
    const selected = rows.slice(0, limit);
    const noteIds = selected.map((row) => value(row.id));
    const mediaByNote = new Map<string, Record<string, unknown>[]>();
    if (noteIds.length > 0) {
      const placeholders = noteIds.map(() => "?").join(",");
      const mediaResult = await this.db
        .prepare(
          `SELECT id, owner_id, content_type, byte_size, status
           FROM media_uploads
           WHERE owner_kind = 'field_note' AND owner_id IN (${placeholders})
           ORDER BY CASE status WHEN 'ready' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END,
                    created_at, id`
        )
        .bind(...noteIds)
        .all<Row>();
      for (const row of mediaResult.results) {
        const owner = value(row.owner_id);
        const media = mediaByNote.get(owner) ?? [];
        media.push({
          id: row.id,
          status: row.status,
          contentType: row.content_type,
          size: Number(row.byte_size)
        });
        mediaByNote.set(owner, media);
      }
    }
    return {
      items: selected.map((row) => {
        const media = mediaByNote.get(value(row.id)) ?? [];
        return {
          id: row.id,
          waypointId: Number(row.waypoint_id),
          waypointRouteOrder: Number(row.waypoint_route_order),
          waypointName: row.waypoint_name,
          body: row.body,
          authorHandle: row.public_handle,
          createdAt: row.created_at,
          mediaCount: media.length,
          media
        };
      }),
      nextCursor: rows.length > limit ? value(rows[limit - 1]?.created_at) : null
    };
  }

  async getFieldNoteMedia(
    noteId: string,
    mediaId: string,
    actorSubject: string
  ): Promise<{ key: string; contentType: string } | null> {
    const row = await this.db
      .prepare(
        `SELECT derivative_object_key, content_type
         FROM media_uploads
         WHERE id = ? AND owner_kind = 'field_note' AND owner_id = ? AND status = 'ready'
           AND derivative_object_key IS NOT NULL
         LIMIT 1`
      )
      .bind(mediaId, noteId)
      .first<Row>();
    const key = value(row?.derivative_object_key);
    if (!row || !key.startsWith("derivatives/") || key === "derivatives/") return null;
    await this.audit(actorSubject, "note.media.viewed", "field_note", noteId, { mediaId });
    return { key, contentType: value(row.content_type) };
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
      .prepare(
        `SELECT n.id, n.waypoint_id, n.body, n.status, n.created_at, n.published_at,
                w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM field_notes n
         JOIN waypoints w ON w.id = n.waypoint_id
         WHERE n.id = ?`
      )
      .bind(noteId)
      .first<Row>();
    return row
      ? {
          id: row.id,
          waypointId: Number(row.waypoint_id),
          waypointRouteOrder: Number(row.waypoint_route_order),
          waypointName: row.waypoint_name,
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
      .prepare(
        `SELECT r.*, w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM private_reports r
         LEFT JOIN waypoints w ON w.id = r.waypoint_id
         WHERE r.id = ?`
      )
      .bind(reportId)
      .first<Row>();
    if (!row) return null;
    const media = await this.db
      .prepare(
        `SELECT id, content_type, byte_size, status
         FROM media_uploads WHERE owner_kind = 'report' AND owner_id = ? ORDER BY created_at`
      )
      .bind(reportId)
      .all<Row>();
    return {
      ...this.privateReportFromRow(row),
      media: media.results.map((item) => ({
        id: item.id,
        contentType: item.content_type,
        size: Number(item.byte_size),
        status: item.status
      }))
    };
  }

  private async reportCaseNoteBySource(reportId: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .prepare(
        `SELECT note.id, note.public_attribution, note.attribution_kind, note.waypoint_id,
                note.latitude, note.longitude, note.body, note.status, note.created_at,
                note.published_at, w.route_order AS waypoint_route_order, w.name AS waypoint_name
         FROM operator_reviewed_case_notes note
         LEFT JOIN waypoints w ON w.id = note.waypoint_id AND w.is_published = 1
         WHERE note.source_report_id = ? LIMIT 1`
      )
      .bind(reportId)
      .first<Row>();
    if (!row) return null;
    const media = await this.db
      .prepare(
        `SELECT media.id, media.content_type, selected.alt_text
         FROM operator_reviewed_case_note_media selected
         JOIN media_uploads media ON media.id = selected.media_id
         WHERE selected.note_id = ? AND media.owner_kind = 'report' AND media.status = 'ready'
         ORDER BY selected.position, selected.media_id`
      )
      .bind(row.id)
      .all<Row>();
    return {
      id: row.id,
      noteKind: "operator_reviewed",
      authorHandle: row.public_attribution,
      attributionKind: row.attribution_kind,
      waypointId: row.waypoint_id === null ? null : Number(row.waypoint_id),
      waypointRouteOrder: numberOrNull(row.waypoint_route_order),
      waypointName: nullable(row.waypoint_name),
      latitude: numberOrNull(row.latitude),
      longitude: numberOrNull(row.longitude),
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      media: media.results.map((item) => ({
        id: item.id,
        url: `/api/v1/media/${item.id}`,
        contentType: item.content_type,
        ...(nullable(item.alt_text) ? { alt: item.alt_text } : {})
      })),
      replies: []
    };
  }

  private async reportPublicationPreview(reportId: string): Promise<{
    publicAttribution: string | null;
    publicationEligible: boolean;
    publicationEligibilityReason: string;
    publication: {
      published: boolean;
      updateId: string | null;
      status: string | null;
      scheduledFor: string | null;
      title: string | null;
      body: string | null;
      mediaIds: string[];
      uploads: Array<{
        id: string;
        contentType: string;
        size: number;
        status: string;
        altText: string | null;
        caption: string | null;
        position: number | null;
      }>;
    };
  }> {
    const row = await this.db
      .prepare(
        `SELECT r.hunter_subject, r.status, r.public_attribution, r.attribution_kind,
                profile.public_handle,
                profile.participation_basis,
                report_time.action AS report_time_action,
                report_account.participation_basis AS report_time_basis,
                publication_update.id AS publication_id,
                publication_update.status AS publication_status,
                publication_update.scheduled_for AS publication_scheduled_for,
                publication_update.title AS publication_title,
                publication_update.body AS publication_body
         FROM private_reports r
         LEFT JOIN hunter_profiles profile ON profile.subject = r.hunter_subject
         LEFT JOIN legal_acceptance_events report_time ON report_time.id = (
           SELECT latest.id
           FROM legal_acceptance_events latest
           WHERE latest.hunter_subject = r.hunter_subject
             AND latest.document_type = 'participation_waiver'
             AND latest.accepted_at <= r.created_at
           ORDER BY latest.accepted_at DESC, latest.id DESC LIMIT 1
         )
         LEFT JOIN waiver_account_participants report_account
           ON report_account.acceptance_event_id = report_time.id
         LEFT JOIN official_updates publication_update
           ON publication_update.source_report_id = r.id
         WHERE r.id = ? LIMIT 1`
      )
      .bind(reportId)
      .first<Row>();
    if (!row) {
      return {
        publicAttribution: null,
        publicationEligible: false,
        publicationEligibilityReason: "report_not_found",
        publication: {
          published: false,
          updateId: null,
          status: null,
          scheduledFor: null,
          title: null,
          body: null,
          mediaIds: [],
          uploads: []
        }
      };
    }

    const publicationStatus = nullable(row.publication_status);
    const scheduledFor = nullable(row.publication_scheduled_for);
    const publicationId = nullable(row.publication_id);
    const selectedMedia = publicationId
      ? await this.db
          .prepare("SELECT media_id FROM official_update_media WHERE update_id = ? ORDER BY position, media_id")
          .bind(publicationId)
          .all<Row>()
      : { results: [] as Row[] };
    const updateUploads = publicationId
      ? await this.db.prepare(
          `SELECT upload.id, upload.content_type, upload.byte_size, upload.status,
                  selected.alt_text, selected.caption, selected.position
           FROM official_update_uploads upload
           LEFT JOIN official_update_uploaded_media selected
             ON selected.update_id = upload.update_id AND selected.upload_id = upload.id
           WHERE upload.update_id = ? ORDER BY upload.created_at, upload.id`
        ).bind(publicationId).all<Row>()
      : { results: [] as Row[] };
    const publication = {
      published: publicationStatus === "published" ||
        (publicationStatus === "scheduled" && scheduledFor !== null && scheduledFor <= now()),
      updateId: publicationId,
      status: publicationStatus,
      scheduledFor,
      title: publicationStatus ? nullable(row.publication_title) : null,
      body: publicationStatus ? nullable(row.publication_body) : null,
      mediaIds: selectedMedia.results.map((selected) => value(selected.media_id))
        .concat(updateUploads.results.filter((upload) => upload.position !== null).map((upload) => value(upload.id))),
      uploads: updateUploads.results.map((upload) => ({
        id: value(upload.id),
        contentType: value(upload.content_type),
        size: Number(upload.byte_size ?? 0),
        status: value(upload.status),
        altText: nullable(upload.alt_text),
        caption: nullable(upload.caption),
        position: numberOrNull(upload.position)
      }))
    };
    const preview = (fields: {
      publicAttribution: string | null;
      publicationEligible: boolean;
      publicationEligibilityReason: string;
    }) => ({ ...fields, publication });

    const hunterSubject = nullable(row.hunter_subject);
    const currentBasis = nullable(row.participation_basis);
    const reportTimeBasis = nullable(row.report_time_basis);
    const protectsMinor = currentBasis === "minor_guardian_permission" ||
      reportTimeBasis === "minor_guardian_permission";
    const safeMinorAttribution = protectsMinor ? "Young Hunter" : null;
    const snapshottedAttribution = nullable(row.public_attribution)?.trim() ?? "";
    const snapshottedKind = nullable(row.attribution_kind);
    const safeSnapshot = snapshottedAttribution &&
      (snapshottedKind === "display_name" || snapshottedKind === "hunter_handle" || snapshottedKind === "community")
      ? snapshottedAttribution
      : null;
    if (row.status === "rejected" || row.status === "resolved") {
      return preview({
        publicAttribution: safeMinorAttribution ?? (hunterSubject ? null : "Community Hunter"),
        publicationEligible: false,
        publicationEligibilityReason: "report_state_invalid"
      });
    }
    if (!hunterSubject) {
      return preview({
        publicAttribution: "Community Hunter",
        publicationEligible: true,
        publicationEligibilityReason: "eligible"
      });
    }
    if (
      row.report_time_action !== "accepted" ||
      (reportTimeBasis !== "adult" && reportTimeBasis !== "minor_guardian_permission")
    ) {
      return preview({
        publicAttribution: safeMinorAttribution,
        publicationEligible: false,
        publicationEligibilityReason: "report_time_waiver_required"
      });
    }
    const access = await this.getPlayerAccess(hunterSubject);
    if (!access.participationUnlocked) {
      return preview({
        publicAttribution: safeMinorAttribution,
        publicationEligible: false,
        publicationEligibilityReason: "current_legal_acceptance_required"
      });
    }
    if (currentBasis !== "adult" && currentBasis !== "minor_guardian_permission") {
      return preview({
        publicAttribution: safeMinorAttribution,
        publicationEligible: false,
        publicationEligibilityReason: "profile_participation_required"
      });
    }
    if (protectsMinor) {
      return preview({
        publicAttribution: "Young Hunter",
        publicationEligible: true,
        publicationEligibilityReason: "eligible"
      });
    }
    if (safeSnapshot) {
      return preview({
        publicAttribution: safeSnapshot,
        publicationEligible: true,
        publicationEligibilityReason: "eligible"
      });
    }
    const publicHandle = nullable(row.public_handle)?.trim() ?? "";
    if (!publicHandle) {
      return preview({
        publicAttribution: null,
        publicationEligible: false,
        publicationEligibilityReason: "public_handle_required"
      });
    }
    return preview({
      publicAttribution: publicHandle,
      publicationEligible: true,
      publicationEligibilityReason: "eligible"
    });
  }

  private privateReportFromRow(row: Row): Record<string, unknown> {
    return {
      id: row.id,
      type: row.report_type,
      hunterSubject: row.hunter_subject,
      name: row.reporter_name,
      email: row.reporter_email,
      phone: row.reporter_phone,
      publicAttribution: nullable(row.public_attribution),
      attributionKind: nullable(row.attribution_kind),
      waypointId: row.waypoint_id === null ? null : Number(row.waypoint_id),
      waypointRouteOrder: numberOrNull(row.waypoint_route_order),
      waypointName: nullable(row.waypoint_name),
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
      publicDisplayName: nullable(row.public_display_name),
      townArea: row.town_area,
      interests: parseJson(row.interests_json, []),
      discoverySource: row.discovery_source,
      consents: consentProjection(row),
      adultAttestedAt: row.adult_attested_at,
      participationBasis: row.participation_basis,
      guardianPermissionAttestedAt: row.guardian_permission_attested_at,
      guardianPermissionAttested: Boolean(row.guardian_permission_attested_at),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private operatorAlertRecipientSnapshotStatement(jobId: string, createdAt: string) {
    return this.db
      .prepare(
        `INSERT INTO operator_alert_recipients
         (id, notification_job_id, staff_principal_id, recipient_email, status, attempts,
          created_at, updated_at)
         SELECT lower(hex(randomblob(16))), ?, staff.id, staff.normalized_email,
                'pending', 0, ?, ?
         FROM staff_principals staff
         WHERE staff.status = 'active'
           AND staff.provider_subject IS NOT NULL
           AND staff.activated_at IS NOT NULL
         ORDER BY staff.id`
      )
      .bind(jobId, createdAt, createdAt);
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

  private auditStatement(
    actorSubject: string,
    action: string,
    targetKind: string,
    targetId: string | null,
    metadata: Record<string, unknown>,
    occurredAt: string
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
         (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`
      )
      .bind(id(), actorSubject, action, targetKind, targetId, json(metadata), occurredAt);
  }
}
