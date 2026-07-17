import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAMPAIGN_PAGES, renderCampaignPage } from "./campaign-shell.mjs";

const modulePath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(modulePath), "..");
const legalPages = new Set(["privacy.html", "waiver.html"]);

const staticFiles = [
  "index.html",
  "route.html",
  "interview.html",
  "start.html",
  "dashboard.html",
  "updates.html",
  "report.html",
  "rules.html",
  "privacy.html",
  "waiver.html",
  "community-guidelines.html",
  "clue-board.html",
  "ops.html",
  "favicon.ico",
  "site.webmanifest",
  "robots.txt",
  "sitemap.xml",
];
const staticDirectories = ["assets", "css", "js"];

function normalizeOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Build options must be an object");
  }

  const supported = new Set(["temporary", "campaignSourceOverrides"]);
  const unknown = Object.keys(options).find((key) => !supported.has(key));
  if (unknown) throw new Error(`Unsupported build option: ${unknown}`);
  const temporaryOption = options.temporary;
  const sourceOverridesOption = options.campaignSourceOverrides;
  if (temporaryOption !== undefined && typeof temporaryOption !== "boolean") {
    throw new TypeError("Build option temporary must be a boolean");
  }
  if (
    sourceOverridesOption !== undefined &&
    !(sourceOverridesOption instanceof Map)
  ) {
    throw new TypeError("Build option campaignSourceOverrides must be a Map");
  }
  const temporary = temporaryOption === true;
  const campaignSourceOverrides = new Map(sourceOverridesOption);
  if (sourceOverridesOption && !temporary) {
    throw new Error("Campaign source overrides are available only for temporary builds");
  }
  for (const [filename, html] of campaignSourceOverrides) {
    if (!Object.hasOwn(CAMPAIGN_PAGES, filename)) {
      throw new Error(`Campaign source override is not registered: ${filename}`);
    }
    if (legalPages.has(filename)) {
      throw new Error(`${filename} has an authoritative legal source and cannot be overridden`);
    }
    if (typeof html !== "string") {
      throw new TypeError(`Campaign source override for ${filename} must be a string`);
    }
  }

  return Object.freeze({ temporary, campaignSourceOverrides });
}

function verifyLegalDocuments() {
  // Equivalent to `npm run legal:verify`, without invoking a platform shell.
  execFileSync(
    process.execPath,
    [path.join(root, "scripts", "generate-waiver.mjs"), "--check"],
    { cwd: root, stdio: "inherit" },
  );
}

async function preflightCampaignPages(sourceOverrides = new Map()) {
  const renderedPages = new Map();
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const html = sourceOverrides.has(filename)
      ? sourceOverrides.get(filename)
      : await readFile(path.join(root, filename), "utf8");
    renderedPages.set(filename, renderCampaignPage(html, filename));
  }
  return renderedPages;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function createTemporaryOutput() {
  const canonicalTemp = await realpath(tmpdir());
  const owner = await mkdtemp(path.join(canonicalTemp, "tim-lost-build-"));
  const canonicalOwner = await realpath(owner);
  const marker = path.join(canonicalOwner, ".build-owner");
  const token = randomUUID();
  const dist = path.join(canonicalOwner, "dist");
  const mediaDist = path.join(canonicalOwner, "dist-media");
  await writeFile(marker, token, { encoding: "utf8", flag: "wx" });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;

    const currentOwner = await realpath(owner);
    const ownerStat = await lstat(owner);
    if (currentOwner !== canonicalOwner || ownerStat.isSymbolicLink()) {
      throw new Error("Refusing to clean an unowned temporary build directory");
    }
    if ((await readFile(marker, "utf8")) !== token) {
      throw new Error("Refusing to clean a temporary build directory with an invalid owner marker");
    }

    for (const [expectedName, output] of [
      ["dist", dist],
      ["dist-media", mediaDist],
    ]) {
      if (
        path.dirname(output) !== canonicalOwner ||
        path.basename(output) !== expectedName
      ) {
        throw new Error("Refusing to clean an unexpected temporary build output");
      }
      try {
        const outputStat = await lstat(output);
        const canonicalOutput = await realpath(output);
        if (outputStat.isSymbolicLink() || !isInside(canonicalOwner, canonicalOutput)) {
          throw new Error("Refusing to clean an aliased temporary build output");
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    await rm(canonicalOwner, { recursive: true });
    cleaned = true;
  };

  return { dist, mediaDist, cleanup };
}

async function emitBuild({ dist, mediaDist, renderedCampaignPages }) {
  await Promise.all([mkdir(dist, { recursive: true }), mkdir(mediaDist, { recursive: true })]);

  for (const file of staticFiles) {
    const target = path.join(dist, file);
    if (renderedCampaignPages.has(file)) {
      await writeFile(target, renderedCampaignPages.get(file), "utf8");
    } else {
      await cp(path.join(root, file), target);
    }
  }
  for (const directory of staticDirectories) {
    await cp(path.join(root, directory), path.join(dist, directory), { recursive: true });
  }
  await rm(path.join(dist, "css", "sponsors.css"), { force: true });

  const clientDirectory = path.join(root, "src", "client");
  const clientEntries = [];
  try {
    for (const entry of await readdir(clientDirectory, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !["sponsors.ts", "sponsor-submission.ts"].includes(entry.name)
      ) {
        clientEntries.push(path.join(clientDirectory, entry.name));
      }
    }
  } catch {
    // Client entries are introduced incrementally; an empty directory is valid.
  }

  const common = {
    bundle: true,
    format: "esm",
    target: "es2023",
    minify: true,
    sourcemap: false,
    logLevel: "info",
  };

  await build({
    ...common,
    entryPoints: [path.join(root, "src", "worker.ts")],
    outfile: path.join(dist, "_worker.js"),
    platform: "neutral",
    // Clerk's standards-based webhook verifier depends on a CommonJS package that
    // exposes only `main`; neutral builds do not consult it unless requested.
    mainFields: ["module", "main"],
    conditions: ["worker", "browser"],
  });

  await build({
    ...common,
    entryPoints: [path.join(root, "src", "media-worker.ts")],
    outfile: path.join(mediaDist, "worker.js"),
    platform: "neutral",
    conditions: ["worker", "browser"],
  });

  if (clientEntries.length > 0) {
    await build({
      ...common,
      entryPoints: clientEntries,
      outdir: path.join(dist, "assets", "app"),
      platform: "browser",
      splitting: true,
      entryNames: "[name]",
    });
  }
}

export async function buildSite(options = {}) {
  const config = normalizeOptions(options);
  await verifyLegalDocuments();
  const renderedCampaignPages = await preflightCampaignPages(
    config.campaignSourceOverrides,
  );

  let outputs;
  if (config.temporary) {
    outputs = await createTemporaryOutput();
  } else {
    const dist = path.join(root, "dist");
    const mediaDist = path.join(root, "dist-media");
    await Promise.all([
      rm(dist, { recursive: true, force: true }),
      rm(mediaDist, { recursive: true, force: true }),
    ]);
    outputs = { dist, mediaDist, cleanup: async () => {} };
  }

  try {
    await emitBuild({ ...outputs, renderedCampaignPages });
    return outputs;
  } catch (error) {
    if (config.temporary) await outputs.cleanup();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  await buildSite();
}
