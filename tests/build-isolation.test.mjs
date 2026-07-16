import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
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
import {
  CAMPAIGN_MENU,
  CAMPAIGN_PAGES,
  renderCampaignPage,
  scanCampaignHtmlStartTags,
} from "../scripts/campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDist = path.join(root, "dist");
const mediaDist = path.join(root, "dist-media");

const legacyShellClasses = Object.freeze([
  "topbar",
  "footer",
  "hunter-header",
  "hunter-nav",
  "hunter-footer",
  "board-topbar",
  "board-brand",
  "board-menu-toggle",
  "board-nav",
  "board-footer",
  "case-signal",
  "sponsor-topbar",
  "sponsor-footer",
  "site-header",
  "site-footer",
]);

const expectedShellLinks = Object.freeze([
  "#main",
  "/updates",
  "/",
  ...CAMPAIGN_MENU.map((item) => item.href),
  "/privacy",
  "/waiver",
  "/community-guidelines",
  "/rules",
  "/sponsors",
]);

function liveAttributeValues(html, name) {
  return scanCampaignHtmlStartTags(html)
    .flatMap((tag) => tag.attributes)
    .filter((attribute) => attribute.name === name)
    .map((attribute) => attribute.value);
}

function classTokens(html) {
  return liveAttributeValues(html, "class")
    .flatMap((value) => value
      .split(/[\t\n\f\r ]+/)
      .filter(Boolean));
}

function renderedShell(html, filename) {
  const fragments = [
    html.match(/<a class="skip-link"[\s\S]*?<\/a>/)?.[0],
    html.match(/<section class="case-strip"[\s\S]*?<\/section>/)?.[0],
    html.match(/<header class="campaign-header"[\s\S]*?<\/header>/)?.[0],
    html.match(/<footer class="campaign-footer"[\s\S]*?<\/footer>/)?.[0],
  ];
  for (const fragment of fragments) assert.ok(fragment, `${filename} has every canonical shell region`);
  return fragments.join("\n");
}

function primaryNav(html) {
  return html.match(/<nav class="campaign-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
}

function assertCanonicalShellLinks(html, filename) {
  const hrefs = liveAttributeValues(renderedShell(html, filename), "href");
  assert.equal(
    hrefs.length,
    expectedShellLinks.length,
    `${filename} expected ${expectedShellLinks.length} shell links`,
  );
  for (const href of hrefs) {
    assert.equal(typeof href, "string", `${filename} shell href has a value`);
    assert.match(href, /^(?:\/(?!\/)|https?:\/\/|#)/i, `${filename} shell link is root-relative: ${href}`);
    assert.doesNotMatch(href, /\.html(?:$|[?#])/i, `${filename} shell link omits .html: ${href}`);
  }
  assert.deepEqual(hrefs, expectedShellLinks, `${filename} has the exact canonical shell links`);
}

function expectedCurrentCount(filename) {
  if (filename === "index.html") return 0;
  if (filename === "rules.html" || filename === "sponsors.html") return 2;
  return 1;
}

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

function backupRepositoryOutputs() {
  const backupRoot = mkdtempSync(path.join(tmpdir(), "tim-lost-repo-output-backup-"));
  const outputs = [
    [publicDist, path.join(backupRoot, "dist")],
    [mediaDist, path.join(backupRoot, "dist-media")],
  ];
  const present = new Map();
  for (const [output, backup] of outputs) {
    const exists = existsSync(output);
    present.set(output, exists);
    if (exists) cpSync(output, backup, { recursive: true });
  }

  return () => {
    for (const [output, backup] of outputs) {
      rmSync(output, { recursive: true, force: true });
      if (present.get(output)) cpSync(backup, output, { recursive: true });
    }
    rmSync(backupRoot, { recursive: true, force: true });
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

test("shell link validation handles every attribute form and rejects bypasses", () => {
  const source = readFileSync(path.join(root, "route.html"), "utf8");
  const rendered = renderCampaignPage(source, "route.html");
  const alternateValidForms = rendered
    .replace('href="/updates"', "HREF = '/updates'")
    .replace('href="/"', "href=/");

  assert.doesNotThrow(() => assertCanonicalShellLinks(alternateValidForms, "route.html"));
  for (const unsafe of [
    rendered.replace('href="/updates"', "HREF = 'updates.html'"),
    rendered.replace('href="/"', "href=relative"),
    rendered.replace('href="/privacy"', "HrEf = '//evil.example'"),
  ]) {
    assert.throws(
      () => assertCanonicalShellLinks(unsafe, "route.html"),
      /shell link|root-relative|expected/i,
    );
  }
  assert.throws(
    () => assertCanonicalShellLinks(rendered.replace(/<a[^>]+href="\/sponsors"[^>]*>Sponsors<\/a>/, ""), "route.html"),
    /expected 17 shell links/i,
  );
});

test("imported builds use owned temporary outputs without touching repository dist", async () => {
  const before = snapshotRepositoryOutputs();

  await withTemporaryBuild({}, async ({ dist, mediaDist: isolatedMedia }) => {
    assert.notEqual(dist, publicDist);
    assert.notEqual(isolatedMedia, mediaDist);
    for (const filename of Object.keys(CAMPAIGN_PAGES)) {
      const html = readFileSync(path.join(dist, filename), "utf8");
      const tokens = new Set(classTokens(html));

      assert.match(html, /class="campaign-header"/, `${filename} has a rendered header`);
      assert.doesNotMatch(html, /CAMPAIGN_(?:SHELL|FOOTER)/, `${filename} has no source marker`);
      for (const className of legacyShellClasses) {
        assert.equal(tokens.has(className), false, `${filename} excludes legacy class ${className}`);
      }
      assertCanonicalShellLinks(html, filename);
      assert.equal(
        (html.match(/aria-current="page"/g) ?? []).length,
        expectedCurrentCount(filename),
        `${filename} has the approved full-page current-state count`,
      );
      assert.equal(
        (primaryNav(html).match(/aria-current="page"/g) ?? []).length,
        CAMPAIGN_MENU.some((item) => item.route === CAMPAIGN_PAGES[filename]) ? 1 : 0,
        `${filename} primary navigation has only its matching current state`,
      );
    }
    assert.equal(existsSync(path.join(dist, "css", "campaign-shell.css")), true);
    const sourceOps = readFileSync(path.join(root, "ops.html"), "utf8");
    assert.equal(readFileSync(path.join(dist, "ops.html"), "utf8"), sourceOps);
    assert.doesNotMatch(sourceOps, /class="campaign-header"/);
    assert.ok(readdirSync(isolatedMedia).length > 0);
  });

  assert.deepEqual(snapshotRepositoryOutputs(), before);
});

test("caller mutation cannot switch an in-flight temporary build to repository outputs", async () => {
  const restore = backupRepositoryOutputs();
  const publicSentinel = path.join(publicDist, ".async-options-race-sentinel");
  const mediaSentinel = path.join(mediaDist, ".async-options-race-sentinel");
  let result;
  let observed;

  try {
    mkdirSync(publicDist, { recursive: true });
    mkdirSync(mediaDist, { recursive: true });
    writeFileSync(publicSentinel, "public output must survive", "utf8");
    writeFileSync(mediaSentinel, "media output must survive", "utf8");
    const options = { temporary: true };
    const pendingBuild = buildSite(options);
    queueMicrotask(() => {
      options.temporary = false;
    });

    result = await pendingBuild;
    observed = {
      dist: result.dist,
      mediaDist: result.mediaDist,
      publicSentinel: existsSync(publicSentinel)
        ? readFileSync(publicSentinel, "utf8")
        : null,
      mediaSentinel: existsSync(mediaSentinel)
        ? readFileSync(mediaSentinel, "utf8")
        : null,
    };
  } finally {
    if (result && result.dist !== publicDist) await result.cleanup();
    restore();
  }

  assert.notEqual(observed.dist, publicDist);
  assert.notEqual(observed.mediaDist, mediaDist);
  assert.equal(observed.publicSentinel, "public output must survive");
  assert.equal(observed.mediaSentinel, "media output must survive");
});

test("caller Map mutation cannot change legal sources after build validation", async () => {
  const before = snapshotRepositoryOutputs();
  const overrides = new Map();
  const options = { temporary: true, campaignSourceOverrides: overrides };
  const expectedLegal = new Map();
  const mutatedLegal = new Map();
  for (const filename of ["privacy.html", "waiver.html"]) {
    const source = readFileSync(path.join(root, filename), "utf8");
    expectedLegal.set(filename, renderCampaignPage(source, filename));
    mutatedLegal.set(
      filename,
      source.replace("</main>", `<p data-async-race="${filename}">MUTATED LEGAL</p></main>`),
    );
  }

  const pendingBuild = buildSite(options);
  queueMicrotask(() => {
    for (const [filename, html] of mutatedLegal) overrides.set(filename, html);
  });
  const result = await pendingBuild;
  const observedLegal = new Map();
  try {
    for (const filename of expectedLegal.keys()) {
      observedLegal.set(filename, readFileSync(path.join(result.dist, filename), "utf8"));
    }
  } finally {
    await result.cleanup();
  }

  assert.deepEqual(observedLegal, expectedLegal);
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
