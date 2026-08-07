import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

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

  assert.equal(statement.trim(), "", "migration script ends with a complete SQL statement");
  for (const sqlStatement of statements) await db.prepare(sqlStatement).run();
};

const expectReject = async (statement: D1PreparedStatement) => {
  await assert.rejects(() => statement.run());
};

const insertClue = (db: D1Database, id: string, sequence: number, overrides = "") =>
  db.prepare(
    `INSERT INTO clues
     (id, sequence, title, riddle, decoder_explanation, narrowing_summary,
      internal_numeric_score, state, decoder_mode, version, created_at, updated_at)
     VALUES (?, ?, 'Private title', 'Private riddle', 'Private explanation', 'Private summary',
      50, 'ready', 'paid', 1, '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z') ${overrides}`
  ).bind(id, sequence);

test("the complete D1 migration chain enforces paid clue order and audit-ledger behavior", async (t) => {
  const worker = new Miniflare({
    modules: true,
    script: "export default { async fetch() { return new Response('ok'); } };",
    d1Databases: { DB: `paid-clue-schema-${crypto.randomUUID()}` },
  });
  t.after(() => worker.dispose());

  const db = await worker.getD1Database("DB");
  for (const file of (await readdir(path.join(root, "migrations"))).sort()) {
    await applySql(db, await readFile(path.join(root, "migrations", file), "utf8"));
  }

  await insertClue(db, "clue-07", 7).run();
  await insertClue(db, "clue-08", 8).run();
  await insertClue(db, "clue-09", 9).run();
  await insertClue(db, "clue-10", 10).run();
  await db.prepare(
    `UPDATE clues SET state = 'retired', retired_at = '2026-08-07T00:00:00.000Z' WHERE id = 'clue-09'`
  ).run();
  await db.prepare(
    `INSERT INTO player_accounts
     (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
     VALUES ('player-1', 'player-1@example.test', 'active', '2026-08-07T00:00:00.000Z',
             '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z')`
  ).run();

  await db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, status, created_at, updated_at, version)
     VALUES ('order-07', 'clue-07', 'player-1', 'TLS-C07-K4M2', 'created',
             '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1)`
  ).run();
  await expectReject(db.prepare(
    `UPDATE clues SET sequence = 13 WHERE id = 'clue-07'`
  ));
  await db.prepare(`UPDATE clues SET sequence = 13 WHERE id = 'clue-09'`).run();
  await expectReject(db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, status, created_at, updated_at, version)
     VALUES ('order-07-duplicate', 'clue-07', 'player-1', 'TLS-C07-Z9Q8', 'created',
             '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1)`
  ));
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'waiting_verification' WHERE id = 'order-07'`
  ));
  await db.prepare(
    `UPDATE clue_orders SET sender_name = 'Sender', status = 'waiting_verification'
     WHERE id = 'order-07'`
  ).run();
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'created' WHERE id = 'order-07'`
  ));
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'approved', decided_at = '2026-08-07T00:01:00.000Z'
     WHERE id = 'order-07'`
  ));
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'approved', decided_by = 'staff-1'
     WHERE id = 'order-07'`
  ));
  await db.prepare(
    `UPDATE clue_orders
     SET status = 'approved', decided_by = 'staff-1', decided_at = '2026-08-07T00:01:00.000Z'
     WHERE id = 'order-07'`
  ).run();
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'cancelled', decided_by = 'staff-1',
      decided_at = '2026-08-07T00:02:00.000Z' WHERE id = 'order-07'`
  ));
  await expectReject(db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, status, created_at, updated_at, version)
     VALUES ('order-bad-reference', 'clue-07', 'player-1', 'TLS-C08-K4M2', 'created',
             '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1)`
  ));
  await expectReject(db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, status, created_at, updated_at, version)
     VALUES ('order-missing-clue', 'missing-clue', 'player-1', 'TLS-C07-K4M2', 'created',
             '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1)`
  ));

  await expectReject(db.prepare(
    `INSERT INTO clues
     (id, sequence, title, riddle, decoder_explanation, narrowing_summary,
      internal_numeric_score, state, decoder_mode, version, created_at, updated_at)
     VALUES ('fractional-sequence', 10.5, 'x', 'x', 'x', 'x', 1, 'ready', 'paid', 1, 't', 't')`
  ));
  await expectReject(db.prepare(
    `INSERT INTO clues
     (id, sequence, title, riddle, decoder_explanation, narrowing_summary,
      internal_numeric_score, state, decoder_mode, version, created_at, updated_at)
     VALUES ('fractional-score', 11, 'x', 'x', 'x', 'x', 1.5, 'ready', 'paid', 1, 't', 't')`
  ));
  await expectReject(db.prepare(
    `INSERT INTO clues
     (id, sequence, title, riddle, decoder_explanation, narrowing_summary,
      internal_numeric_score, state, decoder_mode, version, created_at, updated_at)
     VALUES ('fractional-clue-version', 12, 'x', 'x', 'x', 'x', 1, 'ready', 'paid', 1.5, 't', 't')`
  ));
  await expectReject(db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, status, created_at, updated_at, version)
     VALUES ('fractional-order-version', 'clue-08', 'player-1', 'TLS-C08-K4M2', 'created', 't', 't', 1.5)`
  ));

  await db.prepare(
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, clue_version, occurred_at)
     VALUES ('clue-event-1', 'clue-07', 'system', 'system:test', 'created', 1, 't')`
  ).run();
  for (const statement of [
    `UPDATE clue_events SET actor_subject = 'changed' WHERE id = 'clue-event-1'`,
    `DELETE FROM clue_events WHERE id = 'clue-event-1'`,
    `INSERT OR REPLACE INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, clue_version, occurred_at)
     VALUES ('clue-event-1', 'clue-07', 'system', 'replacement', 'created', 1, 't')`,
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, notification_key, clue_version, occurred_at)
     VALUES ('clue-event-missing-key', 'clue-07', 'system', 'system:test', 'notified', NULL, 1, 't')`,
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, notification_key, clue_version, occurred_at)
     VALUES ('clue-event-blank-key', 'clue-07', 'system', 'system:test', 'notified', ' ', 1, 't')`,
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, notification_key, clue_version, occurred_at)
     VALUES ('clue-event-key-on-create', 'clue-07', 'system', 'system:test', 'created', 'notice-1', 1, 't')`,
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, clue_version, occurred_at)
     VALUES ('clue-event-fractional-version', 'clue-07', 'system', 'system:test', 'created', 1.5, 't')`
  ]) await expectReject(db.prepare(statement));
  await db.prepare(
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, notification_key, clue_version, occurred_at)
     VALUES ('clue-event-notified', 'clue-07', 'system', 'system:test', 'notified', 'notice-1', 1, 't')`
  ).run();
  await expectReject(db.prepare(
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, notification_key, clue_version, occurred_at)
     VALUES ('clue-event-notified-duplicate', 'clue-07', 'system', 'system:test', 'notified', 'notice-1', 1, 't')`
  ));
  await expectReject(db.prepare(
    `INSERT OR REPLACE INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, notification_key, clue_version, occurred_at)
     VALUES ('clue-event-notified-replace', 'clue-07', 'system', 'replacement', 'notified', 'notice-1', 1, 't')`
  ));

  await db.prepare(
    `INSERT INTO clue_order_events
     (id, order_id, actor_type, actor_subject, action, order_version, occurred_at)
     VALUES ('order-event-1', 'order-07', 'system', 'system:test', 'created', 1, 't')`
  ).run();
  for (const statement of [
    `UPDATE clue_order_events SET actor_subject = 'changed' WHERE id = 'order-event-1'`,
    `DELETE FROM clue_order_events WHERE id = 'order-event-1'`,
    `INSERT OR REPLACE INTO clue_order_events
     (id, order_id, actor_type, actor_subject, action, order_version, occurred_at)
     VALUES ('order-event-1', 'order-07', 'system', 'replacement', 'created', 1, 't')`,
    `INSERT INTO clue_order_events
     (id, order_id, actor_type, actor_subject, action, order_version, occurred_at)
     VALUES ('order-event-fractional-version', 'order-07', 'system', 'system:test', 'created', 1.5, 't')`,
    `INSERT INTO clue_order_events
     (id, order_id, actor_type, actor_subject, action, order_version, occurred_at)
     VALUES ('order-event-missing-order', 'missing-order', 'system', 'system:test', 'created', 1, 't')`
  ]) await expectReject(db.prepare(statement));

  await db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, sender_name, status, created_at, updated_at, version)
     VALUES ('order-08', 'clue-08', 'player-1', 'TLS-C08-K4M2', 'Sender', 'waiting_verification', 't', 't', 1)`
  ).run();
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'rejected', decided_by = 'staff-1', decided_at = 't'
     WHERE id = 'order-08'`
  ));
  await db.prepare(
    `UPDATE clue_orders
     SET status = 'rejected', decision_note = 'No matching payment', decided_by = 'staff-1', decided_at = 't'
     WHERE id = 'order-08'`
  ).run();
  await db.prepare(
    `UPDATE clue_orders
     SET status = 'created', sender_name = NULL, decision_note = NULL, decided_by = NULL, decided_at = NULL
     WHERE id = 'order-08'`
  ).run();

  await db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, status, created_at, updated_at, version)
     VALUES ('order-10', 'clue-10', 'player-1', 'TLS-C10-K4M2', 'created', 't', 't', 1)`
  ).run();
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'cancelled', decided_at = 't' WHERE id = 'order-10'`
  ));
  await expectReject(db.prepare(
    `UPDATE clue_orders SET status = 'cancelled', decided_by = 'player-1' WHERE id = 'order-10'`
  ));
  await db.prepare(
    `UPDATE clue_orders SET status = 'cancelled', decided_by = 'player-1', decided_at = 't'
     WHERE id = 'order-10'`
  ).run();
  await db.prepare(
    `UPDATE clue_orders
     SET status = 'created', sender_name = NULL, decision_note = NULL, decided_by = NULL, decided_at = NULL
     WHERE id = 'order-10'`
  ).run();
  assert.deepEqual(
    await db.prepare(
      `SELECT status, sender_name, decision_note, decided_by, decided_at FROM clue_orders WHERE id = 'order-10'`
    ).first(),
    { status: 'created', sender_name: null, decision_note: null, decided_by: null, decided_at: null }
  );

  const integrityCheck = await db.prepare("PRAGMA integrity_check").all().catch((error: unknown) => error);
  if (integrityCheck instanceof Error) {
    assert.match(integrityCheck.message, /not authorized|SQLITE_AUTH/i);
  } else {
    assert.deepEqual(integrityCheck.results, [{ integrity_check: "ok" }]);
  }
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});
