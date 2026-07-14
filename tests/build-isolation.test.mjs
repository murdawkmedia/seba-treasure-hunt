import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSite } from "../scripts/build.mjs";
import { CAMPAIGN_PAGES, renderCampaignPage } from "../scripts/campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDist = path.join(root, "dist");
const mediaDist = path.join(root, "dist-media");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function snapshotTree(directory) {
  if (!existsSync(directory)) return null;
  const entries = [];

  function visit(current, relative = "") {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name))) {
      const entryPath = path.join(current, entry.name);
      const entryRelative = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) {
        entries.push([entryRelative, "link", readlinkSync(entryPath)]);
      } else if (entry.isDirectory()) {
        entries.push([entryRelative, "directory"]);
        visit(entryPath, entryRelative);
      } else {
        entries.push([entryRelative, "file", sha256(readFileSync(entryPath))]);
      }
    }
  }

  visit(directory);
  return entries;
}

function snapshotRepositoryOutputs() {
  return {
    public: snapshotTree(publicDist),
    media: snapshotTree(mediaDist),
  };
}

async function withTemporaryBuild(options, callback) {
  const result = await buildSite({ temporary: true, ...options });
  try {
    return await callback(result);
  } finally {
    await result.cleanup();
  }
}

test("imported builds use owned temporary outputs without touching repository dist", async () => {
  const before = snapshotRepositoryOutputs();

  await withTemporaryBuild({}, async ({ dist, mediaDist: isolatedMedia }) => {
    assert.notEqual(dist, publicDist);
    assert.notEqual(isolatedMedia, mediaDist);
    for (const filename of Object.keys(CAMPAIGN_PAGES)) {
      const html = readFileSync(path.join(dist, filename), "utf8");
      assert.match(html, /class="campaign-header"/, `${filename} has a rendered header`);
      assert.doesNotMatch(html, /CAMPAIGN_SHELL|CAMPAIGN_FOOTER/);
    }
    const sourceOps = readFileSync(path.join(root, "ops.html"), "utf8");
    assert.equal(readFileSync(path.join(dist, "ops.html"), "utf8"), sourceOps);
    assert.doesNotMatch(sourceOps, /class="campaign-header"/);
    assert.ok(readdirSync(isolatedMedia).length > 0);
  });

  assert.deepEqual(snapshotRepositoryOutputs(), before);
});

test("invalid in-memory nonlegal input fails before any output mutation", async () => {
  const before = snapshotRepositoryOutputs();
  const start = readFileSync(path.join(root, "start.html"), "utf8");

  await assert.rejects(() =>
    buildSite({
      temporary: true,
      campaignSourceOverrides: new Map([
        ["start.html", start.replace("<!-- CAMPAIGN_FOOTER -->", "")],
      ]),
    }),
  );

  assert.deepEqual(snapshotRepositoryOutputs(), before);
});

test("in-memory overrides cannot replace authoritative privacy or waiver sources", async () => {
  for (const filename of ["privacy.html", "waiver.html"]) {
    await assert.rejects(
      () => buildSite({
        temporary: true,
        campaignSourceOverrides: new Map([[filename, "<!doctype html><p>not legal</p>"]]),
      }),
      /authoritative legal/i,
    );
  }
});

test("legacy environment variables cannot select legal sources or build outputs", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "tim-lost-env-bypass-"));
  const alternatePages = path.join(fixture, "alternate-pages");
  const attemptedPublic = path.join(fixture, "attempted-public");
  const attemptedMedia = path.join(fixture, "attempted-media");
  mkdirSync(alternatePages);
  mkdirSync(attemptedPublic);
  mkdirSync(attemptedMedia);
  writeFileSync(path.join(alternatePages, "privacy.html"), "ENV PRIVACY BYPASS", "utf8");
  writeFileSync(path.join(alternatePages, "waiver.html"), "ENV WAIVER BYPASS", "utf8");
  writeFileSync(path.join(attemptedPublic, "sentinel.txt"), "public sentinel", "utf8");
  writeFileSync(path.join(attemptedMedia, "sentinel.txt"), "media sentinel", "utf8");
  const before = snapshotTree(fixture);
  const names = {
    TIM_LOST_BUILD_PAGE_SOURCE_DIR: alternatePages,
    TIM_LOST_BUILD_DIST_DIR: attemptedPublic,
    TIM_LOST_BUILD_MEDIA_DIST_DIR: attemptedMedia,
  };
  const previous = Object.fromEntries(
    Object.keys(names).map((name) => [name, process.env[name]]),
  );

  try {
    Object.assign(process.env, names);
    await withTemporaryBuild({}, async ({ dist }) => {
      for (const filename of ["privacy.html", "waiver.html"]) {
        const expected = renderCampaignPage(
          readFileSync(path.join(root, filename), "utf8"),
          filename,
        );
        assert.equal(readFileSync(path.join(dist, filename), "utf8"), expected);
      }
    });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.deepEqual(snapshotTree(fixture), before);
  rmSync(fixture, { recursive: true, force: true });
});

test("caller-supplied deletion paths are rejected before sentinel mutation", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "tim-lost-path-guard-"));
  const sentinelRoot = path.join(fixture, "sentinel-tree");
  const nested = path.join(sentinelRoot, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(path.join(nested, "sentinel.txt"), "do not delete", "utf8");
  const junction = path.join(fixture, "junction-alias");
  let junctionPath = null;
  try {
    symlinkSync(sentinelRoot, junction, process.platform === "win32" ? "junction" : "dir");
    junctionPath = path.join(junction, "nested");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  }
  const namespaceAlias = process.platform === "win32"
    ? `\\\\?\\${sentinelRoot}`
    : sentinelRoot;
  const before = snapshotTree(sentinelRoot);
  const attempts = [
    { dist: namespaceAlias, mediaDist: path.join(fixture, "media") },
    ...(junctionPath ? [{ dist: junctionPath, mediaDist: path.join(fixture, "media") }] : []),
    { dist: root, mediaDist: path.join(fixture, "media") },
    { dist: path.dirname(root), mediaDist: path.join(fixture, "media") },
    { dist: path.join(root, "nested-output"), mediaDist: path.join(fixture, "media") },
    { dist: path.parse(root).root, mediaDist: path.join(fixture, "media") },
    { dist: nested, mediaDist: nested },
    { dist: sentinelRoot, mediaDist: nested },
  ];

  for (const paths of attempts) {
    await assert.rejects(
      () => buildSite({ temporary: true, ...paths }),
      /unsupported build option/i,
    );
    assert.deepEqual(snapshotTree(sentinelRoot), before);
  }

  rmSync(fixture, { recursive: true, force: true });
});

test("legal verification and campaign preflight precede output preparation", () => {
  const source = readFileSync(path.join(root, "scripts", "build.mjs"), "utf8");
  const buildStart = source.indexOf("export async function buildSite");
  const legal = source.indexOf("await verifyLegalDocuments()", buildStart);
  const campaign = source.indexOf("await preflightCampaignPages", buildStart);
  const output = source.indexOf("await createTemporaryOutput", buildStart);

  assert.ok(buildStart !== -1 && legal > buildStart);
  assert.ok(campaign > legal, "campaign preflight follows legal verification");
  assert.ok(output > campaign, "output preparation follows all preflight checks");
});
