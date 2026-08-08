import path from "node:path";

const states = new Set(["draft", "ready", "released", "retired"]);
const decoderModes = new Set(["paid", "free"]);

const requiredTextFields = [
  "id", "title", "riddle", "decoderExplanation", "narrowingSummary", "internalNapkinNote",
];

export function validatePrivateClueSeed(input) {
  if (!Array.isArray(input) || input.length !== 30) throw new Error("The private clue seed must contain exactly 30 records.");
  const ids = new Set();
  const sequences = new Set();
  for (const row of input) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Every clue seed record must be an object.");
    for (const field of requiredTextFields) {
      if (typeof row[field] !== "string" || (field !== "internalNapkinNote" && !row[field].trim())) {
        throw new Error(`Clue ${row.sequence ?? "?"} has an invalid ${field} field.`);
      }
    }
    if (!Number.isInteger(row.sequence) || row.sequence < 1 || row.sequence > 30 ||
        row.id !== `clue-${String(row.sequence).padStart(2, "0")}`) throw new Error("Clue IDs and sequences must be the canonical 01-30 set.");
    if (ids.has(row.id) || sequences.has(row.sequence)) throw new Error("Clue IDs and sequences must be unique.");
    if (!Number.isInteger(row.internalScore) || row.internalScore < 0 || row.internalScore > 100) throw new Error(`Clue ${row.sequence} has an invalid private score.`);
    if (!states.has(row.state) || !decoderModes.has(row.decoderMode)) throw new Error(`Clue ${row.sequence} has an invalid state or decoder mode.`);
    if (row.sequence === 1 ? row.state !== "released" : row.state !== "draft") throw new Error("Only Clue 01 may begin Released; Clues 02-30 must begin Draft.");
    if (row.decoderMode !== "paid") throw new Error("Every imported decoder must begin Paid.");
    ids.add(row.id);
    sequences.add(row.sequence);
  }
  for (let sequence = 1; sequence <= 30; sequence += 1) {
    if (!sequences.has(sequence)) throw new Error(`Clue ${sequence} is missing from the private seed.`);
  }
  return input;
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function paidClueInsertSql(records, timestamp) {
  if (!Array.isArray(records) || !records.length) return "-- No missing clue records.\n";
  if (typeof timestamp !== "string" || !timestamp) throw new Error("An import timestamp is required.");
  const statements = ["PRAGMA foreign_keys = ON;"];
  for (const row of records) {
    const releasedAt = row.state === "released" ? sql(timestamp) : "NULL";
    const retiredAt = row.state === "retired" ? sql(timestamp) : "NULL";
    statements.push(
      `INSERT INTO clues (id, sequence, title, riddle, decoder_explanation, narrowing_summary, internal_napkin_note, internal_numeric_score, state, decoder_mode, version, released_at, retired_at, created_at, updated_at) VALUES (${sql(row.id)}, ${row.sequence}, ${sql(row.title)}, ${sql(row.riddle)}, ${sql(row.decoderExplanation)}, ${sql(row.narrowingSummary)}, ${sql(row.internalNapkinNote)}, ${row.internalScore}, ${sql(row.state)}, ${sql(row.decoderMode)}, 1, ${releasedAt}, ${retiredAt}, ${sql(timestamp)}, ${sql(timestamp)});`,
      `INSERT INTO clue_events (id, clue_id, actor_type, actor_subject, action, details_json, notification_key, clue_version, occurred_at) VALUES (${sql(`seed-${row.id}-v1`)}, ${sql(row.id)}, 'system', 'controller-private-import', 'created', '{}', NULL, 1, ${sql(timestamp)});`,
      `INSERT INTO audit_events (id, actor_subject, action, target_kind, target_id, metadata_json, occurred_at) VALUES (${sql(`seed-audit-${row.id}-v1`)}, 'controller-private-import', 'clue.created', 'clue', ${sql(row.id)}, '{"version":1}', ${sql(timestamp)});`,
    );
  }
  return `${statements.join("\n")}\n`;
}

export function reconcileExistingClues(seed, existing) {
  const byId = new Map(existing.map((row) => [String(row.id), row]));
  const bySequence = new Map(existing.map((row) => [Number(row.sequence), row]));
  for (const row of existing) {
    const expected = seed.find((candidate) => candidate.id === row.id);
    if (!expected || expected.sequence !== Number(row.sequence)) {
      throw new Error(`The target ledger conflicts with the approved private seed at sequence ${row.sequence}.`);
    }
    if (!Number.isInteger(Number(row.version)) || Number(row.version) < 1) throw new Error(`The target ledger has an invalid version at sequence ${row.sequence}.`);
    if (Number(row.version) === 1) {
      const reviewedFields = [
        "title", "riddle", "decoderExplanation", "narrowingSummary", "internalNapkinNote",
        "internalScore", "state", "decoderMode",
      ];
      if (reviewedFields.some((field) => row[field] !== expected[field])) {
        throw new Error(`The target ledger has changed untouched seed content at sequence ${row.sequence}.`);
      }
    }
  }
  for (const row of seed) {
    const sameSequence = bySequence.get(row.sequence);
    if (sameSequence && String(sameSequence.id) !== row.id) throw new Error(`The target ledger uses sequence ${row.sequence} for another record.`);
  }
  return seed.filter((row) => !byId.has(row.id));
}

export function findPrivateClueLeak(seed, files, options = {}) {
  const alwaysPrivateFields = ["decoderExplanation", "narrowingSummary", "internalNapkinNote"];
  const knownPublicFacts = typeof options.knownPublicFacts === "string" ? options.knownPublicFacts : "";
  for (const row of seed) {
    const secretFields = row.sequence === 1
      ? alwaysPrivateFields
      : ["title", "riddle", ...alwaysPrivateFields];
    for (const field of secretFields) {
      const value = String(row[field] ?? "").trim();
      if (value.length < 4) continue;
      if (field === "title" && knownPublicFacts.includes(value)) continue;
      for (const file of files) {
        if (file.contents.includes(value)) return { sequence: row.sequence, field, file: file.path };
      }
    }
  }
  return null;
}

export function wranglerNodeInvocation(root, args) {
  return {
    file: process.execPath,
    args: [path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), ...args],
  };
}

export function requireEnvironmentSentinel(environment, rows) {
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || row.environment !== environment) {
    throw new Error(`The D1 environment sentinel does not identify ${environment}; no import is allowed.`);
  }
  return row;
}
