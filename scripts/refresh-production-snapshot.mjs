import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const defaults = Object.freeze({
  sourceDatabase: "tim-lost-hunter-platform",
  sourceBucket: "tim-lost-private-media",
  destinationDatabase: "tim-lost-hunter-platform-production-snapshot",
  destinationBucket: "tim-lost-private-media-production-snapshot",
});

export const SNAPSHOT_TABLES = Object.freeze([
  "case_status",
  "rules_versions",
  "zones",
  "waypoints",
  "player_accounts",
  "hunter_profiles",
  "consent_events",
  "waypoint_progress",
  "field_notes",
  "field_note_revisions",
  "field_note_replies",
  "content_flags",
  "private_reports",
  "report_events",
  "media_uploads",
  "staff_principals",
  "feature_flags",
  "audit_events",
  "legal_acceptance_events",
  "legal_document_review_events",
  "waiver_acceptance_participants",
  "waiver_account_participants",
  "sponsor_inquiries",
  "sponsor_inquiry_events",
  "official_updates",
  "official_update_media",
]);

const immutableSnapshotTriggers = Object.freeze([
  "trg_legal_acceptance_events_immutable",
  "trg_legal_acceptance_events_immutable_delete",
  "trg_waiver_account_participants_immutable",
  "trg_waiver_account_participants_immutable_delete",
]);

const sqlIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function validateResources(input) {
  const resources = { ...input };
  for (const [key, value] of Object.entries(resources)) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
    resources[key] = value.trim();
  }
  if (resources.sourceDatabase === resources.destinationDatabase ||
      resources.sourceBucket === resources.destinationBucket) {
    throw new Error("Source and destination resources must be different.");
  }
  if (resources.sourceDatabaseId === resources.destinationDatabaseId) {
    throw new Error("Source and destination database identifiers must be different.");
  }
  if (!resources.destinationDatabase.endsWith("-production-snapshot") ||
      !resources.destinationBucket.endsWith("-production-snapshot")) {
    throw new Error("Snapshot destination names must end in -production-snapshot.");
  }
  if (/validation|production-snapshot/i.test(resources.sourceDatabase) ||
      /validation|production-snapshot/i.test(resources.sourceBucket)) {
    throw new Error("The production source resources are invalid.");
  }
  return resources;
}

export function verifySourceSentinel(row) {
  if (!row || row.environment !== "production") {
    throw new Error("The source database did not identify itself as production.");
  }
}

export function verifyDestinationSentinel(row) {
  if (!row || row.kind !== "production-snapshot") {
    throw new Error("The destination database is not a production-snapshot resource.");
  }
}

export function reverseDeleteStatements(tables = SNAPSHOT_TABLES) {
  return [...tables].reverse().map((table) => `DELETE FROM ${sqlIdentifier(table)};`);
}

export function snapshotMediaKey(snapshotId, sourceKey) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(snapshotId)) {
    throw new Error("The snapshot ID is invalid.");
  }
  if (typeof sourceKey !== "string" || !sourceKey || sourceKey.startsWith("/") ||
      sourceKey.includes("\\") || sourceKey.split("/").includes("..")) {
    throw new Error("The source object key is invalid.");
  }
  return `snapshots/${snapshotId}/${sourceKey}`;
}

function insertTable(statement) {
  return statement.trim().match(/^INSERT\s+INTO\s+["`]?([A-Za-z0-9_]+)["`]?\b/i)?.[1] ?? null;
}

export function buildSnapshotSql({
  snapshotId,
  verifiedAt,
  sourceUpdatedAt,
  insertStatements,
  counts,
}) {
  snapshotMediaKey(snapshotId, "sentinel");
  const allowed = new Set(SNAPSHOT_TABLES);
  for (const statement of insertStatements) {
    const table = insertTable(statement);
    if (!table || !allowed.has(table)) throw new Error("Snapshot export contains a table outside the allowlist.");
  }
  for (const count of Object.values(counts)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Snapshot counts must be non-negative integers.");
  }
  const prefix = `snapshots/${snapshotId}/`;
  return [
    "PRAGMA defer_foreign_keys = true;",
    ...immutableSnapshotTriggers.map((trigger) => `DROP TRIGGER IF EXISTS ${sqlIdentifier(trigger)};`),
    ...reverseDeleteStatements(),
    ...insertStatements.map((statement) => statement.trim().replace(/;?$/, ";")),
    `UPDATE media_uploads SET private_object_key = ${sqlString(prefix)} || private_object_key, derivative_object_key = CASE WHEN derivative_object_key IS NULL THEN NULL ELSE ${sqlString(prefix)} || derivative_object_key END;`,
    "DELETE FROM snapshot_refresh_metadata;",
    `INSERT INTO snapshot_refresh_metadata (id, kind, status, snapshot_id, source_environment, verified_at, source_updated_at, report_count, player_count, staff_count, audit_count, media_count) VALUES (1, 'production-snapshot', 'verified', ${sqlString(snapshotId)}, 'production', ${sqlString(verifiedAt)}, ${sqlString(sourceUpdatedAt)}, ${counts.reports}, ${counts.players}, ${counts.staff}, ${counts.audit}, ${counts.media});`,
    "",
  ].join("\n");
}

export function redactSnapshotReport(input) {
  const objects = Array.isArray(input.objects) ? input.objects : [];
  return {
    snapshotId: String(input.snapshotId ?? ""),
    status: String(input.status ?? ""),
    counts: input.counts && typeof input.counts === "object" ? { ...input.counts } : {},
    objectCount: objects.length,
    totalObjectBytes: objects.reduce((total, object) =>
      total + (typeof object?.bytes === "number" && Number.isFinite(object.bytes) ? object.bytes : 0), 0),
  };
}

export function shouldCleanupUploadedObjects({
  importStarted,
  destinationSnapshotId,
  attemptedSnapshotId,
}) {
  if (!importStarted) return true;
  if (!destinationSnapshotId) return false;
  return destinationSnapshotId !== attemptedSnapshotId;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    current += character;
    if (character === "'") {
      if (quoted && sql[index + 1] === "'") {
        current += sql[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    }
    if (character === ";" && !quoted) {
      if (current.trim()) statements.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function exportedInsertStatements(sql) {
  const allowed = new Set(SNAPSHOT_TABLES);
  return splitSqlStatements(sql).flatMap((statement) => {
    const table = insertTable(statement);
    if (!table) return [];
    if (!allowed.has(table)) throw new Error("The D1 export contained a non-allowlisted table.");
    return [statement];
  });
}

async function loadLocalEnvironment() {
  const values = {};
  try {
    const content = await readFile(path.join(root, ".env.local"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith("#")) continue;
      values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return values;
}

async function wrangler(args, options = {}) {
  try {
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = await execFileAsync(executable, ["wrangler", ...args], {
      cwd: root,
      encoding: options.encoding ?? "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return result.stdout;
  } catch {
    throw new Error("A guarded Cloudflare snapshot command failed. No private provider output was retained.");
  }
}

function jsonRows(output) {
  const parsed = JSON.parse(output);
  const groups = Array.isArray(parsed) ? parsed : [parsed];
  return groups.flatMap((group) => Array.isArray(group?.results) ? group.results : []);
}

async function d1Rows(database, query) {
  const output = await wrangler(["d1", "execute", database, "--remote", "--json", "--command", query]);
  return jsonRows(output);
}

async function databaseIds() {
  const output = await wrangler(["d1", "list", "--json"]);
  const parsed = JSON.parse(output);
  return new Map((Array.isArray(parsed) ? parsed : []).map((database) => [database.name, database.uuid ?? database.id]));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const local = await loadLocalEnvironment();
  const names = {
    sourceDatabase: local.SNAPSHOT_SOURCE_DATABASE || defaults.sourceDatabase,
    sourceBucket: local.SNAPSHOT_SOURCE_BUCKET || defaults.sourceBucket,
    destinationDatabase: local.SNAPSHOT_DESTINATION_DATABASE || defaults.destinationDatabase,
    destinationBucket: local.SNAPSHOT_DESTINATION_BUCKET || defaults.destinationBucket,
  };
  const ids = await databaseIds();
  const resources = validateResources({
    ...names,
    sourceDatabaseId: String(ids.get(names.sourceDatabase) ?? ""),
    destinationDatabaseId: String(ids.get(names.destinationDatabase) ?? ""),
  });
  const sourceSentinel = (await d1Rows(resources.sourceDatabase, "SELECT environment FROM environment_metadata WHERE id = 1 LIMIT 1"))[0];
  const destinationSentinel = (await d1Rows(resources.destinationDatabase, "SELECT kind FROM snapshot_refresh_metadata WHERE id = 1 LIMIT 1"))[0];
  verifySourceSentinel(sourceSentinel);
  verifyDestinationSentinel(destinationSentinel);

  const timestamp = new Date().toISOString();
  const snapshotId = `snapshot-${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const work = path.join(root, ".wrangler", "snapshot-work", snapshotId);
  const reportDirectory = path.join(root, ".wrangler", "snapshot-reports");
  await mkdir(work, { recursive: true });
  await mkdir(reportDirectory, { recursive: true });
  const exportPath = path.join(work, "production.sql");
  const replacementPath = path.join(work, "snapshot.sql");
  const uploaded = [];
  let importStarted = false;
  try {
    await wrangler([
      "d1", "export", resources.sourceDatabase, "--remote", "--no-schema", "--skip-confirmation",
      "--output", exportPath,
      ...SNAPSHOT_TABLES.flatMap((table) => ["--table", table]),
    ]);
    const insertStatements = exportedInsertStatements(await readFile(exportPath, "utf8"));
    const [counts] = await d1Rows(resources.sourceDatabase,
      "SELECT (SELECT COUNT(*) FROM private_reports) AS reports, (SELECT COUNT(*) FROM player_accounts) AS players, (SELECT COUNT(*) FROM staff_principals) AS staff, (SELECT COUNT(*) FROM audit_events) AS audit, (SELECT COUNT(*) FROM media_uploads WHERE status = 'ready') AS media, (SELECT updated_at FROM case_status WHERE id = 1) AS source_updated_at");
    if (!counts) throw new Error("Production snapshot counts are unavailable.");
    const mediaRows = await d1Rows(resources.sourceDatabase,
      "SELECT private_object_key, derivative_object_key, content_type, byte_size FROM media_uploads WHERE private_object_key IS NOT NULL OR derivative_object_key IS NOT NULL ORDER BY id");
    const objects = [];
    for (const row of mediaRows) {
      for (const sourceKey of [row.private_object_key, row.derivative_object_key]) {
        if (typeof sourceKey !== "string" || !sourceKey || objects.some((item) => item.sourceKey === sourceKey)) continue;
        const destinationKey = snapshotMediaKey(snapshotId, sourceKey);
        const index = String(objects.length + 1).padStart(5, "0");
        const sourceFile = path.join(work, `${index}-source.bin`);
        const verifyFile = path.join(work, `${index}-verify.bin`);
        await wrangler(["r2", "object", "get", `${resources.sourceBucket}/${sourceKey}`, "--remote", "--file", sourceFile]);
        const sourceBuffer = await readFile(sourceFile);
        await wrangler(["r2", "object", "put", `${resources.destinationBucket}/${destinationKey}`, "--remote", "--file", sourceFile, "--content-type", String(row.content_type || "application/octet-stream"), "--force"]);
        uploaded.push(destinationKey);
        await wrangler(["r2", "object", "get", `${resources.destinationBucket}/${destinationKey}`, "--remote", "--file", verifyFile]);
        const verifyBuffer = await readFile(verifyFile);
        if (sha256(sourceBuffer) !== sha256(verifyBuffer)) throw new Error("Snapshot media verification failed.");
        objects.push({ sourceKey, destinationKey, sha256: sha256(sourceBuffer), bytes: sourceBuffer.byteLength });
      }
    }
    const normalizedCounts = {
      reports: Number(counts.reports),
      players: Number(counts.players),
      staff: Number(counts.staff),
      audit: Number(counts.audit),
      media: Number(counts.media),
    };
    const sql = buildSnapshotSql({
      snapshotId,
      verifiedAt: timestamp,
      sourceUpdatedAt: String(counts.source_updated_at || timestamp),
      insertStatements,
      counts: normalizedCounts,
    });
    await writeFile(replacementPath, sql, "utf8");
    importStarted = true;
    await wrangler(["d1", "execute", resources.destinationDatabase, "--remote", "--yes", "--file", replacementPath]);
    const verified = (await d1Rows(resources.destinationDatabase, "SELECT kind, status, snapshot_id FROM snapshot_refresh_metadata WHERE id = 1 LIMIT 1"))[0];
    if (verified?.kind !== "production-snapshot" || verified?.status !== "verified" || verified?.snapshot_id !== snapshotId) {
      throw new Error("The destination did not verify the new snapshot.");
    }
    const report = redactSnapshotReport({ snapshotId, status: "verified", counts: normalizedCounts, objects });
    await writeFile(path.join(reportDirectory, `${snapshotId}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    let destinationSnapshotId = null;
    if (importStarted) {
      destinationSnapshotId = await d1Rows(
        resources.destinationDatabase,
        "SELECT snapshot_id FROM snapshot_refresh_metadata WHERE id = 1 LIMIT 1"
      ).then((rows) => typeof rows[0]?.snapshot_id === "string" ? rows[0].snapshot_id : null)
        .catch(() => null);
    }
    if (shouldCleanupUploadedObjects({ importStarted, destinationSnapshotId, attemptedSnapshotId: snapshotId })) {
      await Promise.all(uploaded.map((key) =>
        wrangler(["r2", "object", "delete", `${resources.destinationBucket}/${key}`, "--remote", "--force"]).catch(() => undefined)
      ));
    }
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Snapshot refresh failed."}\n`);
    process.exitCode = 1;
  });
}
