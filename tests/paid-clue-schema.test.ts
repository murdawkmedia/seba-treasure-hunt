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
  await db.prepare(`UPDATE clues SET sequence = 7 WHERE id = 'clue-07'`).run();
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

  await db.prepare(
    `INSERT INTO notification_jobs
     (id, kind, target_record_id, status, attempts, created_at, updated_at)
     VALUES ('order-notice', 'clue_order_approved', 'order-07', 'pending', 0, 't', 't')`
  ).run();
  await db.prepare(
    `INSERT INTO clue_notification_recipients
     (id, notification_job_id, hunter_subject, recipient_email, created_at, updated_at)
     VALUES ('order-notice-recipient', 'order-notice', 'player-1', 'player-1@example.test', 't', 't')`
  ).run();
  await expectReject(db.prepare(
    `INSERT INTO clue_notification_recipients
     (id, notification_job_id, hunter_subject, recipient_email, created_at, updated_at)
     VALUES ('order-notice-recipient-duplicate', 'order-notice', 'player-1', 'other@example.test', 't', 't')`
  ));
  await expectReject(db.prepare(
    `UPDATE clue_notification_recipients SET recipient_email = 'changed@example.test'
     WHERE id = 'order-notice-recipient'`
  ));
  await expectReject(db.prepare(
    `INSERT INTO notification_jobs
     (id, kind, target_record_id, status, attempts, created_at, updated_at)
     VALUES ('bad-order-notice', 'clue_order_approved', 'order-10', 'pending', 0, 't', 't')`
  ));
  await db.prepare(
    `UPDATE clues SET state = 'released', released_at = 't' WHERE id = 'clue-08'`
  ).run();
  await db.prepare(
    `INSERT INTO clue_events
     (id, clue_id, actor_type, actor_subject, action, notification_key, clue_version, occurred_at)
     VALUES ('release-notice-event', 'clue-08', 'staff', 'staff-1', 'notified', 'release:1', 1, 't')`
  ).run();
  await db.prepare(
    `INSERT INTO notification_jobs
     (id, kind, target_record_id, status, attempts, created_at, updated_at)
     VALUES ('release-notice', 'clue_released', 'release-notice-event', 'pending', 0, 't', 't')`
  ).run();
  await expectReject(db.prepare(
    `INSERT INTO notification_jobs
     (id, kind, target_record_id, status, attempts, created_at, updated_at)
     VALUES ('release-notice-duplicate', 'clue_released', 'release-notice-event', 'pending', 0, 't', 't')`
  ));

  await db.batch([
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, interests_json, adult_attested_at, created_at, updated_at)
       VALUES ('player-1', 'player-1@example.test', 'Player One', 'Player One', '[]', 't', 't', 't')`
    ),
    db.prepare(
      `INSERT INTO player_accounts
       (subject, verified_email, account_state, created_at, updated_at, last_seen_at)
       VALUES ('player-2', 'player-2@example.test', 'active', 't', 't', 't')`
    ),
    db.prepare(
      `INSERT INTO hunter_profiles
       (subject, verified_email, full_name, public_handle, interests_json, adult_attested_at, created_at, updated_at)
       VALUES ('player-2', 'player-2@example.test', 'Player Two', 'Player Two', '[]', 't', 't', 't')`
    ),
    db.prepare(
      `INSERT INTO consent_events (id, hunter_subject, consent_type, granted, policy_version, occurred_at)
       VALUES ('player-1-opted-in', 'player-1', 'hunt_email', 1, '2026.1', 't')`
    ),
    db.prepare(
      `INSERT INTO consent_events (id, hunter_subject, consent_type, granted, policy_version, occurred_at)
       VALUES ('player-2-opted-out', 'player-2', 'hunt_email', 0, '2026.1', 't')`
    ),
    insertClue(db, 'clue-11', 11),
    db.prepare(`UPDATE clues SET state = 'released', released_at = 't' WHERE id = 'clue-11'`),
    db.prepare(
      `INSERT INTO clue_events
       (id, clue_id, actor_type, actor_subject, action, clue_version, occurred_at)
       VALUES ('clue-11-released', 'clue-11', 'staff', 'staff-1', 'released', 1, 't')`
    ),
  ]);
  const store = new D1DataStore(db);
  const queuedRelease = await store.queueClueReleaseNotice('clue-11', 1, 'staff-1');
  assert.deepEqual(queuedRelease?.replayed, false);
  assert.deepEqual(
    (await db.prepare(
      `SELECT hunter_subject FROM clue_notification_recipients
       WHERE notification_job_id = ? ORDER BY hunter_subject`
    ).bind(queuedRelease?.jobId).all()).results,
    [{ hunter_subject: 'player-1' }]
  );
  assert.deepEqual(await store.queueClueReleaseNotice('clue-11', 1, 'staff-1'), {
    jobId: queuedRelease?.jobId,
    replayed: true
  });
  await db.prepare(`UPDATE clues SET title = 'Edited after release', version = 2 WHERE id = 'clue-11'`).run();
  assert.deepEqual(await store.queueClueReleaseNotice('clue-11', 2, 'staff-1'), {
    jobId: queuedRelease?.jobId,
    replayed: true
  });
  await db.prepare(
    `INSERT INTO clue_orders
     (id, clue_id, player_subject, reference, sender_name, status, decided_by, decided_at, created_at, updated_at, version)
     VALUES ('order-11', 'clue-11', 'player-1', 'TLS-C11-K4M2', 'Sender', 'approved', 'staff-1', 't', 't', 't', 1)`
  ).run();
  const approvalJob = await store.queueClueOrderApprovalNotice('order-11', 1, 'staff-1');
  assert.ok(approvalJob);
  assert.deepEqual(
    await db.prepare(
      `SELECT action FROM audit_events WHERE target_id = 'order-11' ORDER BY occurred_at DESC, id DESC LIMIT 1`
    ).first(),
    { action: 'clue_order.email_notice_queued' }
  );
  await store.failClueNoticeConfiguration(approvalJob);
  await store.reconcileClueNoticeJob(approvalJob);
  assert.deepEqual(
    await db.prepare(`SELECT status, last_error_code FROM notification_jobs WHERE id = ?`).bind(approvalJob).first(),
    { status: 'failed', last_error_code: 'configuration_error' }
  );
  assert.deepEqual(await store.requeueClueNoticeJob(approvalJob, 'staff-1'), { status: 'queued' });
  assert.deepEqual(
    await db.prepare(
      `SELECT status, next_attempt_at, last_error_code FROM clue_notification_recipients
       WHERE notification_job_id = ?`
    ).bind(approvalJob).first(),
    { status: 'pending', next_attempt_at: null, last_error_code: null }
  );
  assert.deepEqual(
    await db.prepare(
      `SELECT action FROM audit_events WHERE target_id = ? AND action = 'clue_notice.retry_requested' LIMIT 1`
    ).bind(approvalJob).first(),
    { action: 'clue_notice.retry_requested' }
  );

  const integrityCheck = await db.prepare("PRAGMA integrity_check").all().catch((error: unknown) => error);
  if (integrityCheck instanceof Error) {
    assert.match(integrityCheck.message, /not authorized|SQLITE_AUTH/i);
  } else {
    assert.deepEqual(integrityCheck.results, [{ integrity_check: "ok" }]);
  }
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});
