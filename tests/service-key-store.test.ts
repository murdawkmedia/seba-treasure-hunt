import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { D1ServiceKeyManager } from "../src/server/service-key-store";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const applySql = async (db: D1Database, sql: string) => {
  const statements: string[] = [];
  let statement = "";
  let inTrigger = false;
  for (const line of sql.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!statement && !trimmed) continue;
    statement += `${line}\n`;
    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) inTrigger = true;
    if ((inTrigger && /^END;$/i.test(trimmed)) || (!inTrigger && /;$/i.test(trimmed))) {
      statements.push(statement.trim());
      statement = "";
      inTrigger = false;
    }
  }
  assert.equal(statement.trim(), "");
  for (const sqlStatement of statements) await db.prepare(sqlStatement).run();
};

const setup = async (t: test.TestContext) => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `service-keys-${crypto.randomUUID()}` },
  });
  t.after(() => miniflare.dispose());
  const db = await miniflare.getD1Database("DB");
  await applySql(
    db,
    await readFile(path.join(root, "migrations", "0023_service_api_keys.sql"), "utf8")
  );
  return new D1ServiceKeyManager(db, "validation", "test-pepper");
};

test("D1 service keys authenticate only in their environment and stop immediately after revoke", async (t) => {
  const manager = await setup(t);
  const created = await manager.create(
    { name: "Console", scopes: ["case.read", "people.read"] },
    "staff:tech"
  );

  const principal = await manager.authenticate(
    new Request("https://example.test", {
      headers: { authorization: `Bearer ${created.plaintext}` },
    })
  );
  assert.equal(principal?.keyId, created.record.id);
  assert.deepEqual(principal?.scopes, ["case.read", "people.read"]);

  await manager.revoke(created.record.id, "staff:murphy");
  assert.equal(
    await manager.authenticate(
      new Request("https://example.test", {
        headers: { authorization: `Bearer ${created.plaintext}` },
      })
    ),
    null
  );
});

test("rotation preserves scopes, permits overlap, and never lists plaintext", async (t) => {
  const manager = await setup(t);
  const original = await manager.create(
    { name: "Operations", scopes: ["case.read", "case.write"] },
    "staff:murphy"
  );
  const rotated = await manager.rotate(original.record.id, "staff:tech");

  assert.ok(rotated);
  assert.notEqual(rotated.plaintext, original.plaintext);
  assert.equal(rotated.record.rotatedFromId, original.record.id);
  assert.deepEqual(rotated.record.scopes, original.record.scopes);
  const listed = await manager.list();
  assert.equal(listed.length, 2);
  assert.equal(listed.find((key) => key.id === original.record.id)?.status, "active");
  assert.equal(JSON.stringify(listed).includes(original.plaintext), false);
  assert.equal(JSON.stringify(listed).includes(rotated.plaintext), false);
});

test("the service-key event ledger is append-only", async (t) => {
  const manager = await setup(t);
  await manager.create({ name: "Audit", scopes: ["audit.read"] }, "staff:tech");
  const db = (manager as unknown as { db: D1Database }).db;
  const event = await db.prepare("SELECT id FROM service_key_events LIMIT 1").first<{ id: string }>();
  assert.ok(event?.id);
  await assert.rejects(
    () => db.prepare("DELETE FROM service_key_events WHERE id = ?").bind(event!.id).run(),
    /append-only/i
  );
});

test("D1 idempotency claims replay completed responses and reject key reuse with another payload", async (t) => {
  const manager = await setup(t);
  const created = await manager.create({ name: "Writer", scopes: ["case.write"] }, "staff:tech");
  const input = {
    keyId: created.record.id,
    idempotencyKey: "status-change-001",
    method: "PUT",
    path: "/api/v1/ops/status",
    requestHash: "a".repeat(64),
  };

  assert.deepEqual(await manager.beginIdempotentRequest(input), { state: "started" });
  assert.deepEqual(await manager.beginIdempotentRequest(input), { state: "in_progress" });
  await manager.completeIdempotentRequest(input, { status: 200, body: '{"data":{"state":"paused"}}' });
  assert.deepEqual(await manager.beginIdempotentRequest(input), {
    state: "replay",
    status: 200,
    body: '{"data":{"state":"paused"}}',
  });
  assert.deepEqual(
    await manager.beginIdempotentRequest({ ...input, requestHash: "b".repeat(64) }),
    { state: "conflict" }
  );
});
