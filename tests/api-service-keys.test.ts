import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import type {
  Principal,
  ServiceKeyCreateInput,
  ServiceKeyManager,
  ServiceKeyRecord,
  ServicePrincipal,
  ServiceIdempotencyInput,
  ServiceIdempotencyStart,
} from "../src/server/types";
import {
  FakeEnvironment,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson,
} from "./api-test-kit";

class FakeServiceKeys implements ServiceKeyManager {
  records: ServiceKeyRecord[] = [];
  principal: ServicePrincipal | null = null;
  idempotency = new Map<string, { input: ServiceIdempotencyInput; status?: number; body?: string }>();

  async authenticate(request: Request) {
    return request.headers.get("authorization") === "Bearer service-token" ? this.principal : null;
  }

  async list() {
    return this.records;
  }

  async create(input: ServiceKeyCreateInput, actorSubject: string) {
    const record: ServiceKeyRecord = {
      id: `key-${this.records.length + 1}`,
      name: input.name,
      environment: "validation",
      prefix: "tls_val_key-1_",
      scopes: input.scopes,
      status: "active",
      createdAt: "2026-08-05T18:00:00.000Z",
      createdBy: actorSubject,
      rotatedFromId: null,
      revokedAt: null,
      revokedBy: null,
      expiresAt: null,
      lastUsedAt: null,
    };
    this.records.push(record);
    return { record, plaintext: `tls_val_${record.id}_one-time-secret` };
  }

  async rotate(id: string, actorSubject: string) {
    const current = this.records.find((record) => record.id === id);
    if (!current) return null;
    const replacement = await this.create(
      { name: current.name, scopes: current.scopes, expiresAt: current.expiresAt },
      actorSubject
    );
    replacement.record.rotatedFromId = id;
    return replacement;
  }

  async revoke(id: string, actorSubject: string) {
    const current = this.records.find((record) => record.id === id);
    if (!current) return null;
    current.status = "revoked";
    current.revokedAt = "2026-08-05T18:01:00.000Z";
    current.revokedBy = actorSubject;
    return current;
  }

  async beginIdempotentRequest(input: ServiceIdempotencyInput): Promise<ServiceIdempotencyStart> {
    const key = `${input.keyId}:${input.idempotencyKey}`;
    const current = this.idempotency.get(key);
    if (!current) {
      this.idempotency.set(key, { input });
      return { state: "started" };
    }
    if (
      current.input.method !== input.method ||
      current.input.path !== input.path ||
      current.input.requestHash !== input.requestHash
    ) return { state: "conflict" };
    if (current.status === undefined || current.body === undefined) return { state: "in_progress" };
    return { state: "replay", status: current.status, body: current.body };
  }

  async completeIdempotentRequest(
    input: ServiceIdempotencyInput,
    response: { status: number; body: string }
  ) {
    this.idempotency.set(`${input.keyId}:${input.idempotencyKey}`, { input, ...response });
  }

  async cancelIdempotentRequest(input: ServiceIdempotencyInput) {
    this.idempotency.delete(`${input.keyId}:${input.idempotencyKey}`);
  }
}

const identityFor = (email: string) => ({
  async authenticateHunter() {
    return null;
  },
  async authenticateStaff(request: Request): Promise<Principal | null> {
    return request.headers.get("authorization") === "Bearer staff-token"
      ? { kind: "staff", subject: `staff:${email}`, email }
      : null;
  },
});

const makeApp = (email: string) => {
  const store = new FakeStore();
  store.staff.add(`staff:${email}`);
  const serviceKeys = new FakeServiceKeys();
  return {
    app: createApi({
      store,
      identity: identityFor(email),
      turnstile: new FakeTurnstile(),
      uploads: new FakeUploads(),
      rateLimits: new FakeRateLimits(),
      environment: new FakeEnvironment(),
      serviceKeys,
      apiKeyAdminEmails: ["murphy@sebahub.com", "tech@sebahub.com"],
      config: {
        deploymentEnvironment: "validation",
        turnstileSiteKey: null,
        hunterPublishableKey: null,
        hunterAccountPortalUrl: null,
        staffPublishableKey: null,
        staffAccountPortalUrl: null,
      },
    }),
    serviceKeys,
  };
};

const endpoint = "https://www.timlostsomething.com/api/v1/ops/api-keys";
const staffHeaders = {
  authorization: "Bearer staff-token",
  origin: "https://www.timlostsomething.com",
};

test("service-key administration is limited to the two configured human administrators", async () => {
  const ordinary = makeApp("casey@sebahub.com").app;
  const forbidden = await ordinary.request(endpoint, { headers: staffHeaders });
  assert.equal(forbidden.status, 403);
  assert.equal((await responseJson(forbidden)).error.code, "api_key_admin_required");

  const murphy = makeApp("Murphy@SebaHub.com").app;
  const allowed = await murphy.request(endpoint, { headers: staffHeaders });
  assert.equal(allowed.status, 200);
});

test("creates a scoped key with one-time plaintext and lists metadata without the secret", async () => {
  const { app } = makeApp("tech@sebahub.com");
  const created = await app.request(endpoint, {
    method: "POST",
    ...json(
      { name: "SebaHub Console read", scopes: ["case.read", "people.read"] },
      staffHeaders
    ),
  });
  const createdBody = await responseJson(created);
  assert.equal(created.status, 201);
  assert.match(createdBody.data.secret, /^tls_val_/);
  assert.deepEqual(createdBody.data.key.scopes, ["case.read", "people.read"]);

  const listed = await app.request(endpoint, { headers: staffHeaders });
  const listedBody = await responseJson(listed);
  assert.equal(listed.status, 200);
  assert.equal(listedBody.data.length, 1);
  assert.equal("secret" in listedBody.data[0], false);
  assert.equal(JSON.stringify(listedBody).includes("one-time-secret"), false);
});

test("rotation reveals a replacement once and revocation is immediate", async () => {
  const { app } = makeApp("murphy@sebahub.com");
  await app.request(endpoint, {
    method: "POST",
    ...json({ name: "Operations", scopes: ["case.read", "case.write"] }, staffHeaders),
  });

  const rotated = await app.request(`${endpoint}/key-1/rotate`, {
    method: "POST",
    ...json({ confirmed: true }, staffHeaders),
  });
  const rotatedBody = await responseJson(rotated);
  assert.equal(rotated.status, 201);
  assert.match(rotatedBody.data.secret, /^tls_val_/);
  assert.equal(rotatedBody.data.key.rotatedFromId, "key-1");

  const revoked = await app.request(`${endpoint}/key-1/revoke`, {
    method: "POST",
    ...json({ confirmed: true }, staffHeaders),
  });
  assert.equal(revoked.status, 200);
  assert.equal((await responseJson(revoked)).data.status, "revoked");
});

test("service sessions expose capabilities and enforce route scopes", async () => {
  const { app, serviceKeys } = makeApp("tech@sebahub.com");
  serviceKeys.principal = {
    kind: "service",
    subject: "service:key-read",
    email: null,
    keyId: "key-read",
    name: "Console read",
    environment: "validation",
    scopes: ["case.read"],
  };
  const headers = { authorization: "Bearer service-token" };

  const session = await app.request(
    "https://www.timlostsomething.com/api/v1/service/session",
    { headers }
  );
  assert.equal(session.status, 200);
  assert.deepEqual((await responseJson(session)).data.scopes, ["case.read"]);

  const items = await app.request("https://www.timlostsomething.com/api/v1/ops/items", { headers });
  assert.equal(items.status, 200);

  const reports = await app.request("https://www.timlostsomething.com/api/v1/ops/reports", { headers });
  assert.equal(reports.status, 403);
  assert.equal((await responseJson(reports)).error.code, "service_scope_required");

  const createItem = await app.request("https://www.timlostsomething.com/api/v1/ops/items", {
    method: "POST",
    ...json({}, headers),
  });
  assert.equal(createItem.status, 403);
});

test("service keys can never access service-key or account-security administration", async () => {
  const { app, serviceKeys } = makeApp("murphy@sebahub.com");
  serviceKeys.principal = {
    kind: "service",
    subject: "service:key-all",
    email: null,
    keyId: "key-all",
    name: "Operations",
    environment: "validation",
    scopes: [
      "case.read", "case.write", "reports.read", "reports.write", "media.read", "media.write",
      "publishing.read", "publishing.write", "moderation.read", "moderation.write",
      "inquiries.read", "inquiries.write", "people.read", "legal.read", "staff.read", "audit.read",
    ],
  };
  const headers = { authorization: "Bearer service-token" };
  for (const [method, url] of [
    ["GET", endpoint],
    ["POST", "https://www.timlostsomething.com/api/v1/ops/staff/staff-1/revoke-sessions"],
    ["POST", "https://www.timlostsomething.com/api/v1/ops/players/hunter-1/revoke-sessions"],
  ] as const) {
    const response = await app.request(
      url,
      method === "GET" ? { method, headers } : { method, ...json({ confirmed: true }, headers) }
    );
    assert.equal(response.status, 403, `${method} ${url}`);
    assert.equal((await responseJson(response)).error.code, "service_route_forbidden");
  }
});

test("service mutations require explicit confirmation and replay one completed idempotent result", async () => {
  const { app, serviceKeys } = makeApp("tech@sebahub.com");
  serviceKeys.principal = {
    kind: "service",
    subject: "service:key-write",
    email: null,
    keyId: "key-write",
    name: "Operations",
    environment: "validation",
    scopes: ["case.write"],
  };
  const url = "https://www.timlostsomething.com/api/v1/ops/status";
  const baseHeaders = {
    authorization: "Bearer service-token",
    origin: "https://www.timlostsomething.com",
  };
  const body = { state: "paused", version: 1 };

  const missingConfirmation = await app.request(url, {
    method: "PUT",
    ...json(body, { ...baseHeaders, "idempotency-key": "pause-case-1" }),
  });
  assert.equal(missingConfirmation.status, 422);
  assert.equal((await responseJson(missingConfirmation)).error.code, "service_confirmation_required");

  const missingKey = await app.request(url, {
    method: "PUT",
    ...json(body, { ...baseHeaders, "x-tim-confirm": "true" }),
  });
  assert.equal(missingKey.status, 422);
  assert.equal((await responseJson(missingKey)).error.code, "idempotency_key_required");

  const headers = {
    ...baseHeaders,
    "x-tim-confirm": "true",
    "idempotency-key": "pause-case-1",
  };
  const first = await app.request(url, { method: "PUT", ...json(body, headers) });
  assert.equal(first.status, 200);
  const firstBody = await first.text();

  const replay = await app.request(url, { method: "PUT", ...json(body, headers) });
  assert.equal(replay.status, 200);
  assert.equal(await replay.text(), firstBody);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");

  const conflict = await app.request(url, {
    method: "PUT",
    ...json({ state: "open", version: 2 }, headers),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await responseJson(conflict)).error.code, "idempotency_conflict");
});

test("service mutation fingerprinting rejects an oversized declared body before buffering it", async () => {
  const { app, serviceKeys } = makeApp("tech@sebahub.com");
  serviceKeys.principal = {
    kind: "service",
    subject: "service:key-write",
    email: null,
    keyId: "key-write",
    name: "Operations",
    environment: "validation",
    scopes: ["case.write"],
  };
  const response = await app.request("https://www.timlostsomething.com/api/v1/ops/items", {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      origin: "https://www.timlostsomething.com",
      "content-type": "application/json",
      "content-length": String(64 * 1024 + 1),
      "x-tim-confirm": "true",
      "idempotency-key": "oversized-item-request-001",
    },
    body: "{}",
  });
  assert.equal(response.status, 413);
  assert.equal((await responseJson(response)).error.code, "request_too_large");
  assert.equal(serviceKeys.idempotency.size, 0);
});
