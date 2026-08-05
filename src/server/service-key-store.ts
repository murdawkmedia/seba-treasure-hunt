import { ApiError } from "./errors";
import {
  SERVICE_KEY_SCOPES,
  createServiceKeyMaterial,
  hashServiceKey,
  parseServiceKey,
} from "./service-keys";
import type {
  DeploymentEnvironment,
  ServiceKeyCreateInput,
  ServiceKeyManager,
  ServiceKeyRecord,
  ServiceKeyScope,
  ServicePrincipal,
  ServiceIdempotencyInput,
  ServiceIdempotencyStart,
} from "./types";

interface ServiceKeyRow {
  id: string;
  name: string;
  environment: DeploymentEnvironment;
  key_prefix: string;
  secret_hash: string;
  scopes_json: string;
  status: "active" | "revoked";
  created_at: string;
  created_by: string;
  rotated_from_id: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

const allowedScopes = new Set<ServiceKeyScope>(SERVICE_KEY_SCOPES);

const parseScopes = (value: string): ServiceKeyScope[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiError(503, "service_key_corrupt", "Service-key configuration is invalid.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.some((scope) => typeof scope !== "string" || !allowedScopes.has(scope as ServiceKeyScope))
  ) {
    throw new ApiError(503, "service_key_corrupt", "Service-key configuration is invalid.");
  }
  return parsed as ServiceKeyScope[];
};

const recordFromRow = (row: ServiceKeyRow): ServiceKeyRecord => ({
  id: row.id,
  name: row.name,
  environment: row.environment,
  prefix: row.key_prefix,
  scopes: parseScopes(row.scopes_json),
  status: row.status,
  createdAt: row.created_at,
  createdBy: row.created_by,
  rotatedFromId: row.rotated_from_id,
  revokedAt: row.revoked_at,
  revokedBy: row.revoked_by,
  expiresAt: row.expires_at,
  lastUsedAt: row.last_used_at,
});

const constantTimeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
};

export class D1ServiceKeyManager implements ServiceKeyManager {
  constructor(
    public readonly db: D1Database | null,
    private readonly environment: DeploymentEnvironment | null,
    private readonly pepper: string | null
  ) {}

  private configured(): { db: D1Database; environment: DeploymentEnvironment; pepper: string } {
    if (!this.db || !this.environment || !this.pepper?.trim()) {
      throw new ApiError(503, "service_key_unavailable", "Service-key management is not configured.");
    }
    return { db: this.db, environment: this.environment, pepper: this.pepper };
  }

  private validateInput(input: ServiceKeyCreateInput) {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 100) {
      throw new ApiError(422, "validation_failed", "Key name must be between 3 and 100 characters.");
    }
    if (
      input.scopes.length < 1 ||
      input.scopes.length > allowedScopes.size ||
      new Set(input.scopes).size !== input.scopes.length ||
      input.scopes.some((scope) => !allowedScopes.has(scope))
    ) {
      throw new ApiError(422, "validation_failed", "Choose unique, supported service-key scopes.");
    }
    const expiresAt = input.expiresAt ?? null;
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      throw new ApiError(422, "validation_failed", "Key expiry must be a future date and time.");
    }
    return { name, scopes: [...input.scopes].sort() as ServiceKeyScope[], expiresAt };
  }

  async authenticate(request: Request): Promise<ServicePrincipal | null> {
    if (!this.db || !this.environment || !this.pepper?.trim()) return null;
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return null;
    const plaintext = authorization.slice(7);
    const parsed = parseServiceKey(plaintext, this.environment);
    if (!parsed) return null;
    const row = await this.db
      .prepare(
        `SELECT id, name, environment, key_prefix, secret_hash, scopes_json, status,
                created_at, created_by, rotated_from_id, revoked_at, revoked_by, expires_at, last_used_at
           FROM service_keys
          WHERE id = ? AND environment = ? AND status = 'active'`
      )
      .bind(parsed.id, this.environment)
      .first<ServiceKeyRow>();
    if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
    const candidateHash = await hashServiceKey(plaintext, this.pepper);
    if (!constantTimeEqual(candidateHash, row.secret_hash)) return null;
    const usedAt = new Date().toISOString();
    await this.db.prepare("UPDATE service_keys SET last_used_at = ? WHERE id = ? AND status = 'active'")
      .bind(usedAt, row.id)
      .run();
    return {
      kind: "service",
      subject: `service:${row.id}`,
      email: null,
      keyId: row.id,
      name: row.name,
      environment: row.environment,
      scopes: parseScopes(row.scopes_json),
    };
  }

  async list() {
    const { db, environment } = this.configured();
    const result = await db
      .prepare(
        `SELECT id, name, environment, key_prefix, secret_hash, scopes_json, status,
                created_at, created_by, rotated_from_id, revoked_at, revoked_by, expires_at, last_used_at
           FROM service_keys WHERE environment = ? ORDER BY created_at DESC, id DESC`
      )
      .bind(environment)
      .all<ServiceKeyRow>();
    return result.results.map(recordFromRow);
  }

  async create(input: ServiceKeyCreateInput, actorSubject: string) {
    const { db, environment, pepper } = this.configured();
    const normalized = this.validateInput(input);
    const material = await createServiceKeyMaterial({ environment, pepper });
    const createdAt = new Date().toISOString();
    const rotatedFromId = input.rotatedFromId ?? null;
    await db.batch([
      db.prepare(
        `INSERT INTO service_keys
         (id, name, environment, key_prefix, secret_hash, scopes_json, status,
          created_at, created_by, rotated_from_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
      ).bind(
        material.record.id,
        normalized.name,
        environment,
        material.record.prefix,
        material.record.hash,
        JSON.stringify(normalized.scopes),
        createdAt,
        actorSubject,
        rotatedFromId,
        normalized.expiresAt
      ),
      db.prepare(
        `INSERT INTO service_key_events
         (id, key_id, actor_subject, action, metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        material.record.id,
        actorSubject,
        rotatedFromId ? "rotated" : "created",
        JSON.stringify({ rotatedFromId, scopes: normalized.scopes }),
        createdAt
      ),
    ]);
    const row = await this.getRow(material.record.id);
    if (!row) throw new ApiError(503, "service_key_write_failed", "The service key could not be stored.");
    return { record: recordFromRow(row), plaintext: material.plaintext };
  }

  async rotate(id: string, actorSubject: string) {
    const current = await this.getRow(id);
    if (!current || current.environment !== this.environment || current.status !== "active") return null;
    return this.create(
      {
        name: current.name,
        scopes: parseScopes(current.scopes_json),
        expiresAt: current.expires_at,
        rotatedFromId: current.id,
      },
      actorSubject
    );
  }

  async revoke(id: string, actorSubject: string) {
    const { db, environment } = this.configured();
    const current = await this.getRow(id);
    if (!current || current.environment !== environment) return null;
    if (current.status === "revoked") return recordFromRow(current);
    const revokedAt = new Date().toISOString();
    const results = await db.batch([
      db.prepare(
        `UPDATE service_keys
            SET status = 'revoked', revoked_at = ?, revoked_by = ?
          WHERE id = ? AND environment = ? AND status = 'active'`
      ).bind(revokedAt, actorSubject, id, environment),
      db.prepare(
        `INSERT INTO service_key_events
         (id, key_id, actor_subject, action, metadata_json, occurred_at)
         VALUES (?, ?, ?, 'revoked', '{}', ?)`
      ).bind(crypto.randomUUID(), id, actorSubject, revokedAt),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, "service_key_conflict", "The service key changed. Refresh and try again.");
    }
    const row = await this.getRow(id);
    return row ? recordFromRow(row) : null;
  }

  async beginIdempotentRequest(input: ServiceIdempotencyInput): Promise<ServiceIdempotencyStart> {
    const { db } = this.configured();
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const results = await db.batch([
      db.prepare(
        `DELETE FROM service_api_idempotency
          WHERE key_id = ? AND idempotency_key = ? AND expires_at <= ?`
      ).bind(input.keyId, input.idempotencyKey, createdAt),
      db.prepare(
        `INSERT OR IGNORE INTO service_api_idempotency
         (key_id, idempotency_key, method, path, request_hash, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(
        input.keyId,
        input.idempotencyKey,
        input.method,
        input.path,
        input.requestHash,
        createdAt,
        expiresAt
      ),
    ]);
    if ((results[1]?.meta.changes ?? 0) === 1) return { state: "started" };
    const current = await db.prepare(
      `SELECT method, path, request_hash, state, response_status, response_json
         FROM service_api_idempotency WHERE key_id = ? AND idempotency_key = ?`
    ).bind(input.keyId, input.idempotencyKey).first<{
      method: string;
      path: string;
      request_hash: string;
      state: "pending" | "completed";
      response_status: number | null;
      response_json: string | null;
    }>();
    if (!current) return { state: "in_progress" };
    if (
      current.method !== input.method ||
      current.path !== input.path ||
      current.request_hash !== input.requestHash
    ) return { state: "conflict" };
    if (current.state !== "completed" || current.response_status === null || current.response_json === null) {
      return { state: "in_progress" };
    }
    return { state: "replay", status: current.response_status, body: current.response_json };
  }

  async completeIdempotentRequest(
    input: ServiceIdempotencyInput,
    response: { status: number; body: string }
  ) {
    const { db } = this.configured();
    const result = await db.prepare(
      `UPDATE service_api_idempotency
          SET state = 'completed', response_status = ?, response_json = ?
        WHERE key_id = ? AND idempotency_key = ? AND method = ? AND path = ?
          AND request_hash = ? AND state = 'pending'`
    ).bind(
      response.status,
      response.body,
      input.keyId,
      input.idempotencyKey,
      input.method,
      input.path,
      input.requestHash
    ).run();
    if ((result.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, "idempotency_conflict", "The idempotency record changed. Use a new key.");
    }
  }

  async cancelIdempotentRequest(input: ServiceIdempotencyInput) {
    const { db } = this.configured();
    await db.prepare(
      `DELETE FROM service_api_idempotency
        WHERE key_id = ? AND idempotency_key = ? AND method = ? AND path = ?
          AND request_hash = ? AND state = 'pending'`
    ).bind(
      input.keyId,
      input.idempotencyKey,
      input.method,
      input.path,
      input.requestHash
    ).run();
  }

  private async getRow(id: string) {
    if (!this.db) return null;
    return this.db
      .prepare(
        `SELECT id, name, environment, key_prefix, secret_hash, scopes_json, status,
                created_at, created_by, rotated_from_id, revoked_at, revoked_by, expires_at, last_used_at
           FROM service_keys WHERE id = ?`
      )
      .bind(id)
      .first<ServiceKeyRow>();
  }
}
