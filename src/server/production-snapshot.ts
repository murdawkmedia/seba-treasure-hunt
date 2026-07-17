import type { Page, ProductionSnapshotStore } from "./types";

type Row = Record<string, unknown>;

const value = (input: unknown): string => (typeof input === "string" ? input : "");
const nullable = (input: unknown): string | null =>
  typeof input === "string" && input.length > 0 ? input : null;
const numberOrNull = (input: unknown): number | null =>
  typeof input === "number" && Number.isFinite(input) ? input : null;
const pageLimit = (limit: number | undefined) => Math.min(Math.max(limit ?? 25, 1), 50);
const defaultCursor = () => new Date().toISOString();

const reportFromRow = (row: Row): Record<string, unknown> => ({
  id: value(row.id),
  reportType: value(row.report_type),
  hunterSubject: nullable(row.hunter_subject),
  reporterName: value(row.reporter_name),
  reporterEmail: value(row.reporter_email),
  reporterPhone: nullable(row.reporter_phone),
  waypointId: numberOrNull(row.waypoint_id),
  waypointRouteOrder: numberOrNull(row.waypoint_route_order),
  waypointName: nullable(row.waypoint_name),
  locationDescription: value(row.location_description),
  latitude: numberOrNull(row.latitude),
  longitude: numberOrNull(row.longitude),
  details: value(row.details),
  status: value(row.status),
  assignedTo: nullable(row.assigned_to),
  participationBasis: nullable(row.participation_basis),
  publicHandle: nullable(row.public_handle),
  createdAt: value(row.created_at),
  updatedAt: value(row.updated_at)
});

const playerFromRow = (row: Row): Record<string, unknown> => ({
  id: value(row.subject),
  subject: value(row.subject),
  verifiedEmail: nullable(row.verified_email),
  accountState: value(row.account_state),
  fullName: nullable(row.full_name),
  publicHandle: nullable(row.public_handle),
  townArea: nullable(row.town_area),
  participationBasis: nullable(row.participation_basis),
  profileCompletedAt: nullable(row.profile_completed_at),
  privacyMediaVersion: nullable(row.privacy_version),
  privacyMediaAction: nullable(row.privacy_action),
  waiverVersion: nullable(row.waiver_version),
  waiverAcceptedAt: nullable(row.waiver_accepted_at),
  huntEmailConsent: row.hunt_email_consent === 1,
  marketingConsent: row.marketing_consent === 1,
  createdAt: value(row.created_at),
  updatedAt: value(row.updated_at),
  lastSeenAt: value(row.last_seen_at)
});

const snapshotMetadata = async (db: D1Database): Promise<Row | null> => {
  const row = await db
    .prepare(
      `SELECT kind, status, snapshot_id, source_environment, verified_at,
              source_updated_at, report_count, player_count, staff_count,
              audit_count, media_count
       FROM snapshot_refresh_metadata WHERE id = 1 LIMIT 1`
    )
    .first<Row>();
  return row?.kind === "production-snapshot" && row.status === "verified" ? row : null;
};

const verified = async (db: D1Database) => Boolean(await snapshotMetadata(db));

export class D1ProductionSnapshotStore implements ProductionSnapshotStore {
  constructor(private readonly db: D1Database) {}

  async summary(): Promise<Record<string, unknown> | null> {
    const row = await snapshotMetadata(this.db);
    if (!row) return null;
    return {
      kind: row.kind,
      status: row.status,
      snapshotId: value(row.snapshot_id),
      sourceEnvironment: value(row.source_environment),
      verifiedAt: value(row.verified_at),
      sourceUpdatedAt: value(row.source_updated_at),
      counts: {
        reports: Number(row.report_count ?? 0),
        players: Number(row.player_count ?? 0),
        staff: Number(row.staff_count ?? 0),
        audit: Number(row.audit_count ?? 0),
        media: Number(row.media_count ?? 0)
      }
    };
  }

  async listReports(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    if (!(await verified(this.db))) return { items: [], nextCursor: null };
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? defaultCursor();
    const result = await this.db
      .prepare(
        `SELECT r.*, w.route_order AS waypoint_route_order, w.name AS waypoint_name,
                profile.participation_basis, profile.public_handle
         FROM private_reports AS r
         LEFT JOIN waypoints AS w ON w.id = r.waypoint_id
         LEFT JOIN hunter_profiles AS profile ON profile.subject = r.hunter_subject
         WHERE r.created_at <= ?
         ORDER BY r.created_at DESC, r.id DESC LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const selected = result.results.slice(0, limit);
    return {
      items: selected.map(reportFromRow),
      nextCursor:
        result.results.length > limit && selected.length > 0
          ? value(selected.at(-1)?.created_at)
          : null
    };
  }

  async getReport(id: string): Promise<Record<string, unknown> | null> {
    if (!(await verified(this.db))) return null;
    const row = await this.db
      .prepare(
        `SELECT r.*, w.route_order AS waypoint_route_order, w.name AS waypoint_name,
                profile.participation_basis, profile.public_handle
         FROM private_reports AS r
         LEFT JOIN waypoints AS w ON w.id = r.waypoint_id
         LEFT JOIN hunter_profiles AS profile ON profile.subject = r.hunter_subject
         WHERE r.id = ? LIMIT 1`
      )
      .bind(id)
      .first<Row>();
    if (!row) return null;
    const [events, media] = await Promise.all([
      this.db
        .prepare(
          `SELECT id, event_type, actor_subject, note, occurred_at
           FROM report_events WHERE report_id = ? ORDER BY occurred_at, id`
        )
        .bind(id)
        .all<Row>(),
      this.db
        .prepare(
          `SELECT id, content_type, byte_size, status, created_at, processed_at
           FROM media_uploads WHERE owner_kind = 'report' AND owner_id = ?
           ORDER BY created_at, id`
        )
        .bind(id)
        .all<Row>()
    ]);
    return {
      ...reportFromRow(row),
      events: events.results.map((event) => ({
        id: value(event.id),
        eventType: value(event.event_type),
        actorSubject: nullable(event.actor_subject),
        note: nullable(event.note),
        occurredAt: value(event.occurred_at)
      })),
      media: media.results.map((item) => ({
        id: value(item.id),
        contentType: value(item.content_type),
        byteSize: Number(item.byte_size ?? 0),
        status: value(item.status),
        createdAt: value(item.created_at),
        processedAt: nullable(item.processed_at)
      }))
    };
  }

  async getReportMedia(
    reportId: string,
    mediaId: string
  ): Promise<{ key: string; contentType: string } | null> {
    if (!(await verified(this.db))) return null;
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
    if (!row || !/^snapshots\/[^/]+\/.+/.test(key)) return null;
    return { key, contentType: value(row.content_type) };
  }

  async listPlayers(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    if (!(await verified(this.db))) return { items: [], nextCursor: null };
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? defaultCursor();
    const result = await this.db
      .prepare(
        `WITH latest_legal AS (
           SELECT hunter_subject, document_type, document_version, action, accepted_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY hunter_subject, document_type ORDER BY accepted_at DESC, id DESC
                  ) AS legal_rank
           FROM legal_acceptance_events
         ), latest_consents AS (
           SELECT hunter_subject, consent_type, granted,
                  ROW_NUMBER() OVER (
                    PARTITION BY hunter_subject, consent_type ORDER BY occurred_at DESC, id DESC
                  ) AS consent_rank
           FROM consent_events
         )
         SELECT account.*, profile.full_name, profile.public_handle, profile.town_area,
                profile.participation_basis,
                privacy.document_version AS privacy_version, privacy.action AS privacy_action,
                waiver.document_version AS waiver_version, waiver.accepted_at AS waiver_accepted_at,
                COALESCE(hunt.granted, 0) AS hunt_email_consent,
                COALESCE(marketing.granted, 0) AS marketing_consent
         FROM player_accounts AS account
         LEFT JOIN hunter_profiles AS profile ON profile.subject = account.subject
         LEFT JOIN latest_legal AS privacy ON privacy.hunter_subject = account.subject
           AND privacy.document_type = 'privacy_media' AND privacy.legal_rank = 1
         LEFT JOIN latest_legal AS waiver ON waiver.hunter_subject = account.subject
           AND waiver.document_type = 'participation_waiver' AND waiver.legal_rank = 1
         LEFT JOIN latest_consents AS hunt ON hunt.hunter_subject = account.subject
           AND hunt.consent_type = 'hunt_email' AND hunt.consent_rank = 1
         LEFT JOIN latest_consents AS marketing ON marketing.hunter_subject = account.subject
           AND marketing.consent_type = 'marketing' AND marketing.consent_rank = 1
         WHERE account.updated_at <= ?
         ORDER BY account.updated_at DESC, account.subject DESC LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const selected = result.results.slice(0, limit);
    return {
      items: selected.map(playerFromRow),
      nextCursor:
        result.results.length > limit && selected.length > 0
          ? value(selected.at(-1)?.updated_at)
          : null
    };
  }

  async listStaff(): Promise<Record<string, unknown>[]> {
    if (!(await verified(this.db))) return [];
    const result = await this.db
      .prepare(
        `SELECT id, provider_subject, normalized_email, display_name, status,
                invited_at, activated_at, last_login_at, authorization_version
         FROM staff_principals ORDER BY normalized_email`
      )
      .all<Row>();
    return result.results.map((row) => ({
      id: value(row.id),
      subject: nullable(row.provider_subject),
      email: value(row.normalized_email),
      displayName: nullable(row.display_name),
      status: value(row.status),
      invitedAt: value(row.invited_at),
      activatedAt: nullable(row.activated_at),
      lastLoginAt: nullable(row.last_login_at),
      authorizationVersion: Number(row.authorization_version ?? 0)
    }));
  }

  async listAudit(options: { limit?: number; cursor?: string | null } = {}): Promise<Page> {
    if (!(await verified(this.db))) return { items: [], nextCursor: null };
    const limit = pageLimit(options.limit);
    const cursor = options.cursor ?? defaultCursor();
    const result = await this.db
      .prepare(
        `SELECT id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at
         FROM audit_events WHERE occurred_at <= ?
         ORDER BY occurred_at DESC, id DESC LIMIT ?`
      )
      .bind(cursor, limit + 1)
      .all<Row>();
    const selected = result.results.slice(0, limit);
    return {
      items: selected.map((row) => ({
        id: value(row.id),
        actor: value(row.actor_subject),
        action: value(row.action),
        targetKind: value(row.target_kind),
        targetId: nullable(row.target_id),
        metadataJson: value(row.metadata_json),
        occurredAt: value(row.occurred_at)
      })),
      nextCursor:
        result.results.length > limit && selected.length > 0
          ? value(selected.at(-1)?.occurred_at)
          : null
    };
  }

  async getWaiver(subject: string): Promise<Record<string, unknown> | null> {
    if (!(await verified(this.db))) return null;
    const row = await this.db
      .prepare(
        `SELECT id, hunter_subject, document_version, document_hash, action, accepted_at
         FROM legal_acceptance_events
         WHERE hunter_subject = ? AND document_type = 'participation_waiver'
         ORDER BY accepted_at DESC, id DESC LIMIT 1`
      )
      .bind(subject)
      .first<Row>();
    if (!row) return null;
    const participants = await this.db
      .prepare(
        `SELECT id, participant_role, full_name, birth_year, guardian_attested, created_at
         FROM waiver_acceptance_participants WHERE acceptance_event_id = ?
         ORDER BY participant_role, id`
      )
      .bind(value(row.id))
      .all<Row>();
    return {
      id: value(row.id),
      subject: value(row.hunter_subject),
      documentVersion: value(row.document_version),
      documentHash: value(row.document_hash),
      action: value(row.action),
      acceptedAt: value(row.accepted_at),
      participants: participants.results.map((participant) => ({
        id: value(participant.id),
        role: value(participant.participant_role),
        fullName: value(participant.full_name),
        birthYear: numberOrNull(participant.birth_year),
        guardianAttested: participant.guardian_attested === 1,
        createdAt: value(participant.created_at)
      }))
    };
  }
}
