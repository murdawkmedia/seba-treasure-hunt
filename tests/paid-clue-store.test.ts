import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { D1DataStore } from "../src/server/d1-store";

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
      statements.push(statement.trim()); statement = ""; inTrigger = false;
    }
  }
  assert.equal(statement.trim(), "");
  for (const sqlStatement of statements) await db.prepare(sqlStatement).run();
};

const fixture = async (t: test.TestContext) => {
  const worker = new Miniflare({
    modules: true,
    script: "export default { async fetch() { return new Response('ok'); } };",
    d1Databases: { DB: `paid-clue-store-${crypto.randomUUID()}` }
  });
  t.after(() => worker.dispose());
  const db = await worker.getD1Database("DB");
  for (const file of (await readdir(path.join(root, "migrations"))).sort()) {
    await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));
  }
  await db.batch([
    db.prepare(`INSERT INTO player_accounts
      (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
      VALUES ('player-1', 'player-1@example.test', 'active', 't', 't', 't')`),
    db.prepare(`INSERT INTO player_accounts
      (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
      VALUES ('player-2', 'player-2@example.test', 'active', 't', 't', 't')`),
    db.prepare(`INSERT INTO clues
      (id, sequence, title, riddle, decoder_explanation, narrowing_summary,
       internal_numeric_score, state, decoder_mode, version, created_at, updated_at)
      VALUES ('clue-01', 1, 'One', 'Riddle', 'Decoder', 'Narrowing', 50,
              'ready', 'paid', 1, 't', 't')`)
  ]);
  return { db, store: new D1DataStore(db) };
};

test("clue release, event, and audit roll back together when the ledger insert fails", async (t) => {
  const { db, store } = await fixture(t);
  await db.prepare(`CREATE TRIGGER force_release_event_failure BEFORE INSERT ON clue_events
    WHEN NEW.action = 'released' BEGIN SELECT RAISE(ABORT, 'forced release event failure'); END;`).run();
  await assert.rejects(() => store.releasePaidClue("clue-01", 1, "staff-1"), /forced release event failure/);
  assert.deepEqual(await db.prepare("SELECT state, version FROM clues WHERE id = 'clue-01'").first(), { state: "ready", version: 1 });
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'clue.released'").first<any>())?.count, 0);
  await db.prepare("DROP TRIGGER force_release_event_failure").run();
  await db.prepare(`CREATE TRIGGER force_edit_event_failure BEFORE INSERT ON clue_events
    WHEN NEW.action = 'edited' BEGIN SELECT RAISE(ABORT, 'forced edit event failure'); END;`).run();
  await assert.rejects(
    () => store.updatePaidClue("clue-01", { expectedVersion: 1, title: "Changed" }, "staff-1"),
    /forced edit event failure/
  );
  assert.deepEqual(await db.prepare("SELECT title, version FROM clues WHERE id = 'clue-01'").first(), { title: "One", version: 1 });
  await db.prepare("DROP TRIGGER force_edit_event_failure").run();
  const released = await store.releasePaidClue("clue-01", 1, "staff-1");
  assert.equal(released?.state, "released");
  await db.prepare(`CREATE TRIGGER force_retract_event_failure BEFORE INSERT ON clue_events
    WHEN NEW.action = 'retracted' BEGIN SELECT RAISE(ABORT, 'forced retract event failure'); END;`).run();
  await assert.rejects(() => store.retractPaidClue("clue-01", 2, "Safety review", "staff-1"), /forced retract event failure/);
  assert.deepEqual(await db.prepare("SELECT state, version FROM clues WHERE id = 'clue-01'").first(), { state: "released", version: 2 });
});

test("claim, event, and audit roll back together and event JSON excludes payment PII", async (t) => {
  const { db, store } = await fixture(t);
  await db.prepare("UPDATE clues SET state = 'released', released_at = 't' WHERE id = 'clue-01'").run();
  const created = await store.createOrReuseClueOrder("player-1", "clue-01");
  await db.prepare(`CREATE TRIGGER force_claim_event_failure BEFORE INSERT ON clue_order_events
    WHEN NEW.action = 'claimed' BEGIN SELECT RAISE(ABORT, 'forced claim event failure'); END;`).run();
  await assert.rejects(() => store.claimClueOrder("player-1", created.order.id, "Private Sender", 1), /forced claim event failure/);
  assert.deepEqual(
    await db.prepare("SELECT sender_name, status, version FROM clue_orders WHERE id = ?").bind(created.order.id).first(),
    { sender_name: null, status: "created", version: 1 }
  );
  await db.prepare("DROP TRIGGER force_claim_event_failure").run();
  const claimed = await store.claimClueOrder("player-1", created.order.id, "Private Sender", 1);
  assert.ok(claimed);
  await store.decideClueOrder(created.order.id, { expectedVersion: 2, status: "rejected", decisionNote: "Private decision reason" }, "staff-1");
  const details = (await db.prepare("SELECT details_json FROM clue_order_events WHERE order_id = ? ORDER BY rowid").bind(created.order.id).all<any>()).results;
  assert.equal(JSON.stringify(details).includes("Private Sender"), false);
  assert.equal(JSON.stringify(details).includes("Private decision reason"), false);
  await db.prepare(`CREATE TRIGGER force_decision_event_failure BEFORE INSERT ON clue_order_events
    WHEN NEW.action = 'reopened' BEGIN SELECT RAISE(ABORT, 'forced decision event failure'); END;`).run();
  await assert.rejects(
    () => store.decideClueOrder(created.order.id, { expectedVersion: 3, status: "created" }, "staff-1"),
    /forced decision event failure/
  );
  assert.deepEqual(
    await db.prepare("SELECT status, version FROM clue_orders WHERE id = ?").bind(created.order.id).first(),
    { status: "rejected", version: 3 }
  );
});

test("simultaneous order creation converges on one active order", async (t) => {
  const { db, store } = await fixture(t);
  await db.prepare("UPDATE clues SET state = 'released', released_at = 't' WHERE id = 'clue-01'").run();
  const [left, right] = await Promise.all([
    store.createOrReuseClueOrder("player-1", "clue-01"),
    store.createOrReuseClueOrder("player-1", "clue-01")
  ]);
  assert.equal(left.order.id, right.order.id);
  assert.equal([left.reused, right.reused].filter(Boolean).length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM clue_orders").first<any>())?.count, 1);
});

test("same-clock concurrent clue edits create exactly one event and audit", async (t) => {
  const { db } = await fixture(t);
  const fixedNow = "2026-08-07T20:00:00.000Z";
  const store = new D1DataStore(db, { now: () => fixedNow });
  const results = await Promise.allSettled([
    store.updatePaidClue("clue-01", { expectedVersion: 1, title: "Left" }, "staff-left"),
    store.updatePaidClue("clue-01", { expectedVersion: 1, title: "Right" }, "staff-right")
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM clue_events WHERE clue_id = 'clue-01' AND action = 'edited'").first<any>())?.count, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'clue-01' AND action = 'clue.edited'").first<any>())?.count, 1);
});

test("same-clock concurrent claims create exactly one event and audit", async (t) => {
  const { db } = await fixture(t);
  await db.prepare("UPDATE clues SET state = 'released', released_at = 't' WHERE id = 'clue-01'").run();
  const fixedNow = "2026-08-07T20:00:00.000Z";
  const store = new D1DataStore(db, { now: () => fixedNow });
  const created = await store.createOrReuseClueOrder("player-1", "clue-01");
  const results = await Promise.allSettled([
    store.claimClueOrder("player-1", created.order.id, "Left Sender", 1),
    store.claimClueOrder("player-1", created.order.id, "Right Sender", 1)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM clue_order_events WHERE order_id = ? AND action = 'claimed'").bind(created.order.id).first<any>())?.count, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = ? AND action = 'clue_order.claimed'").bind(created.order.id).first<any>())?.count, 1);
});

test("same-clock concurrent releases create exactly one event and audit", async (t) => {
  const { db } = await fixture(t);
  const fixedNow = "2026-08-07T20:00:00.000Z";
  const store = new D1DataStore(db, { now: () => fixedNow });
  const results = await Promise.allSettled([
    store.releasePaidClue("clue-01", 1, "staff-left"),
    store.releasePaidClue("clue-01", 1, "staff-right")
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM clue_events WHERE clue_id = 'clue-01' AND action = 'released'").first<any>())?.count, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE target_id = 'clue-01' AND action = 'clue.released'").first<any>())?.count, 1);
});

test("reference collisions retry without leaking or duplicating an order", async (t) => {
  const { db } = await fixture(t);
  await db.prepare("UPDATE clues SET state = 'released', released_at = 't' WHERE id = 'clue-01'").run();
  await db.prepare(`INSERT INTO clue_orders
    (id, clue_id, player_subject, reference, status, decided_by, decided_at, created_at, updated_at, version)
    VALUES ('old-order', 'clue-01', 'player-1', 'TLS-C01-K4M2', 'cancelled', 'staff-1', 't', 't', 't', 1)`).run();
  const tokens = ["K4M2", "Z9Q8"];
  const store = new D1DataStore(db, { clueOrderReferenceToken: () => tokens.shift() ?? "LAST" });
  await db.prepare(`CREATE TRIGGER force_create_event_failure BEFORE INSERT ON clue_order_events
    WHEN NEW.action = 'created' BEGIN SELECT RAISE(ABORT, 'forced create event failure'); END;`).run();
  await assert.rejects(() => store.createOrReuseClueOrder("player-2", "clue-01"), /forced create event failure/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM clue_orders WHERE player_subject = 'player-2'").first<any>())?.count, 0);
  await db.prepare("DROP TRIGGER force_create_event_failure").run();
  tokens.unshift("K4M2", "Z9Q8");
  const created = await store.createOrReuseClueOrder("player-2", "clue-01");
  assert.equal(created.order.reference, "TLS-C01-Z9Q8");
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM clue_orders WHERE player_subject = 'player-2'").first<any>())?.count, 1);
});

test("Ops order pages use stable cursors and aggregate all statuses in SQL", async (t) => {
  const { db, store } = await fixture(t);
  await db.prepare("UPDATE clues SET state = 'released', released_at = 't' WHERE id = 'clue-01'").run();
  const first = await store.createOrReuseClueOrder("player-1", "clue-01");
  await store.decideClueOrder(first.order.id, { expectedVersion: 1, status: "cancelled" }, "staff-1");
  await store.createOrReuseClueOrder("player-2", "clue-01");
  const page = await store.listOpsClueOrders({ limit: 1 });
  assert.deepEqual({ created: page.counts.created, cancelled: page.counts.cancelled }, { created: 1, cancelled: 1 });
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  const next = await store.listOpsClueOrders({ limit: 1, cursor: page.nextCursor });
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0]?.id, page.items[0]?.id);
});
