import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  findPrivateClueLeak,
  paidClueInsertSql,
  reconcileExistingClues,
  requireEnvironmentSentinel,
  validatePrivateClueSeed,
  wranglerNodeInvocation,
} from "./paid-clue-import.mjs";

const root = path.resolve(import.meta.dirname, "..");
const privateSeedPath = path.join(root, ".private", "paid-clues.seed.ts");
const args = new Set(process.argv.slice(2));
const valueAfter = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const environment = valueAfter("--environment");
const apply = args.has("--apply");
const scanDist = args.has("--scan-dist");

if (environment !== "validation" && environment !== "production") {
  throw new Error("Use --environment validation or --environment production.");
}
if (environment === "production") {
  if (valueAfter("--confirm-production") !== "IMPORT-PAID-CLUES-INTO-PRODUCTION" ||
      process.env.PAID_CLUE_PRODUCTION_IMPORT !== "confirmed") {
    throw new Error("Any production access requires both the exact confirmation argument and PAID_CLUE_PRODUCTION_IMPORT=confirmed.");
  }
}
if (apply && !scanDist) throw new Error("An import write requires --scan-dist so sealed copy is checked before any D1 change.");

const privateModule = await import(`${pathToFileURL(privateSeedPath).href}?v=${Date.now()}`) as { PAID_CLUE_SEED?: unknown };
const seed = validatePrivateClueSeed(privateModule.PAID_CLUE_SEED) as Array<Record<string, any>>;

const wranglerArgs = (tail: string[]): string[] => [
  "d1", "execute", "DB",
  ...(environment === "validation" ? ["--env", "preview"] : []),
  "--remote", ...tail,
];
const runWrangler = (tail: string[]): string => {
  const invocation = wranglerNodeInvocation(root, wranglerArgs(tail));
  return execFileSync(invocation.file, invocation.args, {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024,
  });
};
const queryRows = (sql: string): Array<Record<string, unknown>> => {
  const output = runWrangler(["--command", sql, "--json"]);
  const parsed = JSON.parse(output) as Array<{ results?: Array<Record<string, unknown>> }>;
  return Array.isArray(parsed) && Array.isArray(parsed[0]?.results) ? parsed[0].results : [];
};
const query = (): Array<Record<string, unknown>> => queryRows(
  "SELECT id, sequence, title, riddle, decoder_explanation AS decoderExplanation, narrowing_summary AS narrowingSummary, internal_napkin_note AS internalNapkinNote, internal_numeric_score AS internalScore, state, decoder_mode AS decoderMode, version FROM clues ORDER BY sequence ASC",
);

requireEnvironmentSentinel(environment, queryRows("SELECT environment FROM environment_metadata WHERE id = 1 LIMIT 1"));
console.log(`${environment}: D1 environment sentinel verified.`);
const existing = query();
const missing = reconcileExistingClues(seed, existing);
console.log(`${environment}: ${existing.length} clue records already exist; ${missing.length} are missing.`);

if (scanDist) {
  const dist = path.join(root, "dist");
  const files: Array<{ path: string; contents: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (![".avif", ".gif", ".heic", ".ico", ".jpeg", ".jpg", ".mov", ".mp4", ".pdf", ".png", ".webp", ".woff", ".woff2", ".zip"].includes(path.extname(entry.name).toLowerCase())) {
        files.push({ path: path.relative(root, target), contents: await readFile(target, "utf8") });
      }
    }
  };
  await visit(dist);
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const binaryExtensions = new Set([".avif", ".gif", ".heic", ".ico", ".jpeg", ".jpg", ".mov", ".mp4", ".pdf", ".png", ".webp", ".woff", ".woff2", ".zip"]);
  for (const relative of tracked) {
    if (binaryExtensions.has(path.extname(relative).toLowerCase())) continue;
    files.push({ path: relative, contents: await readFile(path.join(root, relative), "utf8") });
  }
  const knownPublicFacts = await readFile(path.join(root, "route.html"), "utf8");
  const leak = findPrivateClueLeak(seed, files, { knownPublicFacts });
  if (leak) throw new Error(`Private clue leak detected: clue ${leak.sequence}, field ${leak.field}, file ${leak.file}.`);
  console.log(`Public-build privacy scan passed across ${files.length} text assets.`);
}

if (!apply) {
  console.log("Dry run only. Add --apply after the target environment and migration are verified.");
  process.exit(0);
}
if (!missing.length) {
  console.log("The clue ledger is already complete; no write was made.");
  process.exit(0);
}

const owner = await mkdtemp(path.join(tmpdir(), "tim-lost-paid-clues-"));
const sqlFile = path.join(owner, "private-clue-import.sql");
try {
  await writeFile(sqlFile, paidClueInsertSql(missing, new Date().toISOString()), { encoding: "utf8", flag: "wx" });
  runWrangler(["--file", sqlFile]);
} finally {
  await rm(owner, { recursive: true, force: true });
}
const after = query();
if (after.length !== 30 || seed.some((row) => !after.some((candidate) => candidate.id === row.id && Number(candidate.sequence) === row.sequence))) {
  throw new Error("Post-import reconciliation failed; inspect the target ledger before retrying.");
}
console.log(`${environment}: all 30 canonical clue records are present. Run the same command again to prove idempotency.`);
