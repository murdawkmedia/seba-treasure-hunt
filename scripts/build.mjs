import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { CAMPAIGN_PAGES, renderCampaignPage } from "./campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDirectoryOverride(name, fallback) {
  const value = process.env[name];
  if (!value) return { path: fallback, overridden: false };
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return { path: path.resolve(value), overridden: true };
}

function containsPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function pathsOverlap(first, second) {
  return containsPath(first, second) || containsPath(second, first);
}

const distConfig = resolveDirectoryOverride(
  "TIM_LOST_BUILD_DIST_DIR",
  path.join(root, "dist"),
);
const mediaDistConfig = resolveDirectoryOverride(
  "TIM_LOST_BUILD_MEDIA_DIST_DIR",
  path.join(root, "dist-media"),
);
const pageSourceConfig = resolveDirectoryOverride(
  "TIM_LOST_BUILD_PAGE_SOURCE_DIR",
  root,
);

for (const output of [distConfig, mediaDistConfig]) {
  if (output.overridden && pathsOverlap(output.path, root)) {
    throw new Error("Build output overrides must not overlap the source repository");
  }
}
if (pathsOverlap(distConfig.path, mediaDistConfig.path)) {
  throw new Error("Public and media build outputs must not overlap");
}

const dist = distConfig.path;
const mediaDist = mediaDistConfig.path;
const pageSource = pageSourceConfig.path;

// Equivalent to `npm run legal:verify`, without invoking a platform shell.
execFileSync(process.execPath, [path.join(root, "scripts", "generate-waiver.mjs"), "--check"], {
  cwd: root,
  stdio: "inherit"
});

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
  "sponsors.html",
  "ops.html",
  "favicon.ico",
  "site.webmanifest",
  "robots.txt",
  "sitemap.xml"
];
const staticDirectories = ["assets", "css", "js"];

const renderedCampaignPages = new Map();
for (const file of Object.keys(CAMPAIGN_PAGES)) {
  const html = await readFile(path.join(pageSource, file), "utf8");
  renderedCampaignPages.set(file, renderCampaignPage(html, file));
}

await Promise.all([
  rm(dist, { recursive: true, force: true }),
  rm(mediaDist, { recursive: true, force: true })
]);
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

const clientDirectory = path.join(root, "src", "client");
const clientEntries = [];
try {
  for (const entry of await readdir(clientDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
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
  logLevel: "info"
};

await build({
  ...common,
  entryPoints: [path.join(root, "src", "worker.ts")],
  outfile: path.join(dist, "_worker.js"),
  platform: "neutral",
  // Clerk's standards-based webhook verifier depends on a CommonJS package that
  // exposes only `main`; neutral builds do not consult it unless requested.
  mainFields: ["module", "main"],
  conditions: ["worker", "browser"]
});

await build({
  ...common,
  entryPoints: [path.join(root, "src", "media-worker.ts")],
  outfile: path.join(mediaDist, "worker.js"),
  platform: "neutral",
  conditions: ["worker", "browser"]
});

if (clientEntries.length > 0) {
  await build({
    ...common,
    entryPoints: clientEntries,
    outdir: path.join(dist, "assets", "app"),
    platform: "browser",
    splitting: true,
    entryNames: "[name]"
  });
}
