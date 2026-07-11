import assert from "node:assert/strict";
import test from "node:test";
import { D1DataStore } from "../src/server/d1-store";

type Row = Record<string, unknown>;

class Statement {
  bindings: unknown[] = [];

  constructor(
    private readonly database: ScriptedD1,
    readonly sql: string
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM hunter_profiles WHERE subject")) return null;
    if (this.sql.includes("SELECT p.*")) return this.database.profile as T;
    if (this.sql.includes("COUNT(*) AS total_profiles")) return this.database.counts as T;
    return null;
  }

  async all<T>() {
    if (this.sql.includes("ORDER BY p.updated_at DESC")) {
      return { results: this.database.subscribers as T[] };
    }
    return { results: [] as T[] };
  }
}

class ScriptedD1 {
  statements: Statement[] = [];
  profile: Row = {
    subject: "hunter-1",
    verified_email: "hunter@example.test",
    full_name: "A Hunter",
    public_handle: "Hunter A7F3",
    phone: null,
    town_area: "Seba Beach",
    age_band: "25-34",
    interests_json: "[]",
    discovery_source: "friend",
    adult_attested_at: "2026-07-11T15:00:00.000Z",
    created_at: "2026-07-11T15:00:00.000Z",
    updated_at: "2026-07-11T17:00:00.000Z",
    hunt_email_consent: 1,
    marketing_consent: 0,
    sms_consent: 0
  };
  counts: Row = {
    total_profiles: 2,
    hunt_email_count: 2,
    marketing_count: 1,
    sms_count: 1
  };
  subscribers: Row[] = [
    {
      ...this.profile,
      phone: "+1 555 0100",
      sms_consent: 1
    }
  ];

  prepare(sql: string) {
    const statement = new Statement(this, sql);
    this.statements.push(statement);
    return statement;
  }
}

test("D1 profile projection returns the latest consent booleans", async () => {
  const database = new ScriptedD1();
  const store = new D1DataStore(database as never);

  const profile = await store.getProfile("hunter-1");

  assert.deepEqual(profile?.consents, {
    huntEmail: true,
    marketing: false,
    sms: false
  });
  assert.match(database.statements[0]?.sql ?? "", /consent_type = 'hunt_email'/);
  assert.match(database.statements[0]?.sql ?? "", /ORDER BY occurred_at DESC, id DESC/);
});

test("D1 subscriber ledger maps current consent and contact projections", async () => {
  const database = new ScriptedD1();
  const store = new D1DataStore(database as never);

  const ledger = await store.listSubscribers({ limit: 25 });

  assert.deepEqual(ledger.counts, {
    totalProfiles: 2,
    huntEmail: 2,
    marketing: 1,
    sms: 1
  });
  assert.equal(ledger.items[0]?.verifiedEmail, "hunter@example.test");
  assert.equal(ledger.items[0]?.smsReachable, true);
  assert.deepEqual(ledger.items[0]?.consents, {
    huntEmail: true,
    marketing: false,
    sms: true
  });
  assert.match(database.statements.find((entry) => entry.sql.includes("ORDER BY p.updated_at DESC"))?.sql ?? "", /ROW_NUMBER\(\) OVER/);
});
