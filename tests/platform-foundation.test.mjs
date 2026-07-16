import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the campaign builds through an allowlisted Cloudflare application pipeline", () => {
  const packagePath = path.join(repo, "package.json");
  assert.equal(fs.existsSync(packagePath), true, "package.json must define the build pipeline");

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assert.equal(pkg.private, true);
  assert.match(pkg.scripts?.build ?? "", /scripts\/build\.mjs/);
  assert.ok(pkg.scripts?.test, "test script is required");
  assert.ok(pkg.scripts?.typecheck, "typecheck script is required");
  assert.equal(fs.existsSync(path.join(repo, "scripts", "build.mjs")), true);
  assert.equal(fs.existsSync(path.join(repo, "src", "worker.ts")), true);
  assert.equal(fs.existsSync(path.join(repo, "src", "media-worker.ts")), true);
});

test("the route video fits Cloudflare Pages' per-file limit", () => {
  const video = fs.statSync(path.join(repo, "assets", "route", "route-video.mp4"));
  assert.ok(video.size < 25 * 1024 * 1024, `route video is ${video.size} bytes`);
});

test("generated output and local identity configuration cannot enter the public repo", () => {
  const ignore = fs.readFileSync(path.join(repo, ".gitignore"), "utf8");
  for (const required of ["dist/", "dist-media/", "node_modules/", ".dev.vars", ".env", ".env.*", ".env.local"]) {
    assert.match(ignore, new RegExp(`(^|\\n)${required.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}($|\\n)`));
  }
});

test("the deployment allowlist contains every approved public and staff entry point", () => {
  const buildScript = fs.readFileSync(path.join(repo, "scripts", "build.mjs"), "utf8");
  for (const file of [
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
  ]) {
    assert.match(buildScript, new RegExp(`["]${file.replace(".", "\\.")}["]`), `${file} is allowlisted`);
  }
});
