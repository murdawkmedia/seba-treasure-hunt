import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRow, redactSummary, validateTarget, verifySummary } from "../scripts/verify-environment.mjs";

const waypointRows = [
  { id: 1, routeOrder: 1, name: "The Creek Property — The Starting Point", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5000000,-114.7000000" },
  { id: 2, routeOrder: 2, name: "The Public Beach and Farmers' Market Lot", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5100000,-114.7100000" },
  { id: 3, routeOrder: 3, name: "The Beach (Randy's)", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5200000,-114.7200000" },
  { id: 4, routeOrder: 4, name: "Seba Beach Seniors Centre", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5593028,-114.7359167" },
  { id: 13, routeOrder: 5, name: "Derby's Lakeview General Store", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5567361,-114.7377167" },
  { id: 5, routeOrder: 6, name: "The Gated Road and the School Grounds", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5600000,-114.7600000" },
  { id: 6, routeOrder: 7, name: "The Back Trails", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5700000,-114.7700000" },
  { id: 7, routeOrder: 8, name: "The Lodge Trails", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5800000,-114.7800000" },
  { id: 8, routeOrder: 9, name: "The Vista Lands", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5900000,-114.7900000" },
  { id: 9, routeOrder: 10, name: "The Cliff-Edge Slope", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.6000000,-114.8000000" },
  { id: 10, routeOrder: 11, name: "The Driving Range and Digger Café", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.6100000,-114.8100000" },
  { id: 11, routeOrder: 12, name: "Kokanee Springs RV — the Front Gate", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.6200000,-114.8200000" },
  { id: 12, routeOrder: 13, name: "The Old Seba Beach School (SebaHub)", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.6300000,-114.8300000" },
];

const ready = {
  environment: "validation",
  state: "open",
  publishedWaypoints: 13,
  waypointRows,
  publishedRules: 1,
  publishedZones: 2,
  featureFlags: 3,
  playerAccounts: 0,
  hunterProfiles: 0,
  reports: 0,
  fieldNotes: 0,
  staffPrincipals: 0
};

test("accepts only an explicitly validation-suffixed target", () => {
  assert.deepEqual(
    validateTarget("tim-lost-hunter-platform-validation", "validation"),
    { database: "tim-lost-hunter-platform-validation", expected: "validation" }
  );
  assert.throws(
    () => validateTarget("tim-lost-hunter-platform", "validation"),
    /validation-suffixed/i
  );
  assert.throws(
    () => validateTarget("tim-lost-hunter-platform-validation", "production"),
    /validation verifier/i
  );
});

test("verifies public seed counts without accepting personal validation data", () => {
  assert.deepEqual(verifySummary(ready, "validation"), ready);
  assert.throws(() => verifySummary({ ...ready, environment: "production" }, "validation"), /sentinel/i);
  assert.throws(
    () => verifySummary({ ...ready, publishedWaypoints: 12, waypointRows: waypointRows.slice(0, 12) }, "validation"),
    /13 published validation waypoints/i,
  );
  assert.throws(
    () => verifySummary({ ...ready, waypointRows: waypointRows.toReversed() }, "validation"),
    /route order/i,
  );
  assert.throws(
    () => verifySummary({ ...ready, waypointRows: waypointRows.map((row) => row.id === 7 ? { ...row, name: "Wrong public name" } : row) }, "validation"),
    /names.*Lucky 13 route/i,
  );
  assert.throws(
    () => verifySummary({ ...ready, waypointRows: waypointRows.map((row) => row.id === 13 ? { ...row, exactUrl: waypointRows[3].exactUrl } : row) }, "validation"),
    /distinct.*GPS-true/i,
  );
  assert.throws(() => verifySummary({ ...ready, playerAccounts: 1 }, "validation"), /personal/i);
});

test("rejects every non-zero or malformed personal and staff count independently", () => {
  const countFields = ["playerAccounts", "hunterProfiles", "reports", "fieldNotes", "staffPrincipals"];
  for (const field of countFields) {
    for (const invalidValue of [1, -1, "0", "NaN", Number.NaN]) {
      assert.throws(
        () => verifySummary({ ...ready, [field]: invalidValue }, "validation"),
        /personal or staff data/i,
        `${field}=${String(invalidValue)}`,
      );
    }
    const missingCount = { ...ready };
    delete missingCount[field];
    assert.throws(
      () => verifySummary(missingCount, "validation"),
      /personal or staff data/i,
      `missing ${field}`,
    );
  }

  assert.throws(
    () => verifySummary({ ...ready, playerAccounts: 1, hunterProfiles: -1 }, "validation"),
    /personal or staff data/i,
    "offsetting positive and negative counts",
  );
});

test("redacts gated exact URLs and personal counts from successful output", () => {
  const output = redactSummary(verifySummary(ready, "validation"));
  assert.deepEqual(output, {
    environment: "validation",
    state: "open",
    publishedWaypoints: 13,
    publishedRules: 1,
    publishedZones: 2,
    featureFlags: 3,
    waypointIds: [1, 2, 3, 4, 13, 5, 6, 7, 8, 9, 10, 11, 12],
    waypointRouteOrders: Array.from({ length: 13 }, (_, index) => index + 1),
  });
  assert.equal(JSON.stringify(output).includes("maps/search"), false);
  assert.equal(JSON.stringify(output).includes("playerAccounts"), false);
});

test("normalizes the ordered public waypoint projection returned by D1", () => {
  const normalized = normalizeRow({
    environment: "validation",
    state: "open",
    published_waypoints: "13",
    published_waypoint_rows: JSON.stringify(waypointRows.map((row) => ({
      id: String(row.id),
      routeOrder: String(row.routeOrder),
      name: row.name,
      exactUrl: row.exactUrl,
    }))),
    published_rules: "1",
    published_zones: "2",
    feature_flags: "3",
    player_accounts: "0",
    hunter_profiles: "0",
    reports: "0",
    field_notes: "0",
    staff_principals: "0",
  });
  assert.deepEqual(normalized, ready);
});
