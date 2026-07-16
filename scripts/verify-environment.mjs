import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function validateTarget(database, expected) {
  if (expected !== "validation") {
    throw new Error("This validation verifier cannot target production.");
  }
  if (!/^[a-z0-9-]+-validation$/.test(database)) {
    throw new Error("The database must have a validation-suffixed resource name.");
  }
  return { database, expected };
}

export function verifySummary(summary, expected) {
  if (summary.environment !== expected) throw new Error("The D1 environment sentinel does not match.");
  if (summary.state !== "open") throw new Error("The validation case state is not open.");
  if (summary.publishedWaypoints !== 13 || !Array.isArray(summary.waypointRows) || summary.waypointRows.length !== 13) {
    throw new Error("Expected exactly 13 published validation waypoints.");
  }
  const expectedIds = [1, 2, 3, 4, 13, 5, 6, 7, 8, 9, 10, 11, 12];
  const expectedRouteOrders = Array.from({ length: 13 }, (_, index) => index + 1);
  const expectedNames = [
    "The Creek Property — The Starting Point",
    "The Public Beach and Farmers' Market Lot",
    "The Beach (Randy's)",
    "Seba Beach Seniors Centre",
    "Derby's Lakeview General Store",
    "The Gated Road and the School Grounds",
    "The Back Trails",
    "The Lodge Trails",
    "The Vista Lands",
    "The Cliff-Edge Slope",
    "The Driving Range and Digger Café",
    "Kokanee Springs RV — the Front Gate",
    "The Old Seba Beach School (SebaHub)",
  ];
  if (
    JSON.stringify(summary.waypointRows.map((row) => row.id)) !== JSON.stringify(expectedIds)
    || JSON.stringify(summary.waypointRows.map((row) => row.routeOrder)) !== JSON.stringify(expectedRouteOrders)
    || JSON.stringify(summary.waypointRows.map((row) => row.name)) !== JSON.stringify(expectedNames)
  ) {
    throw new Error("Published waypoint IDs, names, and route order do not match the Lucky 13 route.");
  }
  const seniors = summary.waypointRows[3];
  const derby = summary.waypointRows[4];
  const seniorsUrl = "https://www.google.com/maps/search/?api=1&query=53.5593028,-114.7359167";
  const derbyUrl = "https://www.google.com/maps/search/?api=1&query=53.5567361,-114.7377167";
  if (
    seniors.id !== 4 || seniors.routeOrder !== 4 || seniors.name !== "Seba Beach Seniors Centre"
    || derby.id !== 13 || derby.routeOrder !== 5 || derby.name !== "Derby's Lakeview General Store"
    || seniors.exactUrl !== seniorsUrl || derby.exactUrl !== derbyUrl || seniors.exactUrl === derby.exactUrl
  ) {
    throw new Error("Seniors Centre and Derby's must retain distinct identities and GPS-true exact URLs.");
  }
  if (summary.publishedRules !== 1) throw new Error("Expected one published validation rules version.");
  if (summary.publishedZones !== 2) throw new Error("Expected two published validation zones.");
  if (summary.featureFlags !== 3) throw new Error("Expected three validation feature flags.");
  const personalAndStaffCounts = [
    summary.playerAccounts,
    summary.hunterProfiles,
    summary.reports,
    summary.fieldNotes,
    summary.staffPrincipals,
  ];
  if (!personalAndStaffCounts.every((count) => Number.isInteger(count) && count === 0)) {
    throw new Error("Unexpected personal or staff data exists in validation.");
  }
  return summary;
}

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : -1;

function normalizeWaypointRows(value) {
  let rows = value;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { rows = []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    id: number(row?.id),
    routeOrder: number(row?.routeOrder),
    name: String(row?.name ?? "").trim(),
    exactUrl: String(row?.exactUrl ?? "").trim(),
  }));
}

export function normalizeRow(row) {
  return {
    environment: String(row.environment ?? ""),
    state: String(row.state ?? ""),
    publishedWaypoints: number(row.published_waypoints),
    waypointRows: normalizeWaypointRows(row.published_waypoint_rows),
    publishedRules: number(row.published_rules),
    publishedZones: number(row.published_zones),
    featureFlags: number(row.feature_flags),
    playerAccounts: number(row.player_accounts),
    hunterProfiles: number(row.hunter_profiles),
    reports: number(row.reports),
    fieldNotes: number(row.field_notes),
    staffPrincipals: number(row.staff_principals)
  };
}

export function redactSummary(summary) {
  return {
    environment: summary.environment,
    state: summary.state,
    publishedWaypoints: summary.publishedWaypoints,
    publishedRules: summary.publishedRules,
    publishedZones: summary.publishedZones,
    featureFlags: summary.featureFlags,
    waypointIds: summary.waypointRows.map((row) => row.id),
    waypointRouteOrders: summary.waypointRows.map((row) => row.routeOrder),
  };
}

const query = `SELECT
  (SELECT environment FROM environment_metadata WHERE id = 1) AS environment,
  (SELECT state FROM case_status WHERE id = 1) AS state,
  (SELECT COUNT(*) FROM waypoints WHERE is_published = 1) AS published_waypoints,
  (SELECT json_group_array(json_object(
    'id', id,
    'routeOrder', route_order,
    'name', name,
    'exactUrl', member_exact_url
  )) FROM (
    SELECT id, route_order, name, member_exact_url
    FROM waypoints
    WHERE is_published = 1
    ORDER BY route_order
  )) AS published_waypoint_rows,
  (SELECT COUNT(*) FROM rules_versions WHERE status = 'published') AS published_rules,
  (SELECT COUNT(*) FROM zones WHERE is_published = 1) AS published_zones,
  (SELECT COUNT(*) FROM feature_flags) AS feature_flags,
  (SELECT COUNT(*) FROM player_accounts) AS player_accounts,
  (SELECT COUNT(*) FROM hunter_profiles) AS hunter_profiles,
  (SELECT COUNT(*) FROM private_reports) AS reports,
  (SELECT COUNT(*) FROM field_notes) AS field_notes,
  (SELECT COUNT(*) FROM staff_principals) AS staff_principals`;

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function run() {
  const target = validateTarget(
    option("--database") ?? "tim-lost-hunter-platform-validation",
    option("--expected") ?? "validation"
  );
  const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(
    process.execPath,
    [wrangler, "d1", "execute", target.database, "--remote", "--json", "--command", query],
    { cwd: root, encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) {
    throw new Error("Unable to read the validation environment summary.");
  }
  const payload = JSON.parse(result.stdout);
  const row = payload?.[0]?.results?.[0];
  if (!row) throw new Error("The validation environment summary was empty.");
  const summary = verifySummary(normalizeRow(row), target.expected);
  process.stdout.write(`${JSON.stringify({ ok: true, ...redactSummary(summary) }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Validation verification failed."}\n`);
    process.exitCode = 1;
  }
}
