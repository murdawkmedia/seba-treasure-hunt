import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import axeCore from "axe-core";
import { scanBuiltOutputPrivacy } from "./qa-output-privacy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privacyMediaVersion = "2026.3";
const privacyMediaGeneratedSource = await readFile(path.join(root, "src", "generated", "privacy-media.ts"), "utf8");
const privacyMediaHash = privacyMediaGeneratedSource.match(/hash:\s*"([a-f0-9]{64})"/)?.[1] ?? "";
assert.match(privacyMediaHash, /^[a-f0-9]{64}$/, "generated Privacy/Media 2026.3 hash must be available to isolated QA");
const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "tim-lost-waiver-qa-"));
const stagingRoot = path.join(artifactRoot, "site-source");
const distRoot = path.join(stagingRoot, "dist");
const screenshotRoot = path.join(artifactRoot, "screenshots");
const logPath = path.join(artifactRoot, "qa-log.json");
const preserveArtifacts = process.env.WAIVER_QA_PRESERVE_ARTIFACTS === "1";
const preservedArtifactAllowlist = new Set(["qa-log.json", "screenshots"]);
const excludedStageSegments = new Set([
  ".aws", ".azure", ".cache", ".cloudflare", ".git", ".gnupg", ".netlify", ".nyc_output",
  ".ssh", ".superpowers", ".vercel", ".wrangler", "coverage", "dist", "dist-media", "node_modules",
]);
const excludedStageFilePatterns = [
  /^\.env(?:\..*)?$/i,
  /^\.dev\.vars(?:\..*)?$/i,
  /^\.(?:npmrc|pypirc|yarnrc)$/i,
  /\.(?:key|pem|pfx|p12)$/i,
];
const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
  { name: "zoom", width: 720, height: 500 },
];
const routes = [
  { name: "waiver", path: "/waiver" },
  { name: "dashboard", path: "/dashboard" },
  { name: "ops", path: "/ops" },
  { name: "clue-board", path: "/clue-board" },
  { name: "report", path: "/report" },
  { name: "route", path: "/route" },
  { name: "updates", path: "/updates" },
];
const identityBootstrapPath = "/api/v1/me/bootstrap";
const allowedWritePaths = new Set([
  "/api/v1/me/bootstrap",
  "/api/v1/me/profile",
  "/api/v1/me/waiver/review",
  "/api/v1/me/waiver/accept",
  "/api/v1/me/waiver/receipt",
  "/api/v1/ops/players/hunter-1/waiver/receipt",
  "/api/v1/reports",
  "/api/v1/ops/reports/report-minor-qa-001/publish",
]);

function allowedWriteMethod(method, pathname) {
  return method === (pathname === "/api/v1/me/profile" ? "PATCH" : "POST");
}
const forbiddenExternalTargets = [
  "clerk",
  "api.resend.com",
  "cloudflare",
  "codex-validation.seba-treasure-hunt.pages.dev",
  "www.timlostsomething.com",
];
const scenarios = [
  "exact legal display and print CSS",
  "minor counts 0, 1, and 10",
  "guardian validation and focus",
  "acceptance success and reference",
  "receipt pending, sent, and failed",
  "participant receipt resend",
  "Ops receipt retry",
  "progress and waypoint boundaries",
  "note upload boundary",
  "reply privacy boundary",
  "private find report boundary",
  "report upload boundary",
  "minor signup and guardian permission",
  "signed-in report prefill",
  "thirteen waypoints plus two fallback choices",
  "signed-out route exact-link privacy",
  "thirteen authenticated exact links",
  "thirteen public route stories",
  "61 public-safe photos",
  "explicit report receipt",
  "Staff report detail",
  "one selected image and one private image",
  "explicit publish confirmation",
  "public signed-out approved report",
  "production source privacy scan",
  "rendered public output privacy scan",
  "server/Ops bundle privacy classification",
  "horizontal overflow",
  "console errors",
  "axe WCAG 2.1 A/AA",
  "zero external writes",
];
const privateFixtures = Object.freeze({
  email: "qa-private-hunter@example.test",
  adultName: "QA Private Adult",
  minorName: "QA Private Minor 01",
  birthYear: "2014",
  acceptanceId: "waiver-acceptance-qa-private-001",
  receiptJobId: "receipt-job-qa-private-001",
  providerId: "resend-provider-qa-private-001",
  credential: "qa-private-credential-sentinel",
  coordinates: "53.123456,-114.654321",
  noteEvidence: "qa-private-note-evidence",
  reportEvidence: "qa-private-report-evidence",
  childPhone: "qa-private-child-phone-780-555-0199",
  hunterSubject: "hunter-subject-qa-private-minor-001",
  unselectedMediaId: "media-unselected-qa-private-001",
  privateObjectKey: "private/report-minor-qa-001/original-private.jpg",
});
const reportFixture = Object.freeze({
  id: "report-minor-qa-001",
  selectedMediaId: "media-selected-qa-public-001",
  waypointId: 7,
  latitude: 53.548321,
  longitude: -114.468765,
  title: "A clue near waypoint seven",
  body: "A guardian-permitted young Hunter shared a useful public-safe observation.",
  publishedAt: "2026-07-15T22:30:00.000Z",
});
const publicWaypointFixtures = Object.freeze([
  { routeOrder: 1, id: 1, name: "The Creek Property — The Starting Point", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500001,-114.7300001" },
  { routeOrder: 2, id: 2, name: "The Public Beach and Farmers' Market Lot", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500002,-114.7300002" },
  { routeOrder: 3, id: 3, name: "The Beach (Randy's)", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500003,-114.7300003" },
  { routeOrder: 4, id: 4, name: "Seba Beach Seniors Centre", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5593028,-114.7359167" },
  { routeOrder: 5, id: 13, name: "Derby's Lakeview General Store", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5567361,-114.7377167" },
  { routeOrder: 6, id: 5, name: "The Gated Road and the School Grounds", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500005,-114.7300005" },
  { routeOrder: 7, id: 6, name: "The Back Trails", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500006,-114.7300006" },
  { routeOrder: 8, id: 7, name: "The Lodge Trails", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500007,-114.7300007" },
  { routeOrder: 9, id: 8, name: "The Vista Lands", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500008,-114.7300008" },
  { routeOrder: 10, id: 9, name: "The Cliff-Edge Slope", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500009,-114.7300009" },
  { routeOrder: 11, id: 10, name: "The Driving Range and Digger Café", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500010,-114.7300010" },
  { routeOrder: 12, id: 11, name: "Kokanee Springs RV — the Front Gate", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500011,-114.7300011" },
  { routeOrder: 13, id: 12, name: "The Old Seba Beach School (SebaHub)", exactUrl: "https://www.google.com/maps/search/?api=1&query=53.5500012,-114.7300012" },
]);
const privateFixtureValues = [
  ...Object.entries(privateFixtures).filter(([key]) => key !== "birthYear").map(([, value]) => value),
  `birth year ${privateFixtures.birthYear}`,
  `"birthYear":${privateFixtures.birthYear}`,
];
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"], [".xml", "application/xml; charset=utf-8"],
]);

function canonicalHash(value) {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

function jsonResponse(body, status = 200) {
  return { status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) };
}

function stagePathAllowed(relativePath) {
  if (!relativePath) return true;
  return relativePath.split(path.sep).every((segment) =>
    !excludedStageSegments.has(segment.toLowerCase())
    && !excludedStageFilePatterns.some((pattern) => pattern.test(segment)),
  );
}

async function assertStagingTreeCredentialFree(directory = stagingRoot) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(stagingRoot, absolutePath);
    assert.equal(stagePathAllowed(relativePath), true, `forbidden local credential/runtime path entered QA staging: ${relativePath}`);
    if (entry.isDirectory()) await assertStagingTreeCredentialFree(absolutePath);
  }
}

async function assertPreservedArtifactAllowlist() {
  await rm(stagingRoot, { recursive: true, force: true });
  for (const entry of await readdir(artifactRoot, { withFileTypes: true })) {
    if (!preservedArtifactAllowlist.has(entry.name)) {
      await rm(path.join(artifactRoot, entry.name), { recursive: true, force: true });
    }
  }
  const remaining = (await readdir(artifactRoot)).sort();
  assert.ok(remaining.every((name) => preservedArtifactAllowlist.has(name)), "preserved QA directory must contain only scrubbed evidence");
}

async function buildSite() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await cp(root, stagingRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source);
      return stagePathAllowed(relative);
    },
  });
  await assertStagingTreeCredentialFree();
  await symlink(path.join(root, "node_modules"), path.join(stagingRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  for (const relativePath of [
    "privacy.html", "waiver.html",
    path.join("src", "generated", "participation-waiver.ts"),
    path.join("src", "generated", "privacy-media.ts"),
  ]) {
    const absolutePath = path.join(stagingRoot, relativePath);
    const source = await readFile(absolutePath, "utf8");
    await writeFile(absolutePath, source.replace(/\r\n/g, "\n"), "utf8");
  }
  const options = { cwd: stagingRoot, encoding: "utf8", stdio: "inherit" };
  assert.ok(npmCommand === "npm.cmd" || npmCommand === "npm");
  const generation = spawnSync(process.execPath, [path.join(stagingRoot, "scripts", "generate-waiver.mjs")], options);
  assert.ifError(generation.error);
  assert.equal(generation.status, 0, "staged legal generation must succeed before the isolated build");
  const result = spawnSync(process.execPath, [path.join(stagingRoot, "scripts", "build.mjs")], options);
  assert.ifError(result.error);
  assert.equal(result.status, 0, "npm run build must succeed before waiver QA starts");
}

async function findClerkChunkPaths() {
  // Built production entries under test: assets/app/dashboard.js and assets/app/ops.js.
  const paths = new Set();
  for (const entry of ["dashboard.js", "ops.js", "board.js"]) {
    const source = await readFile(path.join(distRoot, "assets", "app", entry), "utf8");
    for (const match of source.matchAll(/import\(["']\.\/([^"']+\.js)["']\)/g)) {
      paths.add(`/assets/app/${match[1]}`);
    }
  }
  assert.ok(paths.size > 0, "built clients must retain a dynamic managed-identity provider chunk");
  return paths;
}

async function startBuiltSiteServer(serverLedger) {
  const cleanRoutes = new Map([
    ["/", "/index.html"], ["/privacy", "/privacy.html"], ["/waiver", "/waiver.html"], ["/dashboard", "/dashboard.html"],
    ["/ops", "/ops.html"], ["/clue-board", "/clue-board.html"], ["/report", "/report.html"],
    ["/route", "/route.html"],
    ["/updates", "/updates.html"],
  ]);
  const server = createServer(async (request, response) => {
    try {
      const method = request.method || "GET";
      if (method !== "GET" && method !== "HEAD") {
        serverLedger.rejectedWrites.push({ method, url: request.url });
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const mappedPath = cleanRoutes.get(requestUrl.pathname) || requestUrl.pathname;
      const absolutePath = path.resolve(distRoot, `.${decodeURIComponent(mappedPath)}`);
      if (absolutePath !== distRoot && !absolutePath.startsWith(`${distRoot}${path.sep}`)) {
        response.writeHead(403); response.end(); return;
      }
      const fileStat = await stat(absolutePath).catch(() => null);
      if (!fileStat?.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(method === "HEAD" ? undefined : "Not found");
        return;
      }
      const body = method === "HEAD" ? undefined : await readFile(absolutePath);
      serverLedger.reads.push({ method, path: requestUrl.pathname });
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": mimeTypes.get(path.extname(absolutePath).toLowerCase()) || "application/octet-stream" });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Local QA server error");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function launchBrowser() {
  try {
    return { browser: await chromium.launch({ headless: true }), source: "playwright-chromium" };
  } catch (bundledError) {
    try {
      return { browser: await chromium.launch({ channel: "chrome", headless: true }), source: "system-chrome" };
    } catch (chromeError) {
      throw new Error(`Unable to launch Playwright Chromium or Chrome. ${bundledError.message} ${chromeError.message}`);
    }
  }
}

const fakeClerkModule = `
// Test-only fake Clerk module: the built application clients still own all UI and event handlers.
export class Clerk {
  constructor() {
    this.session = { getToken: async () => "qa-local-auth-token" };
    this.user = { fullName: "QA Local User", primaryEmailAddress: { emailAddress: "qa-local-user@example.test" }, updatePassword: async () => {} };
    this.client = { signIn: { create: async () => ({ status: "complete", createdSessionId: "qa-session" }) }, signUp: { create: async () => ({ status: "complete", createdSessionId: "qa-session" }) } };
  }
  async load() {}
  async setActive() {}
  async signOut() {}
  openUserProfile() {}
}
`;

const fakeSignedOutClerkModule = `
// Test-only signed-out fake Clerk module for the public Updates verification.
export class Clerk {
  constructor() {
    this.session = null;
    this.user = null;
    const signUpAttempt = {
      status: "missing_requirements",
      createdSessionId: null,
      async prepareEmailAddressVerification() { return signUpAttempt; },
      async attemptEmailAddressVerification({ code }) {
        if (code !== "qa-minor-verification-code") throw new Error("Invalid test verification code");
        signUpAttempt.status = "complete";
        signUpAttempt.createdSessionId = "qa-minor-session";
        return signUpAttempt;
      },
    };
    this.client = {
      signIn: { create: async () => ({ status: "needs_identifier" }) },
      signUp: { create: async () => signUpAttempt },
    };
  }
  async load() {}
  async setActive({ session }) {
    this.session = { id: session, getToken: async () => "qa-local-auth-token" };
    this.user = { fullName: "QA Private Minor 01", primaryEmailAddress: { emailAddress: "qa-private-hunter@example.test" }, updatePassword: async () => {} };
  }
  async signOut() {}
  openUserProfile() {}
}
`;

function statusPayload() {
  return { data: { state: "open", hours: { opens: "09:00", closes: "20:00", timezone: "America/Edmonton" }, updatedAt: "2026-07-13T18:00:00.000Z", nextClue: null, version: 1 } };
}

function dashboardPayload(fixtureState = {}) {
  if (fixtureState.mode === "route") {
    return {
      data: {
        participationUnlocked: true,
        waypoints: publicWaypointFixtures.map((waypoint) => ({
          ...waypoint,
          zoneState: "open",
        })),
      },
    };
  }
  const minorSignupProfile = fixtureState.profileStored === true
    ? {
        fullName: privateFixtures.minorName,
        publicHandle: "@qa-young-hunter",
        townArea: "",
        interests: [],
        discoverySource: "",
        consents: { huntEmail: false, marketing: false },
        participationBasis: "minor_guardian_permission",
        guardianPermissionAttestedAt: fixtureState.guardianPermissionAttestedAt,
      }
    : null;
  return {
    data: {
      profile: minorSignupProfile ?? { fullName: privateFixtures.adultName, publicHandle: "@qa-hunter", townArea: "Seba Beach", interests: [], discoverySource: "friend", consents: { huntEmail: false, marketing: false }, adultAttestedAt: "2026-07-13T17:00:00.000Z" },
      privacyMediaRequired: false,
      participationUnlocked: fixtureState.profileStored === true ? fixtureState.signupWaiverAccepted === true : true,
      status: { state: "open" },
      latestUpdate: { title: "QA update", body: "Public-safe fixture update.", publisherName: "QA operator", publishedAt: "2026-07-13T18:00:00.000Z" },
      waypoints: [
        { id: "1", routeOrder: 1, name: "Waypoint 01", description: "Approved exact directions are available.", zoneState: "open", exactUrl: "/route#waypoint-1" },
        { id: "2", routeOrder: 2, name: "Waypoint 02", description: "This zone is restricted.", zoneState: "restricted", exactUrl: "https://example.test/restricted" },
      ],
      reports: [{ title: "Private report", createdAt: "2026-07-13T18:00:00.000Z", status: "received" }],
      notes: [{ title: "Field Note", createdAt: "2026-07-13T18:00:00.000Z", status: "pending" }],
    },
  };
}

function acceptancePayload(legalDocument, receiptStatus) {
  return {
    data: {
      acceptance: { waiver: {
        id: privateFixtures.acceptanceId,
        documentVersion: legalDocument.version,
        documentHash: legalDocument.hash,
        acceptedAt: "2026-07-13T18:00:00.000Z",
        referenceCode: "TLS-W-QA000001",
        participants: [
          { role: "adult", fullName: privateFixtures.adultName, birthYear: null, guardianAttested: false },
          { role: "minor", fullName: privateFixtures.minorName, birthYear: Number(privateFixtures.birthYear), guardianAttested: true },
        ],
        receipt: { status: receiptStatus, attempts: 1, jobId: privateFixtures.receiptJobId, providerMessageId: privateFixtures.providerId },
      } },
      document: { waiver: legalDocument },
    },
  };
}

function minorSignupAcceptancePayload(legalDocument) {
  return {
    data: {
      acceptance: { waiver: {
        id: "waiver-acceptance-qa-minor-signup-001",
        documentVersion: legalDocument.version,
        documentHash: legalDocument.hash,
        acceptedAt: "2026-07-15T23:00:00.000Z",
        referenceCode: "TLS-W-QAMINOR1",
        participants: [{ role: "minor", fullName: privateFixtures.minorName, birthYear: null, guardianAttested: true }],
        receipt: { status: "pending", attempts: 0, jobId: "receipt-job-qa-minor-signup-001", providerMessageId: null },
      } },
      document: { waiver: legalDocument },
    },
  };
}

function reportSummary() {
  return {
    id: reportFixture.id,
    type: "find",
    waypointId: reportFixture.waypointId,
    createdAt: "2026-07-15T22:00:00.000Z",
    status: "reviewing",
    mediaCount: 2,
  };
}

function reportDetail(fixtureState) {
  return {
    ...reportSummary(),
    updatedAt: "2026-07-15T22:10:00.000Z",
    hunterSubject: privateFixtures.hunterSubject,
    name: privateFixtures.minorName,
    email: privateFixtures.email,
    phone: privateFixtures.childPhone,
    privateObjectKey: privateFixtures.privateObjectKey,
    publicAttribution: "Young Hunter",
    publicationEligible: true,
    publicationEligibilityReason: "eligible",
    publication: {
      published: fixtureState.reportPublished === true,
      updateId: fixtureState.reportPublished === true ? "approved-report-minor-qa-001" : null,
    },
    locationDescription: "Near the signed waypoint marker.",
    latitude: reportFixture.latitude,
    longitude: reportFixture.longitude,
    details: privateFixtures.reportEvidence,
    assignedTo: null,
    media: [
      { id: reportFixture.selectedMediaId, contentType: "image/png", size: 68, status: "ready" },
      { id: privateFixtures.unselectedMediaId, contentType: "image/png", size: 68, status: "ready" },
    ],
  };
}

function approvedReportUpdate() {
  const reportWaypoint = publicWaypointFixtures.find(({ id }) => id === reportFixture.waypointId);
  assert.ok(reportWaypoint, "approved report fixture must resolve its stable waypoint ID");
  return {
    id: "approved-report-minor-qa-001",
    kind: "approved_report",
    title: reportFixture.title,
    body: reportFixture.body,
    publisherName: "Young Hunter",
    waypointId: reportFixture.waypointId,
    waypointRouteOrder: reportWaypoint.routeOrder,
    waypointName: reportWaypoint.name,
    latitude: reportFixture.latitude,
    longitude: reportFixture.longitude,
    media: [{
      id: reportFixture.selectedMediaId,
      url: `/api/v1/media/${reportFixture.selectedMediaId}`,
      contentType: "image/png",
    }],
    publishedAt: reportFixture.publishedAt,
  };
}

function opsReadResponse(url, legalDocument, fixtureState) {
  const pathname = url.pathname;
  if (pathname === "/api/v1/ops/session") return jsonResponse({ data: { operator: { displayName: "QA Operator", email: "qa-operator@example.test" } } });
  if (pathname === "/api/v1/ops/dashboard") return jsonResponse({ data: { status: { state: "open", updatedAt: "2026-07-13T18:00:00.000Z", version: 1 }, counts: { pendingNotes: 0, receivedReports: 1, receivedFlags: 0, activeHunters: 1 }, killSwitches: { boardVisible: true, notesEnabled: true, repliesEnabled: true } } });
  if (pathname === "/api/v1/ops/reports") return jsonResponse({ data: fixtureState.reportSubmitted ? [reportSummary()] : [] });
  if (pathname === `/api/v1/ops/reports/${reportFixture.id}`) return jsonResponse({ data: reportDetail(fixtureState) });
  if (pathname === `/api/v1/ops/reports/${reportFixture.id}/media/${reportFixture.selectedMediaId}` ||
      pathname === `/api/v1/ops/reports/${reportFixture.id}/media/${privateFixtures.unselectedMediaId}`) {
    return { status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
  }
  if (pathname === "/api/v1/ops/moderation/notes") return jsonResponse({ data: [] });
  if (pathname === "/api/v1/ops/staff") return jsonResponse({ data: [] });
  if (pathname === "/api/v1/ops/audit") return jsonResponse({ data: [] });
  if (pathname === "/api/v1/ops/players") return jsonResponse({ data: {
    counts: { verifiedAccounts: 1, completedProfiles: 1, huntEmail: 0, marketing: 0 },
    items: [{ id: "hunter-1", verifiedEmail: privateFixtures.email, accountState: "active", profileComplete: true, fullName: privateFixtures.adultName, publicHandle: "@qa-hunter", townArea: "Seba Beach", privacyMediaVersion: "2026.2", waiverStatus: "accepted", waiverVersion: legalDocument.version, acceptedAt: "2026-07-13T18:00:00.000Z", minorCount: 1, receiptStatus: "failed", participationUnlocked: true, consents: { huntEmail: false, marketing: false }, createdAt: "2026-07-13T17:00:00.000Z", updatedAt: "2026-07-13T18:00:00.000Z" }],
    page: { nextCursor: null },
  } });
  if (pathname === "/api/v1/ops/players/hunter-1/waiver") return jsonResponse({ data: {
    id: privateFixtures.acceptanceId, subject: "hunter-1", documentVersion: legalDocument.version, documentHash: legalDocument.hash,
    acceptedAt: "2026-07-13T18:00:00.000Z", referenceCode: "TLS-W-QA000001",
    participants: [
      { role: "adult", fullName: privateFixtures.adultName, birthYear: null, guardianAttested: false },
      { role: "minor", fullName: privateFixtures.minorName, birthYear: Number(privateFixtures.birthYear), guardianAttested: true },
    ],
    receipt: { status: "failed", attempts: 1, sentAt: "" },
  } });
  return null;
}

function readMockResponse(url, fixtureState, legalDocument) {
  if (url.pathname === "/api/v1/config") return jsonResponse({ data: {
    ...(fixtureState.mode === "no-key"
      ? { hunterPublishableKey: "", staffPublishableKey: "" }
      : { hunterPublishableKey: "pk_test_local_qa", staffPublishableKey: "pk_test_local_staff_qa" }),
    turnstileSiteKey: "qa-turnstile",
    privacyMediaVersion: "2026.3",
    privacyMediaHash,
    waiverVersion: legalDocument.version,
    waiverHash: legalDocument.hash,
  } });
  if (url.pathname === "/api/v1/status") return jsonResponse(statusPayload());
  if (url.pathname === "/api/v1/rules/current") return jsonResponse({ data: { id: "rules-qa", version: "qa", title: "QA rules", body: "Test-only current rules.", lastUpdatedAt: "2026-07-13T18:00:00.000Z" } });
  if (url.pathname === "/api/v1/legal/waiver") return jsonResponse({ data: legalDocument });
  if (url.pathname === "/api/v1/me/dashboard") return jsonResponse(dashboardPayload(fixtureState));
  if (url.pathname === "/api/v1/me/profile") return jsonResponse({ data: { fullName: privateFixtures.minorName, email: privateFixtures.email, publicHandle: "@qa-hunter" } });
  if (url.pathname === "/api/v1/me/waiver") {
    if (fixtureState.signupWaiverAccepted) return jsonResponse(minorSignupAcceptancePayload(legalDocument));
    return fixtureState.accepted ? jsonResponse(acceptancePayload(legalDocument, fixtureState.receiptStatus)) : jsonResponse({ data: { acceptance: null, document: { waiver: legalDocument } } });
  }
  if (url.pathname === "/api/v1/waypoints") return jsonResponse({ data: { items: publicWaypointFixtures.map(({ id, routeOrder, name }) => ({ id: String(id), routeOrder, name })) } });
  if (url.pathname === "/api/v1/updates") return jsonResponse({ data: fixtureState.reportPublished ? [approvedReportUpdate()] : [], page: { nextCursor: null } });
  if (url.pathname === `/api/v1/media/${reportFixture.selectedMediaId}` && fixtureState.reportPublished) {
    return { status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
  }
  if (url.pathname === "/api/v1/board") return jsonResponse({ data: { items: [{ id: "note-public-1", waypointId: "1", body: "A public-safe observation near the marked trail.", authorHandle: "@public-qa", createdAt: "2026-07-13T18:00:00.000Z", media: [], replies: [{ id: "reply-public-1", body: "Public-safe reply.", authorHandle: "@reply-qa", createdAt: "2026-07-13T18:05:00.000Z" }] }] }, page: { nextCursor: null } });
  return fixtureState.mode === "ops" ? opsReadResponse(url, legalDocument, fixtureState) : null;
}

function writeMockResponse(pathname, fixtureState, request) {
  if (pathname === identityBootstrapPath) {
    fixtureState.bootstrapCount = (fixtureState.bootstrapCount ?? 0) + 1;
    return jsonResponse({ data: { created: fixtureState.bootstrapCount === 1 } });
  }
  if (pathname === "/api/v1/me/profile") {
    const body = request.postDataJSON();
    assert.equal(body.participationBasis, "minor_guardian_permission");
    assert.equal(body.guardianPermissionAttested, true);
    assert.equal(body.privacyMediaAccepted, true);
    assert.equal(body.privacyMediaVersion, privacyMediaVersion);
    fixtureState.profileStored = true;
    fixtureState.participationBasis = body.participationBasis;
    fixtureState.guardianPermissionAttestedAt = "2026-07-15T22:59:00.000Z";
    fixtureState.privacyMediaVersion = body.privacyMediaVersion;
    return jsonResponse({ data: { ...body, subject: privateFixtures.hunterSubject, privacyMediaRequired: false } });
  }
  if (pathname === "/api/v1/me/waiver/review") {
    const body = request.postDataJSON();
    fixtureState.reviewedWaiverVersion = body.version;
    fixtureState.reviewedWaiverHash = body.hash;
    return jsonResponse({ data: { review: { reviewEventId: fixtureState.profileStored ? "review-qa-minor-signup-1" : "review-qa-1" } } });
  }
  if (pathname === "/api/v1/me/waiver/accept") {
    const body = request.postDataJSON();
    fixtureState.accepted = true;
    fixtureState.receiptStatus = "pending";
    if (fixtureState.profileStored) {
      assert.equal(body.version, "2026.2");
      assert.equal(body.reviewEventId, "review-qa-minor-signup-1");
      assert.deepEqual(body.minors, []);
      fixtureState.signupWaiverAccepted = true;
      fixtureState.acceptedWaiverVersion = body.version;
    }
    return jsonResponse({ data: { stored: true } });
  }
  if (pathname === "/api/v1/me/waiver/receipt") { fixtureState.receiptStatus = "sent"; return jsonResponse({ data: { receipt: { status: "sent" } } }); }
  if (pathname === "/api/v1/ops/players/hunter-1/waiver/receipt") return jsonResponse({ data: { receipt: { status: "pending" } } });
  if (pathname === "/api/v1/reports") {
    fixtureState.reportSubmitted = true;
    return jsonResponse({ data: { id: reportFixture.id, status: "received", mediaCount: 2 } }, 201);
  }
  if (pathname === `/api/v1/ops/reports/${reportFixture.id}/publish`) {
    const body = request.postDataJSON();
    assert.deepEqual(body.mediaIds, [reportFixture.selectedMediaId], "one selected image and one private image must be enforced by the browser request");
    fixtureState.reportPublished = true;
    return jsonResponse({ data: approvedReportUpdate() });
  }
  return jsonResponse({ error: { code: "unhandled_mock_write" } }, 500);
}

async function installNetworkGuard(context, localOrigin, networkLedger, legalDocument, fixtureState, clerkChunkPaths) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const isRead = method === "GET" || method === "HEAD";
    const isLocal = url.origin === localOrigin;
    const observed = { method, origin: url.origin, pathname: url.pathname, disposition: "pending" };
    networkLedger.observedRequests.push(observed);

    if (!isLocal) {
      if (!isRead) {
        observed.disposition = "blocked-external-write";
        networkLedger.externalWritesObserved.push(observed);
        networkLedger.blockedWrites.push(`Blocked non-allowlisted write ${method} ${url.href}`);
        await route.abort("blockedbyclient");
        return;
      }
      observed.disposition = "fulfilled-external-read";
      networkLedger.externalReadsFulfilledLocally.push(observed);
      await route.fulfill({ status: 200, contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/css", body: "" });
      return;
    }

    if (isRead && clerkChunkPaths.has(url.pathname)) {
      observed.disposition = "fulfilled-auth-provider-mock";
      await route.fulfill({ status: 200, contentType: "text/javascript", body: fixtureState.signedOut ? fakeSignedOutClerkModule : fakeClerkModule });
      return;
    }
    if (isRead && url.pathname.startsWith("/api/")) {
      const mock = readMockResponse(url, fixtureState, legalDocument);
      observed.disposition = "fulfilled-local-api-mock";
      await route.fulfill(mock || jsonResponse({ error: { code: "unhandled_mock_read", path: url.pathname } }, 404));
      return;
    }
    if (isRead) {
      observed.disposition = "continued-local-read";
      await route.continue();
      return;
    }
    if (allowedWritePaths.has(url.pathname) && allowedWriteMethod(method, url.pathname)) {
      observed.disposition = "fulfilled-local-write";
      networkLedger.mockedWrites.set(url.pathname, (networkLedger.mockedWrites.get(url.pathname) || 0) + 1);
      await route.fulfill(writeMockResponse(url.pathname, fixtureState, request));
      return;
    }
    observed.disposition = "blocked-local-write";
    networkLedger.blockedWrites.push(`Blocked non-allowlisted write ${method} ${url.href}`);
    await route.abort("blockedbyclient");
  });
}

async function createQaPage(browser, viewport, localOrigin, networkLedger, legalDocument, fixtureState, clerkChunkPaths) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    window.confirm = () => true;
    // Test-only Turnstile provider mock; callbacks are local and no write is permitted by this layer.
    window.turnstile = {
      render(container, options) { container.textContent = "Test-only mocked human check"; queueMicrotask(() => options.callback("qa-turnstile-token")); return `qa-widget-${Math.random()}`; },
      reset() {},
    };
  });
  await installNetworkGuard(context, localOrigin, networkLedger, legalDocument, fixtureState, clerkChunkPaths);
  const page = await context.newPage();
  const consoleProblems = [];
  page.on("console", (message) => { if (message.type() === "error") consoleProblems.push(message.text()); });
  page.on("pageerror", (error) => consoleProblems.push(error.message));
  return { context, page, consoleProblems };
}

async function goto(page, origin, pathname) {
  const response = await page.goto(`${origin}${pathname}`, { waitUntil: "networkidle" });
  assert.equal(response?.ok(), true, `${pathname} must load from the isolated built site`);
}

async function assertNoHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(result.document <= result.viewport + 1 && result.body <= result.viewport + 1, `${label} horizontal overflow: ${JSON.stringify(result)}`);
  return result;
}

async function assertNoDialogOverflow(page, label) {
  const result = await page.locator("#ops-waiver-dialog").evaluate((dialog) => ({ viewport: document.documentElement.clientWidth, left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right, width: dialog.scrollWidth, client: dialog.clientWidth }));
  assert.ok(result.left >= -1 && result.right <= result.viewport + 1 && result.width <= result.client + 1, `${label} dialog overflow: ${JSON.stringify(result)}`);
  return result;
}

async function assertAxe(page, label) {
  await page.addScriptTag({ content: axeCore.source });
  const result = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }), axeTags);
  assert.deepEqual(result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })), [], `${label} axe violations`);
  return { violations: 0, passes: result.passes.length };
}

function normalized(value) {
  return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

async function assertExactLegalDisplay(page, source, containerSelector, headingSelector) {
  const rendered = await page.evaluate(({ containerSelector: container, headingSelector: heading }) => {
    const target = document.querySelector(container);
    return {
      pageHeading: document.querySelector(heading)?.textContent || "",
      introductoryParagraphs: [...(target?.querySelectorAll(":scope > p") || [])].map((paragraph) => paragraph.textContent || ""),
      sections: [...(target?.querySelectorAll(":scope > section") || [])].map((section) => ({
        heading: section.querySelector(":scope > h2, :scope > h4")?.textContent || "",
        blocks: [...section.children].slice(1).map((block) => block.tagName === "UL"
          ? { kind: "list", items: [...block.querySelectorAll(":scope > li")].map((item) => item.textContent || "") }
          : { kind: "paragraph", text: block.textContent || "" }),
      })),
    };
  }, { containerSelector, headingSelector });
  assert.equal(normalized(rendered.pageHeading), source.title, "exact legal display must retain the canonical title");
  assert.ok(rendered.introductoryParagraphs.map(normalized).includes(source.intro), "exact legal display must retain the canonical introduction");
  assert.deepEqual(rendered.sections.map((section) => ({
    heading: normalized(section.heading),
    blocks: section.blocks.map((block) => block.kind === "list" ? { kind: "list", items: block.items.map(normalized) } : { kind: "paragraph", text: normalized(block.text) }),
  })), source.sections.map((section) => ({ heading: `${section.number}. ${section.title}`, blocks: section.blocks })));
}

async function assertPrintCss(page, surface) {
  await page.emulateMedia({ media: "print" });
  const state = await page.locator(surface).evaluate((element) => ({ display: getComputedStyle(element).display, overflow: getComputedStyle(element).overflow, height: element.scrollHeight }));
  assert.notEqual(state.display, "none");
  const css = await readFile(path.join(distRoot, "css", "hunter.css"), "utf8");
  assert.match(css, /@media print/);
  await page.emulateMedia({ media: "screen" });
  return state;
}

async function exerciseMinorSignupGate(page, fixtureState, legalDocument) {
  const signup = page.locator("#hunter-sign-up-form");
  const signIn = page.locator("#hunter-sign-in-form");
  const createAccountControl = page.locator('[data-show-auth="hunter-sign-up-form"]');
  await signIn.waitFor({ state: "visible" });
  assert.equal(await signup.isHidden(), true, "signup must start hidden behind the production Create account control");
  await createAccountControl.click();
  await signup.waitFor({ state: "visible" });
  assert.equal(await signIn.isHidden(), true, "Create account must transition away from the sign-in form");
  assert.equal(await signup.locator('[name="fullName"]').evaluate((element) => element === document.activeElement), true, "Create account must focus the first signup field");
  await signup.locator('[name="fullName"]').fill(privateFixtures.minorName);
  await signup.locator('[name="email"]').fill(privateFixtures.email);
  await signup.locator('[name="password"]').fill("QA-guardian-password-2026");
  await signup.locator('[name="confirmPassword"]').fill("QA-guardian-password-2026");
  await signup.locator('[name="participationBasis"][value="minor_guardian_permission"]').check();
  await signup.locator("[data-guardian-permission]").waitFor({ state: "visible" });
  await signup.locator('button[type="submit"]').click();
  assert.match(await signup.locator("[data-signup-errors]").innerText(), /parent or legal guardian/i, "minor signup and guardian permission must fail closed until attested");
  await signup.locator('[name="guardianPermissionAttested"]').check();
  assert.equal(await signup.locator('[name="guardianPermissionAttested"]').isChecked(), true);
  await signup.locator('[data-signup-review="privacy-media"]').click();
  const privacyDialog = page.locator('[data-signup-dialog="privacy-media"]');
  await privacyDialog.waitFor({ state: "visible" });
  assert.equal(await signup.getAttribute("data-privacy-media-version"), privacyMediaVersion);
  assert.equal(await signup.locator('[name="privacyMediaAccepted"]').isEnabled(), true);
  await privacyDialog.locator("[data-signup-dialog-close]").click();
  await signup.locator('[data-signup-review="waiver"]').click();
  const waiverDialog = page.locator('[data-signup-dialog="waiver"]');
  await waiverDialog.waitFor({ state: "visible" });
  assert.equal(await signup.getAttribute("data-waiver-version"), "2026.2");
  assert.equal(await signup.locator('[name="waiverAccepted"]').isEnabled(), true);
  await waiverDialog.locator("[data-signup-dialog-close]").click();
  await signup.locator('[name="privacyMediaAccepted"]').check();
  await signup.locator('[name="waiverAccepted"]').check();
  await signup.locator('button[type="submit"]').click();
  const verify = page.locator("#hunter-verify-form");
  await verify.waitFor({ state: "visible" });
  assert.match(await page.locator("[data-auth-message]").innerText(), /verification code/i);
  await verify.locator('[name="code"]').fill("qa-minor-verification-code");
  await verify.locator('button[type="submit"]').click();
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  await page.locator("[data-waiver-receipt]").waitFor({ state: "visible" });
  assert.equal(fixtureState.participationBasis, "minor_guardian_permission");
  assert.match(fixtureState.guardianPermissionAttestedAt ?? "", /^2026-07-15T/);
  assert.equal(fixtureState.privacyMediaVersion, privacyMediaVersion);
  assert.equal(fixtureState.reviewedWaiverVersion, legalDocument.version);
  assert.equal(fixtureState.reviewedWaiverHash, legalDocument.hash);
  assert.equal(fixtureState.acceptedWaiverVersion, legalDocument.version);
  assert.equal(fixtureState.signupWaiverAccepted, true);
  assert.equal(fixtureState.bootstrapCount, 2, "verified signup must bootstrap before profile storage and once during dashboard refresh");
  assert.match(await page.locator("[data-dashboard-profile]").innerText(), /QA Private Minor 01/);
  assert.equal(await page.locator('[data-dashboard-waypoints] a:has-text("Open approved directions")').count(), 1, "current minor legal acceptance must unlock approved participation tools");
}

async function exerciseDashboard(page, legalSource, viewportName, evidence) {
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  await page.locator("[data-waiver-panel]").waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-dashboard-waypoints] a:has-text("Open approved directions")').count(), 1, "progress and waypoint boundaries expose only the open approved link");
  assert.match(await page.locator("[data-dashboard-waypoints]").innerText(), /Exact directions locked/i);
  if (viewportName !== "desktop") {
    await page.locator("[data-waiver-receipt]").waitFor({ state: "visible" });
    const expected = viewportName === "mobile" ? "sent" : "failed";
    assert.equal(await page.locator("[data-waiver-receipt-status]").getAttribute("data-receipt-status"), expected);
    return;
  }

  const addMinor = page.locator("[data-add-minor]");
  assert.equal(await page.locator("[data-minor-row]").count(), 0);
  await addMinor.click();
  await page.locator("[data-guardian-confirmation]").waitFor({ state: "visible" });
  await page.locator("[data-waiver-submit]").click();
  assert.equal(await page.locator('[name="guardianAttested"]').getAttribute("aria-invalid"), "true", "guardian validation and focus must run in the real client");
  await page.locator('[name="minorFullName"]').fill(privateFixtures.minorName);
  await page.locator('[name="minorBirthYear"]').fill(privateFixtures.birthYear);
  for (let index = 1; index < 10; index += 1) await addMinor.click();
  assert.equal(await page.locator("[data-minor-row]").count(), 10, "minor counts 0, 1, and 10 must be real DOM states");
  for (let index = 9; index >= 1; index -= 1) await page.locator("[data-minor-row] button").nth(index).click();
  await page.locator("[data-waiver-review-link]").click();
  await page.locator("#waiver-accepted:not([disabled])").waitFor();
  await assertExactLegalDisplay(page, legalSource, "[data-waiver-legal-body]", "[data-waiver-legal-body] > h3");
  await page.locator("#waiver-accepted").check();
  await page.locator('input[name="guardianAttested"]').evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const acceptanceResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/me/waiver/accept"));
  await page.locator("[data-waiver-submit]").click();
  await acceptanceResponse;
  await page.locator("[data-waiver-receipt]").waitFor({ state: "visible" });
  const receiptVisible = await page.locator("[data-waiver-receipt]").isVisible();
  if (!receiptVisible) {
    const diagnostics = await page.evaluate(() => ({
      result: document.querySelector("[data-waiver-result]")?.textContent ?? "",
      errors: document.querySelector("[data-waiver-errors]")?.textContent ?? "",
      auth: document.querySelector("[data-auth-message]")?.textContent ?? "",
    }));
    assert.fail(`waiver receipt must become visible after acceptance: ${JSON.stringify(diagnostics)}`);
  }
  assert.match(await page.locator("[data-waiver-result]").innerText(), /accepted|stored/i, "acceptance success and reference must be rendered by the real client");
  assert.match(await page.locator("[data-waiver-acceptance-details]").innerText(), /TLS-W-QA000001/);
  assert.equal(await page.locator("[data-waiver-receipt-status]").getAttribute("data-receipt-status"), "pending");
  await page.locator("[data-resend-waiver-receipt]").click();
  await page.waitForFunction(() => /resend queued/i.test(document.querySelector("[data-waiver-receipt-status]")?.textContent || ""));
  assert.match(await page.locator("[data-waiver-receipt-status]").innerText(), /resend queued/i);
  evidence.dashboardPrint = await assertPrintCss(page, "[data-waiver-legal-body]");
}

async function exerciseOps(page, shouldRetry) {
  await page.locator("#ops-app").waitFor({ state: "visible" });
  await page.locator('[data-view="subscribers"]').evaluate((button) => button.click());
  await page.locator('[data-waiver-detail][data-player-id="hunter-1"]').waitFor();
  await page.locator('[data-waiver-detail][data-player-id="hunter-1"]').click();
  await page.locator("[data-retry-waiver-receipt]:not([disabled])").waitFor();
  assert.match(await page.locator("[data-waiver-detail-output]").innerText(), /TLS-W-QA000001/);
  if (shouldRetry) {
    await page.locator("[data-retry-waiver-receipt]").click();
    await page.locator("#waiver-detail-state").filter({ hasText: /queued and recorded/i }).waitFor();
  }
}

async function exerciseBoardBoundaries(page) {
  await page.locator("#field-note-form").waitFor({ state: "visible" });
  await page.locator("#board-feed .reply-form").waitFor();
  await page.locator('#note-waypoint').selectOption("1");
  await page.locator('#note-body').fill("Public-safe boundary observation.");
  await page.locator('#note-images').setInputFiles({ name: "oversize-note.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await page.locator('#field-note-form button[type="submit"]').click();
  assert.match(await page.locator("#note-error-summary").innerText(), /larger than 10 MiB/i, "note upload boundary must reject locally before a write");
  const reply = page.locator("#board-feed .reply-form").first();
  await reply.locator('textarea[name="body"]').fill(privateFixtures.coordinates);
  await reply.locator('button[type="submit"]').click();
  assert.match(await reply.locator(".form-result").innerText(), /Exact coordinates are not allowed/i, "reply privacy boundary must reject locally before a write");
  assert.equal(await reply.locator('textarea[name="body"]').evaluate((element) => element === document.activeElement), true);
  await page.locator("#field-note-form").evaluate((form) => form.reset());
  await reply.locator('textarea[name="body"]').fill("");
}

async function fillReportBase(page) {
  await page.locator('[name="type"]').selectOption("find");
  await page.locator('[name="name"]').fill(privateFixtures.adultName);
  await page.locator('[name="email"]').fill(privateFixtures.email);
  await page.locator('[name="locationDescription"]').fill("Near the marked public waypoint.");
  await page.locator('[name="details"]').fill(privateFixtures.reportEvidence);
  await page.locator('[name="accuracy"]').check();
}

async function exerciseReportBoundaries(page) {
  await page.locator("[data-report-form]").waitFor();
  await fillReportBase(page);
  await page.locator("[data-report-submit]").click();
  assert.match(await page.locator('[data-error-for="photo"]').innerText(), /Add a clear photo/i, "private find report boundary must require evidence without writing");
  assert.equal(await page.locator('[name="images"]').evaluate((element) => element === document.activeElement), true);
  await page.locator('[name="images"]').setInputFiles({ name: "oversize-report.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await page.locator("[data-report-submit]").click();
  assert.match(await page.locator('[data-error-for="photo"]').innerText(), /10 MiB or smaller/i, "report upload boundary must reject locally before a write");
  await page.locator("[data-report-form]").evaluate((form) => form.reset());
}

async function exerciseRoute(page) {
  await page.locator("[data-route-member-state]").filter({ hasText: /Signed in\. All thirteen waypoints/i }).waitFor();
  const exactWaypointLinks = page.locator('.stop-meta a:has-text("Open approved Google Maps waypoint")');
  const routeStories = page.locator(".stop .stop-quote");
  const routePhotos = page.locator('.stop-gallery .photo img[src*="assets/route/stop-"]');
  assert.equal(await exactWaypointLinks.count(), 13, "thirteen authenticated exact links must hydrate without exposing them signed out");
  assert.equal(await routeStories.count(), 13, "thirteen public route stories must remain visible to the authenticated journey");
  assert.equal(await routePhotos.count(), 61, "61 public-safe photos must remain attached to the route stories");
  for (const waypoint of publicWaypointFixtures) {
    const section = page.locator(`#stop-${waypoint.routeOrder}[data-waypoint-id="${waypoint.id}"]`);
    assert.equal(await section.count(), 1, `public stop ${waypoint.routeOrder} must retain stable waypoint ID ${waypoint.id}`);
    const actualHref = await section.locator(".stop-meta a").getAttribute("href");
    if (actualHref !== waypoint.exactUrl) {
      throw new Error(`Protected route link mismatch at route order ${waypoint.routeOrder}, waypoint ID ${waypoint.id}.`);
    }
  }
}

async function exerciseSignedOutRoute(page) {
  await page.locator("[data-route-signed-out]").waitFor();
  const exactWaypointLinks = page.locator('.stop-meta a:has-text("Open approved Google Maps waypoint")');
  assert.equal(await exactWaypointLinks.count(), 0, "signed-out route must contain zero exact-link anchors");
  const hrefValues = await page.locator("[href]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href) => href !== null));
  for (const waypoint of publicWaypointFixtures) {
    if (hrefValues.some((href) => href === waypoint.exactUrl)) {
      throw new Error(`Protected route link exposed at route order ${waypoint.routeOrder}, waypoint ID ${waypoint.id}.`);
    }
  }
  return page.content();
}

async function exerciseReportPublicationJourney(browser, origin, networkLedger, legalDocument, fixtureState, clerkChunkPaths, evidence, renderedPublicOutputs) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const reportPage = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, fixtureState, clerkChunkPaths);
  try {
    await goto(reportPage.page, origin, "/report");
    await reportPage.page.waitForFunction(({ name, email }) =>
      document.querySelector('[name="name"]')?.value === name && document.querySelector('[name="email"]')?.value === email,
    { name: privateFixtures.minorName, email: privateFixtures.email });
    assert.equal(await reportPage.page.locator('[name="name"]').inputValue(), privateFixtures.minorName, "signed-in report prefill must use the private profile name");
    assert.equal(await reportPage.page.locator('[name="email"]').inputValue(), privateFixtures.email, "signed-in report prefill must use the verified profile email");
    const expectedReportOptions = [
      { value: "not_sure", label: "Not sure / between waypoints" },
      ...publicWaypointFixtures.map(({ id, routeOrder, name }) => ({
        value: String(id),
        label: `Waypoint ${routeOrder} — ${name}`,
      })),
      { value: "different_location", label: "Different location" },
    ];
    const actualReportOptions = await reportPage.page.locator('[name="waypointId"] option').evaluateAll((options) =>
      options.map((option) => ({ value: option.value, label: (option.textContent ?? "").trim() })),
    );
    assert.equal(actualReportOptions.length, 15, "thirteen waypoints plus two fallback choices must remain available");
    assert.deepEqual(actualReportOptions, expectedReportOptions, "report waypoint choices must preserve exact values and meaningful labels");
    await reportPage.page.locator('[name="type"]').selectOption("find");
    await reportPage.page.locator('[name="phone"]').fill(privateFixtures.childPhone);
    await reportPage.page.locator('[name="waypointId"]').selectOption(String(reportFixture.waypointId));
    await reportPage.page.locator('[name="locationDescription"]').fill("Near the signed waypoint marker.");
    await reportPage.page.locator('[name="details"]').fill(privateFixtures.reportEvidence);
    await reportPage.page.locator('[data-report-latitude]').evaluate((input, value) => { input.value = value; }, String(reportFixture.latitude));
    await reportPage.page.locator('[data-report-longitude]').evaluate((input, value) => { input.value = value; }, String(reportFixture.longitude));
    await reportPage.page.locator('[name="images"]').setInputFiles([
      { name: "selected-public-candidate.png", mimeType: "image/png", buffer: png },
      { name: "private-evidence.png", mimeType: "image/png", buffer: png },
    ]);
    await reportPage.page.locator('[name="accuracy"]').check();
    await reportPage.page.locator('[data-turnstile]').filter({ hasText: /Test-only mocked human check/i }).waitFor();
    await reportPage.page.locator('[data-report-submit]').click();
    await reportPage.page.locator('[data-report-receipt]').waitFor({ state: "visible" });
    assert.equal(await reportPage.page.locator('[data-report-reference]').innerText(), reportFixture.id, "explicit report receipt must show the private reference");
    assert.deepEqual(reportPage.consoleProblems, [], "report publication journey must have no report-page console errors");
  } finally {
    await reportPage.context.close();
  }

  fixtureState.mode = "ops";
  const opsPage = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, fixtureState, clerkChunkPaths);
  try {
    await goto(opsPage.page, origin, "/ops#reports");
    const review = opsPage.page.locator(`[data-report-review][data-report-id="${reportFixture.id}"]`);
    await review.waitFor();
    await review.click();
    const dialog = opsPage.page.locator("[data-report-review-dialog]");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('[data-report-private-detail]').filter({ hasText: privateFixtures.email }).waitFor();
    const privateDetail = await dialog.locator('[data-report-private-detail]').innerText();
    for (const expected of [privateFixtures.minorName, privateFixtures.email, privateFixtures.childPhone, String(reportFixture.waypointId), String(reportFixture.latitude), privateFixtures.reportEvidence]) {
      assert.ok(privateDetail.includes(expected), `Staff report detail must include ${expected}`);
    }
    const mediaChoices = dialog.locator('input[name="publishMedia"]');
    assert.equal(await mediaChoices.count(), 2);
    await opsPage.page.waitForFunction(() => [...document.querySelectorAll('input[name="publishMedia"]')].every((input) => !input.disabled));
    assert.equal(await mediaChoices.first().isChecked(), false);
    assert.equal(await mediaChoices.nth(1).isChecked(), false, "every report image publication switch must default off");
    await mediaChoices.first().check();
    await dialog.locator('[data-report-publication-form] [name="title"]').fill(reportFixture.title);
    await dialog.locator('[data-report-publication-form] [name="body"]').fill(reportFixture.body);
    await dialog.locator('[data-report-publication-form] [name="confirmPublication"]').check();
    assert.equal(await dialog.locator('[data-report-publication-form] [name="confirmPublication"]').isChecked(), true, "explicit publish confirmation must be checked against the exact preview");
    await dialog.locator('[data-report-publish]').click();
    await dialog.locator('#report-publication-result').filter({ hasText: /published and audited/i }).waitFor();
    assert.equal(fixtureState.reportPublished, true);
    assert.deepEqual(opsPage.consoleProblems, [], "report publication journey must have no Staff console errors");
  } finally {
    await opsPage.context.close();
  }

  fixtureState.mode = "updates";
  fixtureState.signedOut = true;
  const updatesPage = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, fixtureState, clerkChunkPaths);
  try {
    await goto(updatesPage.page, origin, "/updates");
    const publicPost = updatesPage.page.locator('[data-updates-list] .official-note--report');
    await publicPost.waitFor();
    const publicText = await publicPost.innerText();
    for (const expected of ["Young Hunter", "Waypoint 8 — The Lodge Trails", String(reportFixture.latitude), String(reportFixture.longitude), reportFixture.title]) {
      assert.ok(publicText.toLowerCase().includes(expected.toLowerCase()), `public signed-out approved report must include ${expected}; rendered ${JSON.stringify(publicText)}`);
    }
    const publicHtml = await updatesPage.page.content();
    assert.ok(publicHtml.includes(reportFixture.selectedMediaId));
    for (const privateValue of privateFixtureValues) assert.equal(publicHtml.includes(privateValue), false, `public Updates must exclude ${privateValue}`);
    const privateMediaResponse = readMockResponse(new URL(`/api/v1/media/${privateFixtures.unselectedMediaId}`, origin), fixtureState, legalDocument);
    assert.equal(privateMediaResponse, null, "unselected report media must have no public media metadata or response");
    renderedPublicOutputs.push({ route: "/updates#approved-report", html: publicHtml });
    const publicScreenshot = await saveScreenshot(updatesPage.page, "updates-approved-report-signed-out", evidence);
    const screenshotBytes = await readFile(publicScreenshot);
    for (const privateValue of privateFixtureValues) assert.equal(screenshotBytes.includes(Buffer.from(privateValue)), false, `QA screenshot bytes must not embed private marker ${privateValue}`);
    assert.deepEqual(updatesPage.consoleProblems, [], "public signed-out Updates must have no console errors");
  } finally {
    await updatesPage.context.close();
  }
}

async function saveScreenshot(page, name, evidence) {
  const target = path.join(screenshotRoot, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  evidence.screenshots.push(target);
  return target;
}

async function collectFiles(target, predicate, output = []) {
  const targetStat = await stat(target).catch(() => null);
  if (!targetStat) return output;
  if (targetStat.isFile()) { if (predicate(target)) output.push(target); return output; }
  for (const entry of await readdir(target, { withFileTypes: true })) {
    await collectFiles(path.join(target, entry.name), predicate, output);
  }
  return output;
}

async function scanFiles(files, classification) {
  const privacyFindings = [];
  for (const file of files) {
    const source = await readFile(file, "utf8").catch(() => "");
    for (const fixture of privateFixtureValues) if (source.includes(fixture)) privacyFindings.push({ classification, file, fixture });
  }
  return privacyFindings;
}

async function productionSourcePrivacyScan() {
  const files = [];
  for (const directory of ["src", "css", "js", "legal"]) await collectFiles(path.join(root, directory), (file) => /\.(?:ts|js|css|json|html)$/.test(file), files);
  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isFile() && /\.(?:html|xml|txt|webmanifest)$/.test(entry.name)) files.push(path.join(root, entry.name));
  return { filesScanned: files.length, privacyFindings: await scanFiles(files, "production-source") };
}

async function bundlePrivacyClassification() {
  return scanBuiltOutputPrivacy({ distRoot, privateFixtureValues });
}

function scanRenderedPublicOutput(renderedPublicOutputs) {
  const privacyFindings = [];
  for (const output of renderedPublicOutputs) for (const fixture of privateFixtureValues) if (output.html.includes(fixture)) privacyFindings.push({ classification: "rendered-public-output", route: output.route, fixture });
  return { routesScanned: renderedPublicOutputs.map(({ route }) => route), privacyFindings };
}

async function run() {
  let server;
  let browser;
  try {
    await buildSite();
    await mkdir(screenshotRoot, { recursive: true });
    const waiverSource = JSON.parse(await readFile(path.join(root, "legal", "participation-waiver-2026.2.json"), "utf8"));
    assert.equal(waiverSource.version, "2026.2", "the isolated legal journey must use the active Participation Waiver");
    const legalDocument = { ...waiverSource, hash: canonicalHash(waiverSource) };
    const clerkChunkPaths = await findClerkChunkPaths();
    const networkLedger = {
      mockedWrites: new Map([...allowedWritePaths].map((pathname) => [pathname, 0])),
      observedRequests: [], blockedWrites: [], externalReadsFulfilledLocally: [], externalWritesObserved: [],
      continuedExternalRequests: [],
    };
    const serverLedger = { reads: [], rejectedWrites: [] };
    const evidence = { ok: false, runDate: "2026-07-15", isolated: true, artifactRoot, artifactPolicy: preserveArtifacts ? "scrubbed evidence only" : "removed after verification", scenarios, axeTags, routes: routes.map(({ path: pathname }) => pathname), viewports, checks: [], screenshots: [] };
    const renderedPublicOutputs = [];
    const started = await startBuiltSiteServer(serverLedger);
    server = started.server;
    const origin = started.origin;
    const launched = await launchBrowser();
    browser = launched.browser;
    evidence.browser = launched.source;
    evidence.origin = origin;

    const noKeyState = { mode: "no-key", accepted: false, receiptStatus: "pending" };
    const noKey = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, noKeyState, clerkChunkPaths);
    try {
      await goto(noKey.page, origin, "/dashboard");
      assert.match(await noKey.page.locator("[data-auth-message]").innerText(), /not configured|unavailable/i, "dashboard no-key state must be truthful");
    } finally { await noKey.context.close(); }

    const signupState = { mode: "signup", signedOut: true, accepted: false, receiptStatus: "pending" };
    const signupPage = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, signupState, clerkChunkPaths);
    try {
      await goto(signupPage.page, origin, "/dashboard");
      await exerciseMinorSignupGate(signupPage.page, signupState, legalDocument);
      assert.deepEqual(signupPage.consoleProblems, [], "minor signup and legal review must have no console errors");
    } finally { await signupPage.context.close(); }

    const signedOutRouteState = { mode: "route", signedOut: true, accepted: false, receiptStatus: "pending" };
    const signedOutRoutePage = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, signedOutRouteState, clerkChunkPaths);
    try {
      await goto(signedOutRoutePage.page, origin, "/route");
      const routeHtml = await exerciseSignedOutRoute(signedOutRoutePage.page);
      renderedPublicOutputs.push({ route: "/route#signed-out", html: routeHtml });
      assert.deepEqual(signedOutRoutePage.consoleProblems, [], "signed-out route must have no console errors");
    } finally { await signedOutRoutePage.context.close(); }

    for (const viewport of viewports) {
      for (const routeSpec of routes) {
        const fixtureState = {
          mode: routeSpec.name === "ops" ? "ops" : routeSpec.name,
          accepted: routeSpec.name === "dashboard" && viewport.name !== "desktop",
          receiptStatus: viewport.name === "mobile" ? "sent" : viewport.name === "zoom" ? "failed" : "pending",
        };
        const { context, page, consoleProblems } = await createQaPage(browser, viewport, origin, networkLedger, legalDocument, fixtureState, clerkChunkPaths);
        const label = `${routeSpec.name}-${viewport.name}`;
        try {
          await goto(page, origin, routeSpec.path);
          if (routeSpec.name === "waiver") {
            await assertExactLegalDisplay(page, waiverSource, ".legal-page", "#waiver-title");
            if (viewport.name === "desktop") await assertPrintCss(page, ".legal-page");
          } else if (routeSpec.name === "dashboard") {
            await exerciseDashboard(page, waiverSource, viewport.name, evidence);
          } else if (routeSpec.name === "ops") {
            await exerciseOps(page, viewport.name === "desktop");
            evidence.checks.push({ label: `${label}-dialog`, overflow: await assertNoDialogOverflow(page, label) });
          } else if (routeSpec.name === "clue-board" && viewport.name === "desktop") {
            renderedPublicOutputs.push({ route: routeSpec.path, html: await page.content() });
            await exerciseBoardBoundaries(page);
          } else if (routeSpec.name === "report" && viewport.name === "desktop") {
            renderedPublicOutputs.push({ route: routeSpec.path, html: await page.content() });
            await exerciseReportBoundaries(page);
          } else if (routeSpec.name === "route" && viewport.name === "desktop") {
            await exerciseRoute(page);
          }
          if (routeSpec.name === "waiver" && viewport.name === "desktop") renderedPublicOutputs.push({ route: routeSpec.path, html: await page.content() });
          const overflow = await assertNoHorizontalOverflow(page, label);
          const accessibility = await assertAxe(page, label);
          assert.deepEqual(consoleProblems, [], `${label} console errors: ${JSON.stringify(consoleProblems)}`);
          await saveScreenshot(page, label, evidence);
          evidence.checks.push({ label, overflow, accessibility, consoleErrors: 0 });
        } finally { await context.close(); }
      }
    }

    const reportJourneyState = { mode: "report", accepted: true, receiptStatus: "sent", reportSubmitted: false, reportPublished: false, signedOut: false };
    await exerciseReportPublicationJourney(
      browser,
      origin,
      networkLedger,
      legalDocument,
      reportJourneyState,
      clerkChunkPaths,
      evidence,
      renderedPublicOutputs,
    );
    const publicApiProjection = JSON.stringify(approvedReportUpdate());
    for (const privateValue of privateFixtureValues) assert.equal(publicApiProjection.includes(privateValue), false, `/api/v1/updates projection must exclude ${privateValue}`);
    for (const publicValue of ["Young Hunter", String(reportFixture.waypointId), String(reportFixture.latitude), String(reportFixture.longitude), reportFixture.selectedMediaId]) {
      assert.equal(publicApiProjection.includes(publicValue), true, `/api/v1/updates projection must include ${publicValue}`);
    }

    const mockedWriteCounts = Object.fromEntries(networkLedger.mockedWrites);
    const identityBootstrapWrites = mockedWriteCounts[identityBootstrapPath];
    assert.equal(identityBootstrapWrites, 5, "identity/profile bootstrap must cover three authenticated dashboard viewports and two verified-signup bootstrap passes");
    assert.equal(mockedWriteCounts["/api/v1/me/profile"], 1);
    assert.equal(mockedWriteCounts["/api/v1/me/waiver/review"], 2);
    assert.equal(mockedWriteCounts["/api/v1/me/waiver/accept"], 2);
    assert.equal(mockedWriteCounts["/api/v1/me/waiver/receipt"], 1);
    assert.equal(mockedWriteCounts["/api/v1/ops/players/hunter-1/waiver/receipt"], 1);
    assert.equal(mockedWriteCounts["/api/v1/reports"], 1);
    assert.equal(mockedWriteCounts[`/api/v1/ops/reports/${reportFixture.id}/publish`], 1);
    assert.deepEqual(networkLedger.blockedWrites, [], "no forbidden write may be attempted");
    assert.equal(networkLedger.externalWritesObserved.length, 0, "zero external writes may be observed");
    assert.equal(networkLedger.continuedExternalRequests.length, 0, "no external request may be continued to a provider");
    assert.deepEqual(serverLedger.rejectedWrites, [], "no write may reach the local built-site server");
    const continued = networkLedger.observedRequests.filter(({ disposition }) => disposition === "continued-local-read");
    assert.ok(continued.length > 0, "request accounting must observe real built-site reads");
    assert.ok(continued.every(({ method, origin: requestOrigin }) => (method === "GET" || method === "HEAD") && requestOrigin === origin));
    const forbiddenProviderAttempts = networkLedger.observedRequests.filter(({ method, origin: requestOrigin, pathname, disposition }) =>
      disposition !== "fulfilled-external-read" && requestOrigin !== origin && forbiddenExternalTargets.some((target) => `${requestOrigin}${pathname}`.toLowerCase().includes(target)),
    );
    assert.deepEqual(forbiddenProviderAttempts, [], "no provider request may escape local fulfillment");

    const sourcePrivacy = await productionSourcePrivacyScan();
    const bundles = await bundlePrivacyClassification();
    const renderedPrivacy = scanRenderedPublicOutput(renderedPublicOutputs);
    assert.deepEqual(sourcePrivacy.privacyFindings, [], "production source privacy scan must not contain QA private fixtures");
    assert.ok(bundles.publicSurfaceOutputs.files.includes("dashboard.html"), "Dashboard HTML must be treated as a public static output");
    assert.ok(bundles.publicSurfaceOutputs.files.includes("assets/app/dashboard.js"), "Dashboard client bundle must be treated as a public static output");
    assert.deepEqual(bundles.publicSurfaceOutputs.privacyFindings, [], "served public static output must not contain QA private fixtures");
    assert.deepEqual(renderedPrivacy.privacyFindings, [], "rendered public output privacy scan must not contain QA private fixtures");

    evidence.ok = true;
    evidence.mockedWrites = mockedWriteCounts;
    evidence.identityBootstrapWrites = identityBootstrapWrites;
    evidence.networkBoundary = {
      requestsObserved: networkLedger.observedRequests.length,
      dispositions: Object.fromEntries([...new Set(networkLedger.observedRequests.map(({ disposition }) => disposition))].map((disposition) => [disposition, networkLedger.observedRequests.filter((request) => request.disposition === disposition).length])),
      externalReadsFulfilledLocally: networkLedger.externalReadsFulfilledLocally.length,
      externalWritesObserved: networkLedger.externalWritesObserved.length,
      continuedExternalRequests: networkLedger.continuedExternalRequests.length,
      blockedWrites: networkLedger.blockedWrites.length,
      forbiddenProviderAttempts: forbiddenProviderAttempts.length,
      serverRejectedWrites: serverLedger.rejectedWrites.length,
    };
    evidence.privacy = {
      productionSource: sourcePrivacy,
      renderedPublicOutput: renderedPrivacy,
      publicSurfaceOutputs: bundles.publicSurfaceOutputs,
      privateBundleOutputs: bundles.privateBundleOutputs,
      privacyFindings: [...sourcePrivacy.privacyFindings, ...renderedPrivacy.privacyFindings, ...bundles.publicSurfaceOutputs.privacyFindings],
    };
    evidence.serverReadCount = serverLedger.reads.length;
    await writeFile(logPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: true, browser: evidence.browser, artifactRoot, screenshots: screenshotRoot, log: logPath, mockedWrites: evidence.mockedWrites, networkBoundary: evidence.networkBoundary, privacy: { productionSourceFindings: sourcePrivacy.privacyFindings.length, renderedPublicFindings: renderedPrivacy.privacyFindings.length, publicFilesScanned: bundles.publicSurfaceOutputs.filesScanned, publicBundleFindings: bundles.publicSurfaceOutputs.privacyFindings.length, privateFilesScanned: bundles.privateBundleOutputs.filesScanned, privateBundleClassifiedFindings: bundles.privateBundleOutputs.privacyFindings.length } }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await closeServer(server);
    if (!preserveArtifacts) await rm(artifactRoot, { recursive: true, force: true });
    else {
      await assertPreservedArtifactAllowlist();
      console.log(`Scrubbed waiver QA evidence preserved at ${artifactRoot}`);
    }
  }
}

await run();
