import { build } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const mediaDist = path.join(root, "dist-media");

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
  "community-guidelines.html",
  "clue-board.html",
  "ops.html",
  "favicon.ico",
  "site.webmanifest",
  "robots.txt",
  "sitemap.xml"
];
const staticDirectories = ["assets", "css", "js"];

await Promise.all([
  rm(dist, { recursive: true, force: true }),
  rm(mediaDist, { recursive: true, force: true })
]);
await Promise.all([mkdir(dist, { recursive: true }), mkdir(mediaDist, { recursive: true })]);

for (const file of staticFiles) {
  await cp(path.join(root, file), path.join(dist, file));
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
