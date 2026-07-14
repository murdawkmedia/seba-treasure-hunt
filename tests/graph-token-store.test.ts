import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import { D1GraphTokenStore } from "../src/server/graph-token-store";

const safeError = "Graph token state unavailable.";

const applySql = async (db: D1Database, sql: string) => {
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await db.prepare(statement).run();
  }
};

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function runtimeSecret(label: string): string {
  return `${label}.${crypto.randomUUID()}.${bytesToBase64(randomBytes(24))}`;
}

async function newDatabase(name: string): Promise<{ miniflare: Miniflare; db: D1Database }> {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: name }
  });
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  return { miniflare, db };
}

test("D1GraphTokenStore encrypts and rotates Graph refresh-token state in real D1", async (t) => {
  const { miniflare, db } = await newDatabase(`graph-token-${crypto.randomUUID()}`);
  t.after(() => miniflare.dispose());
  await db
    .prepare(
      `CREATE TABLE notification_delivery_events (
        id TEXT PRIMARY KEY
      )`
    )
    .run();
  const migration = await readFile(
    path.resolve("migrations", "0010_graph_transactional_email.sql"),
    "utf8"
  );
  await applySql(db, migration);

  const key = bytesToBase64(randomBytes(32));

  await t.test("an initial save stores no plaintext and load returns the exact state", async () => {
    const refreshToken = runtimeSecret("refresh");
    const conflictingToken = runtimeSecret("refresh");
    const store = new D1GraphTokenStore(db, key, "graph-key-v1");

    assert.equal(await store.load(), null);
    assert.equal(await store.save(null, refreshToken), true);
    assert.equal(await store.save(null, conflictingToken), false);
    const raw = await db
      .prepare(
        `SELECT provider, encrypted_refresh_token, nonce, key_version, state_version
         FROM oauth_provider_state WHERE provider = 'microsoft_graph'`
      )
      .first<Record<string, unknown>>();

    assert.ok(raw);
    assert.equal(JSON.stringify(raw).includes(refreshToken), false);
    assert.notEqual(raw.encrypted_refresh_token, refreshToken);
    assert.equal(JSON.stringify(raw).includes(conflictingToken), false);
    assert.deepEqual(await store.load(), { refreshToken, stateVersion: 1 });
  });

  await t.test("versioned saves use fresh 12-byte nonces and increment only on a match", async () => {
    await db.prepare("DELETE FROM oauth_provider_state").run();
    const store = new D1GraphTokenStore(db, key, "graph-key-v1");
    const firstToken = runtimeSecret("refresh");
    const secondToken = runtimeSecret("refresh");
    assert.equal(await store.save(null, firstToken), true);
    const first = await db
      .prepare("SELECT nonce FROM oauth_provider_state WHERE provider = 'microsoft_graph'")
      .first<{ nonce: string }>();

    assert.equal(await store.save(7, secondToken), false);
    assert.deepEqual(await store.load(), { refreshToken: firstToken, stateVersion: 1 });
    assert.equal(await store.save(1, secondToken), true);
    const second = await db
      .prepare("SELECT nonce, state_version FROM oauth_provider_state WHERE provider = 'microsoft_graph'")
      .first<{ nonce: string; state_version: number }>();

    assert.ok(first && second);
    assert.equal(base64ToBytes(first.nonce).byteLength, 12);
    assert.equal(base64ToBytes(second.nonce).byteLength, 12);
    assert.notEqual(second.nonce, first.nonce);
    assert.equal(second.state_version, 2);
    assert.deepEqual(await store.load(), { refreshToken: secondToken, stateVersion: 2 });
  });

  await t.test("two concurrent compare-and-swap writes have exactly one winner", async () => {
    await db.prepare("DELETE FROM oauth_provider_state").run();
    const store = new D1GraphTokenStore(db, key, "graph-key-v1");
    const initialToken = runtimeSecret("refresh");
    const contenderA = runtimeSecret("refresh");
    const contenderB = runtimeSecret("refresh");
    assert.equal(await store.save(null, initialToken), true);

    const outcomes = await Promise.all([
      store.save(1, contenderA),
      store.save(1, contenderB)
    ]);

    assert.equal(outcomes.filter(Boolean).length, 1);
    const loaded = await store.load();
    assert.ok(loaded);
    assert.equal(loaded.stateVersion, 2);
    assert.ok(loaded.refreshToken === contenderA || loaded.refreshToken === contenderB);
  });

  await t.test("wrong key and wrong configured key version fail closed with one safe error", async () => {
    const wrongKey = bytesToBase64(randomBytes(32));
    await assert.rejects(
      new D1GraphTokenStore(db, wrongKey, "graph-key-v1").load(),
      (error: unknown) => error instanceof Error && error.message === safeError
    );
    await assert.rejects(
      new D1GraphTokenStore(db, key, "graph-key-v2").load(),
      (error: unknown) => error instanceof Error && error.message === safeError
    );
  });

  await t.test("keys must be valid base64 that decodes to exactly 32 bytes", async () => {
    for (const invalidKey of [
      bytesToBase64(randomBytes(31)),
      bytesToBase64(randomBytes(33)),
      "not valid base64"
    ]) {
      const store = new D1GraphTokenStore(db, invalidKey, "graph-key-v1");
      await assert.rejects(
        store.load(),
        (error: unknown) => error instanceof Error && error.message === safeError
      );
    }
  });

  await t.test("missing database, key, version, or schema fails closed without sensitive detail", async () => {
    const refreshToken = runtimeSecret("refresh");
    const cases: Array<() => Promise<unknown>> = [
      () => new D1GraphTokenStore(null, key, "graph-key-v1").save(null, refreshToken),
      () => new D1GraphTokenStore(db, null, "graph-key-v1").save(null, refreshToken),
      () => new D1GraphTokenStore(db, key, null).save(null, refreshToken)
    ];

    const unconfigured = await newDatabase(`graph-token-missing-schema-${crypto.randomUUID()}`);
    t.after(() => unconfigured.miniflare.dispose());
    cases.push(() => new D1GraphTokenStore(unconfigured.db, key, "graph-key-v1").load());

    for (const operation of cases) {
      await assert.rejects(operation(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, safeError);
        const serialized = `${String(error)} ${JSON.stringify(error)}`;
        assert.equal(serialized.includes(refreshToken), false);
        assert.equal(serialized.includes(key), false);
        assert.doesNotMatch(serialized, /SQL|oauth_provider_state|no such table|AES|decrypt/i);
        return true;
      });
    }
  });

  await t.test("failures do not log or serialize plaintext refresh tokens", async () => {
    const refreshToken = runtimeSecret("refresh");
    await db.prepare("DELETE FROM oauth_provider_state").run();
    const store = new D1GraphTokenStore(db, key, "graph-key-v1");
    await store.save(null, refreshToken);
    const entries: unknown[][] = [];
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = (...args: unknown[]) => entries.push(args);
    console.warn = (...args: unknown[]) => entries.push(args);
    try {
      let caught: unknown;
      try {
        await new D1GraphTokenStore(db, bytesToBase64(randomBytes(32)), "graph-key-v1").load();
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error);
      assert.equal(caught.message, safeError);
      assert.equal(JSON.stringify(caught).includes(refreshToken), false);
      assert.equal(entries.flat().some((entry) => String(entry).includes(refreshToken)), false);
      assert.deepEqual(entries, []);
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }
  });
});
