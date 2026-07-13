import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { D1DataStore } from "../src/server/d1-store";
import { ApiError } from "../src/server/errors";
import type { SponsorInquiryInput } from "../src/server/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = await readFile(
  path.join(root, "migrations", "0005_sponsor_inquiries.sql"),
  "utf8"
);

const sponsorInput = (
  overrides: Partial<SponsorInquiryInput> = {}
): SponsorInquiryInput => ({
  contactName: "Alex Sponsor",
  organization: "Example Ltd.",
  email: "alex@example.test",
  phone: null,
  supportType: "lead",
  contributionRange: "prefer_to_discuss",
  desiredOutcome: "Discuss a useful local activation.",
  acknowledgementVersion: "2026.1",
  ...overrides
});

const inquiryInsert = (
  db: D1Database,
  id: string,
  createdAt = "2026-07-13T20:00:00.000Z"
) =>
  db
    .prepare(
      `INSERT INTO sponsor_inquiries
       (id, reference_code, idempotency_key, contact_name, organization, email, phone,
        support_type, contribution_range, desired_outcome, acknowledgement_version,
        acknowledged_at, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'lead', 'prefer_to_discuss', ?, '2026.1', ?, 'new', ?, ?)`
    )
    .bind(
      id,
      `SP-${id.replace(/[^A-Z0-9]/gi, "").padEnd(8, "0").slice(0, 8).toUpperCase()}`,
      `key-${id}`,
      `Contact ${id}`,
      `Organization ${id}`,
      `${id}@example.test`,
      "Discuss a useful local activation.",
      createdAt,
      createdAt,
      createdAt
    );

test("real D1 preserves sponsor inquiry atomicity, search, pagination, and history", async (t) => {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-07-11",
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "sponsor-test" }
  });
  t.after(() => miniflare.dispose());
  const miniflareDb = await miniflare.getD1Database("DB");
  const db = miniflareDb as unknown as D1Database;
  for (const statement of migration.split(";").map((sql) => sql.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
  const store = new D1DataStore(db);
  const reset = async () => {
    await db.batch([
      db.prepare("DELETE FROM sponsor_inquiry_events"),
      db.prepare("DELETE FROM sponsor_inquiries")
    ]);
  };

  await t.test("a failing event rolls back its inquiry in the same raw D1 batch", async () => {
    await reset();
    await assert.rejects(
      db.batch([
        inquiryInsert(db, "rollback-1"),
        db
          .prepare(
            `INSERT INTO sponsor_inquiry_events
             (id, inquiry_id, event_type, created_at) VALUES (?, ?, ?, ?)`
          )
          .bind("bad-event", "rollback-1", "invalid", "2026-07-13T20:00:00.000Z")
      ]),
      /CHECK constraint failed/i
    );
    const row = await db
      .prepare("SELECT COUNT(*) AS count FROM sponsor_inquiries WHERE id = ?")
      .bind("rollback-1")
      .first<{ count: number }>();
    assert.equal(row?.count, 0);
  });

  await t.test("literal wildcard search matches each private contact field without decoys", async () => {
    await reset();
    const literal = "%_\\";
    const captures = await Promise.all([
      store.createSponsorInquiry(sponsorInput({ contactName: `Contact ${literal}` }), "literal-contact"),
      store.createSponsorInquiry(sponsorInput({ organization: `Org ${literal}` }), "literal-org"),
      store.createSponsorInquiry(sponsorInput({ email: `mail${literal}@example.test` }), "literal-email"),
      store.createSponsorInquiry(
        sponsorInput({ contactName: "Contact AXZ", organization: "Org AXZ" }),
        "wildcard-decoy"
      )
    ]);

    const page = await store.listSponsorInquiries({ query: literal, limit: 10 });
    const expected = captures.slice(0, 3).map((capture) => capture.value.id).sort();
    assert.deepEqual(page.items.map((item) => item.id).sort(), expected);
  });

  await t.test("tuple cursors paginate equal timestamps without duplicates or omissions", async () => {
    await reset();
    await db.batch(
      ["page-1", "page-2", "page-3", "page-4", "page-5"].map((id) => inquiryInsert(db, id))
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await store.listSponsorInquiries({ limit: 2, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual(seen, ["page-5", "page-4", "page-3", "page-2", "page-1"]);
    assert.equal(new Set(seen).size, 5);
  });

  await t.test("a real update persists its matching actor and state transition event", async () => {
    await reset();
    const created = await store.createSponsorInquiry(sponsorInput(), "update-key");
    const updated = await store.updateSponsorInquiry(
      created.value.id,
      { state: "qualified", note: "Call scheduled." },
      "staff-1"
    );
    assert.equal(updated?.state, "qualified");

    const event = await db
      .prepare(
        `SELECT actor_subject, from_state, to_state, note
         FROM sponsor_inquiry_events
         WHERE inquiry_id = ? AND event_type = 'state_changed'`
      )
      .bind(created.value.id)
      .first<Record<string, unknown>>();
    assert.deepEqual(event, {
      actor_subject: "staff-1",
      from_state: "new",
      to_state: "qualified",
      note: "Call scheduled."
    });
  });

  await t.test("concurrent updates cannot revert state or break the event chain", async () => {
    await reset();
    const created = await store.createSponsorInquiry(sponsorInput(), "concurrent-key");
    const settled = await Promise.allSettled([
      store.updateSponsorInquiry(
        created.value.id,
        { state: "contacted", note: "Initial outreach." },
        "staff-a"
      ),
      store.updateSponsorInquiry(
        created.value.id,
        { state: "qualified", note: "Qualification call." },
        "staff-b"
      )
    ]);
    assert.ok(settled.some((result) => result.status === "fulfilled"));
    for (const result of settled) {
      if (result.status === "rejected") {
        assert.ok(result.reason instanceof ApiError);
        assert.equal(result.reason.code, "version_conflict");
      }
    }

    const events = await db
      .prepare(
        `SELECT from_state, to_state FROM sponsor_inquiry_events
         WHERE inquiry_id = ? AND event_type = 'state_changed' ORDER BY rowid`
      )
      .bind(created.value.id)
      .all<{ from_state: string; to_state: string }>();
    let expectedState = "new";
    for (const event of events.results) {
      assert.equal(event.from_state, expectedState);
      expectedState = event.to_state;
    }
    const persisted = await db
      .prepare("SELECT state FROM sponsor_inquiries WHERE id = ?")
      .bind(created.value.id)
      .first<{ state: string }>();
    assert.equal(persisted?.state, expectedState);
    assert.notEqual(persisted?.state, "new");
  });
});
