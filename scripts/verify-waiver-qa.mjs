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
  { name: "iphone", width: 390, height: 844 },
  { name: "zoom", width: 720, height: 500 },
];
const signupZoomViewport = { name: "signup-zoom-200", width: 360, height: 500 };
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
  "legal viewer failure recovery",
  "iPhone signup and returning sign-in",
  "verification reload and email-app return",
  "resend code and change email",
  "delayed provisioning and manual retry",
  "valid session with incomplete profile",
  "shared account header synchronization",
  "keyboard-only signup",
  "screen-reader names and live statuses",
  "200 percent zoom signup",
  "reduced motion signup",
  "44 pixel signup targets",
  "mobile signup horizontal overflow",
  "unsafe signup storage privacy",
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
const privateProfileStorageSentinels = [
  "qa-private-town-storage",
  "qa-private-discovery-storage",
  privateFixtures.childPhone,
  privateFixtures.hunterSubject,
  privateFixtures.acceptanceId,
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
    this.listeners = new Set();
    this.session = { id: "qa-local-session", getToken: async () => "qa-local-auth-token" };
    this.user = { id: "qa-local-subject", fullName: "QA Local User", primaryEmailAddress: { emailAddress: "qa-local-user@example.test" }, updatePassword: async () => {} };
    this.client = { signIn: { create: async () => ({ status: "complete", createdSessionId: "qa-session" }) }, signUp: { create: async () => ({ status: "complete", createdSessionId: "qa-session" }) } };
  }
  async load() {}
  addListener(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of [...this.listeners]) listener({ session: this.session, user: this.user }); }
  async setActive({ session }) { this.session = { id: session, getToken: async () => "qa-local-auth-token" }; this.emit(); }
  async signOut() { this.session = null; this.user = null; this.emit(); }
  openUserProfile() {}
}
`;

const fakeSignedOutClerkModule = `
// Test-only provider mock. It persists only non-secret provider state so reload/email-return can use the real built client.
const attemptKey = "qa-provider-signup-attempt";
const attemptCounterKey = "qa-provider-signup-attempt-count";
const activeSessionKey = "qa-provider-active-session";
const listeners = new Set();
const readAttempt = () => {
  try { return JSON.parse(localStorage.getItem(attemptKey) || "null"); } catch { return null; }
};
const writeAttempt = (value) => localStorage.setItem(attemptKey, JSON.stringify(value));
const makeSignup = () => {
  const stored = readAttempt();
  const signup = {
    id: stored?.id ?? undefined,
    status: stored?.status ?? null,
    emailAddress: stored?.emailAddress ?? null,
    createdSessionId: stored?.createdSessionId ?? null,
    unverifiedFields: stored?.status === "complete" ? [] : ["email_address"],
    missingFields: [],
    verifications: { emailAddress: { status: stored?.status === "complete" ? "verified" : "unverified", strategy: "email_code" } },
    async create({ emailAddress }) {
      const attemptCount = Number(localStorage.getItem(attemptCounterKey) || "0") + 1;
      localStorage.setItem(attemptCounterKey, String(attemptCount));
      Object.assign(signup, { id: "qa-signup-attempt-" + attemptCount, status: "missing_requirements", emailAddress, createdSessionId: null, unverifiedFields: ["email_address"] });
      writeAttempt({ id: signup.id, status: signup.status, emailAddress, createdSessionId: null });
      return signup;
    },
    async prepareEmailAddressVerification() {
      const count = Number(localStorage.getItem("qa-provider-resend-count") || "0") + 1;
      localStorage.setItem("qa-provider-resend-count", String(count));
      return signup;
    },
    async attemptEmailAddressVerification({ code }) {
      if (code !== "qa-minor-verification-code") throw new Error("Invalid test verification code");
      Object.assign(signup, { status: "complete", createdSessionId: "qa-minor-session", unverifiedFields: [], verifications: { emailAddress: { status: "verified", strategy: "email_code" } } });
      writeAttempt({ id: signup.id, status: signup.status, emailAddress: signup.emailAddress, createdSessionId: signup.createdSessionId });
      return signup;
    },
  };
  return signup;
};
export class Clerk {
  constructor() {
    this.session = null;
    this.user = null;
    this.client = {
      signIn: { create: async ({ identifier }) => ({ status: "complete", createdSessionId: "qa-returning-session", identifier }) },
      signUp: makeSignup(),
    };
    const active = sessionStorage.getItem(activeSessionKey);
    if (active) this.installSession(active);
  }
  installSession(id) {
    const activeAttempt = readAttempt();
    this.session = { id, getToken: async () => "qa-local-auth-token" };
    this.user = { id: "qa-hunter-subject", fullName: "QA Private Minor 01", primaryEmailAddress: { emailAddress: activeAttempt?.emailAddress || "qa-private-hunter@example.test" }, updatePassword: async () => {} };
  }
  emit() { for (const listener of [...listeners]) listener({ session: this.session, user: this.user }); }
  addListener(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  async load() {}
  async setActive({ session }) { sessionStorage.setItem(activeSessionKey, session); this.installSession(session); localStorage.removeItem(attemptKey); this.emit(); }
  async signOut() { sessionStorage.removeItem(activeSessionKey); this.session = null; this.user = null; this.emit(); }
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
  const signupProfilePending = fixtureState.mode === "signup" && fixtureState.profileStored !== true;
  const profile = fixtureState.dashboardProfileIncomplete === true || signupProfilePending
    ? null
    : minorSignupProfile ?? { fullName: privateFixtures.adultName, publicHandle: "@qa-hunter", townArea: "Seba Beach", interests: [], discoverySource: "friend", consents: { huntEmail: false, marketing: false }, adultAttestedAt: "2026-07-13T17:00:00.000Z" };
  return {
    data: {
      profile,
      privacyMediaRequired: fixtureState.dashboardProfileIncomplete === true || signupProfilePending,
      participationUnlocked: signupProfilePending ? false : fixtureState.profileStored === true ? fixtureState.signupWaiverAccepted === true : true,
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
    status: "verified",
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
  if (pathname === "/api/v1/ops/moderation/replies" || pathname === "/api/v1/ops/moderation/flags") {
    return jsonResponse({ data: [], page: { nextCursor: null } });
  }
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
  if (url.pathname === "/api/v1/zones") return jsonResponse({ data: [] });
  if (url.pathname === "/api/v1/legal/waiver") return jsonResponse({ data: legalDocument });
  if (url.pathname === "/api/v1/me/dashboard") return jsonResponse(dashboardPayload(fixtureState));
  if (url.pathname === "/api/v1/me/profile") return fixtureState.dashboardProfileIncomplete === true
    ? jsonResponse({ data: null })
    : jsonResponse({ data: { fullName: privateFixtures.minorName, email: privateFixtures.email, publicHandle: "@qa-hunter" } });
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
    if ((fixtureState.bootstrapFailuresRemaining ?? 0) > 0) {
      fixtureState.bootstrapFailuresRemaining -= 1;
      return jsonResponse({ error: { code: "player_not_ready", message: "Player provisioning is still syncing." } }, 503);
    }
    return jsonResponse({ data: { created: fixtureState.bootstrapCount === 1 } });
  }
  if (pathname === "/api/v1/me/profile") {
    const body = request.postDataJSON();
    assert.ok(["adult", "minor_guardian_permission"].includes(body.participationBasis));
    assert.equal(body.guardianPermissionAttested, body.participationBasis === "minor_guardian_permission");
    assert.equal(body.privacyMediaAccepted, true);
    assert.equal(body.privacyMediaVersion, privacyMediaVersion);
    fixtureState.profileStored = true;
    fixtureState.submittedFullName = body.fullName;
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

async function assertMinimumTargetSize(locator, label, minimum = 44) {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, text: (element.textContent ?? "").trim().slice(0, 80) };
  }));
  assert.ok(boxes.length > 0, `${label} must audit at least one target`);
  for (const box of boxes) {
    assert.ok(box.width >= minimum && box.height >= minimum, `${label} target must be at least ${minimum}px: ${JSON.stringify(box)}`);
  }
  return boxes;
}

async function assertVisibleFocus(locator, label) {
  await locator.evaluate((element) => element.blur());
  const unfocused = await locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { outlineStyle: styles.outlineStyle, outlineWidth: styles.outlineWidth, boxShadow: styles.boxShadow };
  });
  await locator.focus();
  const focused = await locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      active: document.activeElement === element,
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
      boxShadow: styles.boxShadow,
    };
  });
  assert.equal(focused.active, true, `${label} target must receive keyboard focus`);
  assert.ok(
    (focused.outlineStyle !== "none" && focused.outlineWidth >= 2 &&
      (focused.outlineStyle !== unfocused.outlineStyle || `${focused.outlineWidth}px` !== unfocused.outlineWidth)) ||
      (focused.boxShadow !== "none" && focused.boxShadow !== unfocused.boxShadow),
    `${label} must add a visible focus indicator: ${JSON.stringify({ unfocused, focused })}`,
  );
  return { unfocused, focused };
}

async function assertReducedMotionApplied(locator, label) {
  const motion = await locator.evaluateAll((elements) => elements.map((element) => {
    const styles = getComputedStyle(element);
    return { transitionDuration: styles.transitionDuration, animationDuration: styles.animationDuration };
  }));
  assert.ok(motion.length > 0, `${label} must audit at least one rendered element`);
  const milliseconds = (value) => value.split(",").map((part) => {
    const duration = Number.parseFloat(part);
    return part.trim().endsWith("ms") ? duration : duration * 1_000;
  });
  for (const state of motion) {
    assert.ok(Math.max(...milliseconds(state.transitionDuration), ...milliseconds(state.animationDuration)) <= 0.02,
      `${label} must suppress motion: ${JSON.stringify(state)}`);
  }
}

async function keyboardTabTo(page, locator, label, maximumTabs = 80) {
  for (let index = 0; index <= maximumTabs; index += 1) {
    if (await locator.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 80) }));
  assert.fail(`${label} must be reachable in keyboard order: ${JSON.stringify(active)}`);
}

async function keyboardTypeInto(page, locator, value, label) {
  await keyboardTabTo(page, locator, label);
  await page.keyboard.type(value);
}

async function keyboardActivate(page, locator, label, key = "Enter") {
  await keyboardTabTo(page, locator, label);
  await page.keyboard.press(key);
}

async function assertDialogFocusTrap(page, dialog, label) {
  const focusable = dialog.locator('button:visible, a[href]:visible, iframe:visible, input:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible');
  const count = await focusable.count();
  assert.ok(count >= 2, `${label} must expose multiple keyboard controls`);
  await focusable.first().focus();
  for (const key of ["Shift+Tab", ...Array.from({ length: count + 2 }, () => "Tab")]) {
    await page.keyboard.press(key);
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, `${label} must keep ${key} focus inside the modal`);
  }
}

async function assertEmbeddedLegalIsolation(frame, label) {
  await frame.locator("main#main").waitFor();
  assert.equal(await frame.locator('.campaign-header a[href="/dashboard"]:visible').count(), 0, `embedded ${label} review must not expose cyclic Dashboard navigation`);
  assert.equal(await frame.locator('[data-registration-action]:visible, .legal-actions:visible').count(), 0, `embedded ${label} review must not expose registration actions`);
}

async function assertUnsafeStorageFree(page) {
  const storageSnapshot = await page.evaluate(() => ({
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
  }));
  const serialized = JSON.stringify(storageSnapshot);
  for (const forbidden of [
    "QA-guardian-password-2026",
    "qa-minor-verification-code",
    "qa-local-auth-token",
    "privacyMediaAccepted",
    "waiverAccepted",
    ...privateProfileStorageSentinels,
  ]) assert.equal(serialized.includes(forbidden), false, `unsafe signup storage privacy must exclude ${forbidden}`);
  for (const secretShape of ["password", "verification code", "session token", "reset code"]) {
    assert.equal(serialized.toLowerCase().includes(secretShape), false, `browser storage must exclude ${secretShape}`);
  }
  return storageSnapshot;
}

async function assertSignupRecoveryCleared(page, values) {
  const storageSnapshot = await page.evaluate(() => ({
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
  }));
  const serialized = JSON.stringify(storageSnapshot);
  for (const forbidden of [...values, "privacyMediaDocument", "waiverDocument", "participationBasis", "guardianPermissionAttested"]) {
    assert.equal(serialized.includes(forbidden), false, `completed signup storage must clear ${forbidden}`);
  }
}

async function exerciseSignupLegalFailureRecovery(page, origin) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/privacy.html" && url.searchParams.get("embed") === "signup") {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>Suppressed legal readiness fixture</title>",
      });
      return;
    }
    await route.fallback();
  });
  await goto(page, origin, "/dashboard");
  await page.clock.install();

  const signup = page.locator("#hunter-sign-up-form");
  await page.locator('[data-show-auth="hunter-sign-up-form"]').click();
  await signup.waitFor({ state: "visible" });
  const failureReview = signup.locator('[data-signup-review="privacy-media"]');
  const failureAcceptance = signup.locator('[name="privacyMediaAccepted"]');
  const otherAcceptance = signup.locator('[name="waiverAccepted"]');
  assert.equal(await failureAcceptance.isEnabled(), true, "failure recovery keeps Privacy acceptance usable");
  assert.equal(await otherAcceptance.isEnabled(), true, "failure recovery keeps Waiver acceptance usable");
  assert.equal(await failureAcceptance.isChecked(), false, "failure recovery never checks Privacy acceptance");
  assert.equal(await otherAcceptance.isChecked(), false, "failure recovery never checks Waiver acceptance");

  await failureReview.click();
  const failureDialog = page.locator('[data-signup-dialog="privacy-media"]');
  const failureViewer = failureDialog.locator("iframe");
  const failureStatus = failureDialog.locator("[data-signup-dialog-status]");
  await failureDialog.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[data-signup-dialog="privacy-media"] iframe')?.hasAttribute("src"));
  await page.clock.fastForward(12_000);
  await failureStatus.filter({ hasText: /embedded legal document could not be displayed/i }).waitFor({ state: "visible" });
  assert.match(await failureStatus.innerText(), /Use the full-page link below/i, "failure recovery shows readable fallback guidance");
  assert.equal(await failureViewer.isHidden(), true, "failed legal iframe is hidden");
  assert.equal(await failureViewer.getAttribute("src"), null, "failed legal iframe source is detached");
  if (await failureDialog.locator("[data-signup-dialog-fallback]").getAttribute("href") !== "/privacy#media-notice") {
    throw new Error("Legal failure recovery must retain the canonical full-page Privacy fallback.");
  }
  assert.equal(await failureAcceptance.isEnabled(), true, "failed legal loading does not disable Privacy acceptance");
  assert.equal(await otherAcceptance.isEnabled(), true, "failed legal loading does not disable Waiver acceptance");
  assert.equal(await failureAcceptance.isChecked(), false, "failed legal loading does not imply Privacy acceptance");
  assert.equal(await otherAcceptance.isChecked(), false, "failed legal loading does not imply Waiver acceptance");
  await failureDialog.locator(".signup-legal-dialog__header").getByRole("button", { name: "Close Privacy Policy and Media Notice" }).click();
  await failureDialog.waitFor({ state: "hidden" });
  assert.equal(await failureReview.evaluate((element) => element === document.activeElement), true, "failure close restores focus to the legal review trigger");
  await failureAcceptance.check();
  assert.equal(await failureAcceptance.isChecked(), true, "participant can explicitly accept after embedded-view failure");
  assert.equal(await otherAcceptance.isChecked(), false, "explicit Privacy acceptance does not change Waiver acceptance");
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
  const privacyReview = signup.locator('[data-signup-review="privacy-media"]');
  const waiverReview = signup.locator('[data-signup-review="waiver"]');
  const privacyAcceptance = signup.locator('[name="privacyMediaAccepted"]');
  const waiverAcceptance = signup.locator('[name="waiverAccepted"]');
  const assertAcceptanceUnchanged = async (state) => {
    assert.equal(await privacyAcceptance.isChecked(), false, `${state}: privacy acceptance remains participant-controlled`);
    assert.equal(await waiverAcceptance.isChecked(), false, `${state}: waiver acceptance remains participant-controlled`);
  };

  await assertAcceptanceUnchanged("before legal review");
  await privacyReview.click();
  const privacyDialog = page.locator('[data-signup-dialog="privacy-media"]');
  await privacyDialog.waitFor({ state: "visible" });
  await privacyDialog.locator("iframe").waitFor({ state: "visible" });
  assert.equal(await privacyDialog.locator("[data-signup-dialog-status]").isHidden(), true, "trusted embedded readiness hides the loading state");
  if (await privacyDialog.locator("[data-signup-dialog-fallback]").getAttribute("href") !== "/privacy#media-notice") {
    throw new Error("Privacy legal fallback must target the canonical media notice.");
  }
  assert.equal(await signup.getAttribute("data-privacy-media-version"), privacyMediaVersion);
  assert.equal(await privacyAcceptance.isEnabled(), true);
  await privacyDialog.locator(".signup-legal-dialog__header").getByRole("button", { name: "Close Privacy Policy and Media Notice" }).click();
  await privacyDialog.waitFor({ state: "hidden" });
  assert.equal(await privacyReview.evaluate((element) => element === document.activeElement), true, "top Close restores focus to the Privacy review trigger");
  await assertAcceptanceUnchanged("after top Close");

  await privacyReview.click();
  await privacyDialog.locator("iframe").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await privacyDialog.waitFor({ state: "hidden" });
  assert.equal(await privacyReview.evaluate((element) => element === document.activeElement), true, "Escape restores focus to the Privacy review trigger");
  await assertAcceptanceUnchanged("after Escape");

  await waiverReview.click();
  const waiverDialog = page.locator('[data-signup-dialog="waiver"]');
  await waiverDialog.waitFor({ state: "visible" });
  await waiverDialog.locator("iframe").waitFor({ state: "visible" });
  assert.equal(await waiverDialog.locator("[data-signup-dialog-status]").isHidden(), true, "trusted waiver readiness hides the loading state");
  if (await waiverDialog.locator("[data-signup-dialog-fallback]").getAttribute("href") !== "/waiver") {
    throw new Error("Waiver legal fallback must target the canonical waiver.");
  }
  assert.equal(await signup.getAttribute("data-waiver-version"), "2026.2");
  assert.equal(await waiverAcceptance.isEnabled(), true);
  await waiverDialog.locator(".signup-legal-dialog__footer").getByRole("button", { name: "Done — back to account setup" }).click();
  await waiverDialog.waitFor({ state: "hidden" });
  assert.equal(await waiverReview.evaluate((element) => element === document.activeElement), true, "bottom Done restores focus to the Waiver review trigger");
  await assertAcceptanceUnchanged("after bottom Done");

  await privacyAcceptance.check();
  await waiverAcceptance.check();
  await signup.locator('button[type="submit"]').click();
  const verify = page.locator("#hunter-verify-form");
  await verify.waitFor({ state: "visible" });
  assert.match(await page.locator("[data-auth-message]").innerText(), /verification code/i);
  await verify.locator('[name="code"]').fill("qa-minor-verification-code");
  await verify.locator('button[type="submit"]').click();
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  if (!await page.locator("[data-waiver-receipt]").isVisible()) {
    const diagnostics = await page.evaluate(() => ({
      auth: document.querySelector("[data-auth-message]")?.textContent ?? "",
      dashboardState: document.querySelector("[data-dashboard-access]")?.getAttribute("data-dashboard-state"),
      finishing: document.querySelector("[data-signup-finishing-status]")?.textContent ?? "",
      profile: document.querySelector("[data-dashboard-profile]")?.textContent ?? "",
      waiver: document.querySelector("[data-waiver-result]")?.textContent ?? "",
    }));
    assert.fail(`verified signup must expose its waiver receipt: ${JSON.stringify({ diagnostics, fixtureState })}`);
  }
  assert.equal(fixtureState.participationBasis, "minor_guardian_permission");
  assert.match(fixtureState.guardianPermissionAttestedAt ?? "", /^2026-07-15T/);
  assert.equal(fixtureState.privacyMediaVersion, privacyMediaVersion);
  assert.equal(fixtureState.reviewedWaiverVersion, legalDocument.version);
  assert.equal(fixtureState.reviewedWaiverHash, legalDocument.hash);
  assert.equal(fixtureState.acceptedWaiverVersion, legalDocument.version);
  assert.equal(fixtureState.signupWaiverAccepted, true);
  assert.equal(fixtureState.bootstrapCount, 1, "verified signup must bootstrap exactly once while preserving activation finalization");
  assert.match(await page.locator("[data-dashboard-profile]").innerText(), /QA Private Minor 01/);
  assert.equal(await page.locator('[data-dashboard-waypoints] a:has-text("Open approved directions")').count(), 1, "current minor legal acceptance must unlock approved participation tools");
  await assertSignupRecoveryCleared(page, [privateFixtures.minorName, privateFixtures.email]);
}

async function exerciseResumableMobileSignup(page, origin, fixtureState) {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goto(page, origin, "/dashboard");
  assert.deepEqual(page.viewportSize(), { width: 390, height: 844 }, "iPhone signup and returning sign-in uses the supported mobile viewport");
  assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true, "reduced motion signup must use the reduced-motion presentation");

  const createAccount = page.locator('[data-show-auth="hunter-sign-up-form"]');
  await assertVisibleFocus(createAccount, "keyboard-only signup Create account");
  await page.keyboard.press("Enter");
  const signup = page.locator("#hunter-sign-up-form");
  await signup.waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page, "mobile signup");
  await assertMinimumTargetSize(signup.locator('button:visible, input:not([type="radio"]):not([type="checkbox"]):visible, .check-row:visible'), "44 pixel signup targets");
  await assertReducedMotionApplied(signup.locator("button:visible, .check-row:visible"), "reduced motion signup");

  await signup.locator('[name="fullName"]').fill(privateFixtures.minorName);
  await signup.locator('[name="email"]').fill(privateFixtures.email);
  await signup.locator('[name="password"]').fill("QA-guardian-password-2026");
  await signup.locator('[name="confirmPassword"]').fill("QA-guardian-password-2026");
  await signup.locator('[name="participationBasis"][value="adult"]').check();

  const privacyReview = signup.locator('[data-signup-review="privacy-media"]');
  await privacyReview.click();
  const privacyDialog = page.locator('[data-signup-dialog="privacy-media"]');
  await privacyDialog.waitFor({ state: "visible" });
  const privacyFrame = privacyDialog.locator("iframe").contentFrame();
  await assertEmbeddedLegalIsolation(privacyFrame, "Privacy");
  const legalScroll = await privacyFrame.locator("main#main").evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return { y: window.scrollY, height: document.documentElement.scrollHeight, viewport: window.innerHeight };
  });
  assert.ok(legalScroll.height > legalScroll.viewport && legalScroll.y > 0, "iPhone legal review must support reading through the document");
  await assertMinimumTargetSize(privacyDialog.locator("button:visible, a[href]:visible"), "44 pixel legal dialog controls");
  await assertDialogFocusTrap(page, privacyDialog, "Privacy legal dialog");
  await privacyDialog.locator(".signup-legal-dialog__footer").getByRole("button", { name: "Done — back to account setup" }).click();
  await privacyDialog.waitFor({ state: "hidden" });
  assert.equal(await privacyReview.evaluate((element) => document.activeElement === element), true, "Done restores focus during iPhone signup");

  const privacyAcceptance = signup.locator('[name="privacyMediaAccepted"]');
  const waiverAcceptance = signup.locator('[name="waiverAccepted"]');
  assert.equal(await privacyAcceptance.isChecked(), false, "viewing Privacy never implies acceptance");
  assert.equal(await waiverAcceptance.isChecked(), false, "viewing Privacy never changes Waiver acceptance");
  await privacyAcceptance.check();
  assert.equal(await waiverAcceptance.isChecked(), false, "checkbox independence keeps Waiver unchecked");
  const waiverReview = signup.locator('[data-signup-review="waiver"]');
  await waiverReview.click();
  const waiverDialog = page.locator('[data-signup-dialog="waiver"]');
  await waiverDialog.waitFor({ state: "visible" });
  const waiverFrame = waiverDialog.locator("iframe").contentFrame();
  await assertEmbeddedLegalIsolation(waiverFrame, "Waiver");
  await assertMinimumTargetSize(waiverDialog.locator("button:visible, a[href]:visible"), "44 pixel Waiver legal dialog controls");
  await assertDialogFocusTrap(page, waiverDialog, "Waiver legal dialog");
  await waiverDialog.locator(".signup-legal-dialog__footer").getByRole("button", { name: /Done/ }).click();
  await waiverDialog.waitFor({ state: "hidden" });
  assert.equal(await waiverReview.evaluate((element) => document.activeElement === element), true, "Waiver Done restores focus during iPhone signup");
  await waiverAcceptance.check();
  await signup.locator('button[type="submit"]').click();

  const verify = page.locator("#hunter-verify-form");
  await verify.waitFor({ state: "visible" });
  assert.equal(await verify.getByLabel("Email verification code").count(), 1, "screen-reader names and live statuses expose the verification input");
  assert.equal(await page.locator("[data-auth-message]").getAttribute("role"), "status", "verification guidance is a live status");
  await assertMinimumTargetSize(verify.locator('input:visible, button:visible, [data-signup-resend]:visible, [data-signup-restart]:visible'), "44 pixel verification controls");
  await assertUnsafeStorageFree(page);

  await page.reload({ waitUntil: "networkidle" });
  await verify.waitFor({ state: "visible" });
  assert.match(await page.locator("[data-signup-verification-status]").innerText(), /verification|code/i, "verification reload and email-app return restores the waiting state");

  await goto(page, origin, "/updates");
  await goto(page, origin, "/dashboard");
  await verify.waitFor({ state: "visible" });
  await page.evaluate(() => {
    for (const storage of [localStorage, sessionStorage]) {
      for (const [key, value] of Object.entries(storage)) {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === "object" && "resendAvailableAt" in parsed) {
            parsed.resendAvailableAt = Date.now() - 1;
            storage.setItem(key, JSON.stringify(parsed));
          }
        } catch { /* non-JSON provider counters are expected */ }
      }
    }
  });
  await page.reload({ waitUntil: "networkidle" });
  await verify.waitFor({ state: "visible" });
  await page.locator("[data-signup-resend]:not([disabled])").click();
  await page.locator("[data-signup-verification-status]").filter({ hasText: /new code was sent/i }).waitFor();
  assert.ok(Number(await page.evaluate(() => localStorage.getItem("qa-provider-resend-count"))) >= 2, "resend code and change email must call the provider after the initial send");
  const originalAttemptId = await page.evaluate(() => JSON.parse(localStorage.getItem("qa-provider-signup-attempt") || "null")?.id);
  await verify.locator("[data-signup-restart]").click();
  await signup.waitFor({ state: "visible" });
  assert.equal(await signup.locator('[name="email"]').inputValue(), "", "Use a different email clears the signup form");

  const changedName = "QA Keyboard Changed Hunter";
  const changedEmail = "changed-hunter@different.test";
  await keyboardTypeInto(page, signup.locator('[name="fullName"]'), changedName, "keyboard-only signup full name");
  await keyboardTypeInto(page, signup.locator('[name="email"]'), changedEmail, "keyboard-only signup changed email");
  await keyboardTypeInto(page, signup.locator('[name="password"]'), "QA-keyboard-password-2026", "keyboard-only signup password");
  await keyboardTypeInto(page, signup.locator('[name="confirmPassword"]'), "QA-keyboard-password-2026", "keyboard-only signup password confirmation");
  await keyboardActivate(page, signup.locator('[name="participationBasis"][value="adult"]'), "keyboard-only signup participation basis", "Space");
  await keyboardActivate(page, privacyReview, "keyboard-only Privacy review");
  await privacyDialog.waitFor({ state: "visible" });
  await assertDialogFocusTrap(page, privacyDialog, "keyboard-only Privacy legal dialog");
  await keyboardActivate(page, privacyDialog.locator(".signup-legal-dialog__footer").getByRole("button", { name: /Done/ }), "keyboard-only Privacy Done");
  await privacyDialog.waitFor({ state: "hidden" });
  await keyboardActivate(page, privacyAcceptance, "keyboard-only Privacy acceptance", "Space");
  await keyboardActivate(page, waiverReview, "keyboard-only Waiver review");
  await waiverDialog.waitFor({ state: "visible" });
  await assertDialogFocusTrap(page, waiverDialog, "keyboard-only Waiver legal dialog");
  await keyboardActivate(page, waiverDialog.locator(".signup-legal-dialog__footer").getByRole("button", { name: /Done/ }), "keyboard-only Waiver Done");
  await waiverDialog.waitFor({ state: "hidden" });
  await keyboardActivate(page, waiverAcceptance, "keyboard-only Waiver acceptance", "Space");
  await keyboardActivate(page, signup.locator('button[type="submit"]'), "keyboard-only Create account");
  await verify.waitFor({ state: "visible" });
  const replacementAttempt = await page.evaluate(() => JSON.parse(localStorage.getItem("qa-provider-signup-attempt") || "null"));
  assert.notEqual(replacementAttempt?.id, originalAttemptId, "changed email must create a replacement provider attempt instead of resuming the old attempt");
  assert.equal(replacementAttempt?.emailAddress, changedEmail, "changed email must own the replacement provider attempt");
  assert.match(await page.locator("[data-signup-masked-email]").innerText(), /c\*\*\*@d\*\*\*\.test/i, "changed email must replace the old masked destination");
  await keyboardTypeInto(page, verify.locator('[name="code"]'), "qa-minor-verification-code", "keyboard-only verification code");
  await keyboardActivate(page, verify.locator('button[type="submit"]'), "keyboard-only Verify email");
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  assert.equal(fixtureState.submittedFullName, changedName, "changed signup draft must reach profile finalization");
  await assertSignupRecoveryCleared(page, [changedName, changedEmail]);
  await assertAxe(page, "iPhone signup and returning sign-in");
  await assertUnsafeStorageFree(page);
}

async function exerciseSignupZoom(page, origin) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goto(page, origin, "/dashboard");
  assert.deepEqual(page.viewportSize(), { width: signupZoomViewport.width, height: signupZoomViewport.height }, "200 percent zoom signup must use the constrained CSS layout viewport");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  assert.equal(await page.evaluate(() => visualViewport?.scale), 2, "200 percent zoom signup must apply a real 2x browser page scale");
  const createAccount = page.locator('[data-show-auth="hunter-sign-up-form"]');
  await assertVisibleFocus(createAccount, "keyboard-only signup at 200 percent zoom");
  await page.keyboard.press("Enter");
  const signup = page.locator("#hunter-sign-up-form");
  await signup.waitFor({ state: "visible" });
  await assertNoHorizontalOverflow(page, "mobile signup at 200 percent zoom");
  await assertMinimumTargetSize(signup.locator('button:visible, input:not([type="radio"]):not([type="checkbox"]):visible, .check-row:visible'), "44 pixel signup targets at 200 percent zoom");
  await assertReducedMotionApplied(signup.locator("button:visible, .check-row:visible"), "reduced motion signup at 200 percent zoom");
  await assertAxe(page, "200 percent zoom signup");
}

async function exerciseReturningSignInAndHeader(page, origin) {
  await goto(page, origin, "/dashboard?intent=signin");
  const signIn = page.locator("#hunter-sign-in-form");
  await signIn.waitFor({ state: "visible" });
  await signIn.locator('[name="email"]').fill(privateFixtures.email);
  await signIn.locator('[name="password"]').fill("QA-returning-password-2026");
  await signIn.locator('button[type="submit"]').click();
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  const headerHandle = page.locator("[data-campaign-account-handle]");
  await page.waitForFunction(() => /qa-hunter/i.test(document.querySelector("[data-campaign-account-handle]")?.textContent ?? ""));
  await page.locator(".campaign-menu-toggle").click();
  await headerHandle.filter({ hasText: /qa-hunter/i }).waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-campaign-account-toggle]").isVisible(), true, "shared account header synchronization reflects in-page sign-in");
  await page.locator("[data-hunter-sign-out]:visible").first().click();
  await signIn.waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-campaign-account-sign-in]").isVisible(), true, "shared account header synchronization reflects in-page sign-out");
}

async function exerciseDelayedProvisioningRecovery(page, origin, fixtureState) {
  await page.addInitScript(() => sessionStorage.setItem("qa-provider-active-session", "qa-delayed-session"));
  await page.clock.install();
  const response = await page.goto(`${origin}/dashboard`, { waitUntil: "domcontentloaded" });
  assert.equal(response?.ok(), true);
  const finishing = page.locator("#hunter-signup-finishing-state");
  await finishing.waitFor({ state: "visible" });
  for (const delay of [1_100, 4_100, 10_100, 15_100]) {
    await page.clock.fastForward(delay);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const retry = page.locator("[data-signup-finishing-retry]");
  await retry.filter({ hasText: "Try again" }).waitFor({ state: "visible" });
  assert.match(await page.locator("[data-signup-finishing-status]").innerText(), /automatic checks have paused/i, "delayed provisioning and manual retry exposes a non-destructive retry state");
  fixtureState.bootstrapFailuresRemaining = 0;
  await retry.click();
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  assert.equal(await finishing.isHidden(), true, "manual retry completes delayed provisioning without a new sign-in");
}

async function exerciseValidSessionIncompleteProfile(page, origin) {
  await page.addInitScript(() => sessionStorage.setItem("qa-provider-active-session", "qa-incomplete-profile-session"));
  await goto(page, origin, "/dashboard");
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-dashboard-access]").isHidden(), true, "valid session with incomplete profile must not render the signed-out gate");
  assert.match(await page.locator("[data-dashboard-profile]").innerText(), /complete your private profile/i);
  await page.waitForFunction(() => {
    const accountToggle = document.querySelector("[data-campaign-account-toggle]");
    const signIn = document.querySelector("[data-campaign-account-sign-in]");
    return accountToggle instanceof HTMLElement && !accountToggle.hidden && signIn instanceof HTMLElement && signIn.hidden;
  });
  await page.locator(".campaign-menu-toggle").click();
  assert.equal(await page.locator("[data-campaign-account-toggle]").isVisible(), true, "valid provider session remains visibly signed in while profile completion is pending");
}

async function exerciseDashboard(page, legalSource, viewportName, evidence) {
  await page.locator("[data-dashboard-content]").waitFor({ state: "visible" });
  await page.locator("[data-waiver-panel]").waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-dashboard-waypoints] a:has-text("Open approved directions")').count(), 1, "progress and waypoint boundaries expose only the open approved link");
  assert.match(await page.locator("[data-dashboard-waypoints]").innerText(), /Exact directions locked/i);
  if (viewportName !== "desktop") {
    await page.locator("[data-waiver-receipt]").waitFor({ state: "visible" });
    const expected = viewportName === "iphone" ? "sent" : "failed";
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
  await page.locator('#note-images').setInputFiles({ name: "oversize-note.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(50_000_001) });
  const noteImageStatus = page.locator("#note-image-status");
  await noteImageStatus.filter({ hasText: /larger than 50 MB/i }).waitFor();
  assert.match(await noteImageStatus.innerText(), /larger than 50 MB/i, "note upload boundary must reject locally before a write");
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
  await page.locator('[name="images"]').setInputFiles({ name: "oversize-report.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(50_000_001) });
  await page.locator('[data-error-for="photo"]').filter({ hasText: /50 MB/i }).waitFor();
  await page.locator("[data-report-submit]").click();
  assert.match(await page.locator('[data-error-for="photo"]').innerText(), /50 MB/i, "report upload boundary must reject locally before a write");
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
      { value: "not_sure", label: "Not sure which stop" },
      { value: "1", label: "Stop 01 · Creek Property" },
      { value: "2", label: "Stop 02 · Public Beach / Market Lot" },
      { value: "3", label: "Stop 03 · Randy's Beach" },
      { value: "4", label: "Stop 04 · Seniors Centre" },
      { value: "13", label: "Stop 05 · Derby's General Store" },
      { value: "5", label: "Stop 06 · Gated Road / School Grounds" },
      { value: "6", label: "Stop 07 · Back Trails" },
      { value: "7", label: "Stop 08 · Lodge Trails" },
      { value: "8", label: "Stop 09 · Vista Lands" },
      { value: "9", label: "Stop 10 · Cliff-Edge Slope" },
      { value: "10", label: "Stop 11 · Driving Range / Digger Café" },
      { value: "11", label: "Stop 12 · Kokanee Springs Front Gate" },
      { value: "12", label: "Stop 13 · Old Seba Beach School / SebaHub" },
      { value: "different_location", label: "Different location / outside the 13-stop route" },
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
    await reportPage.page.locator('[name="publicAttributionKind"][value="community"]').check();
    await reportPage.page.locator('[name="images"]').setInputFiles([
      { name: "selected-public-candidate.png", mimeType: "image/png", buffer: png },
      { name: "private-evidence.png", mimeType: "image/png", buffer: png },
    ]);
    await reportPage.page.locator('[name="accuracy"]').check();
    await reportPage.page.locator('[data-turnstile]').filter({ hasText: /Test-only mocked human check/i }).waitFor();
    await reportPage.page.locator('[data-report-submit]:not([disabled])').waitFor();
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

    const legalFailureState = { mode: "signup", signedOut: true, accepted: false, receiptStatus: "pending" };
    const legalFailurePage = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, legalFailureState, clerkChunkPaths);
    try {
      await exerciseSignupLegalFailureRecovery(legalFailurePage.page, origin);
      assert.deepEqual(legalFailurePage.consoleProblems, [], "legal viewer failure recovery must have no console errors");
    } finally { await legalFailurePage.context.close(); }

    const signupState = { mode: "signup", signedOut: true, accepted: false, receiptStatus: "pending" };
    const signupPage = await createQaPage(browser, viewports[0], origin, networkLedger, legalDocument, signupState, clerkChunkPaths);
    try {
      await goto(signupPage.page, origin, "/dashboard");
      await exerciseMinorSignupGate(signupPage.page, signupState, legalDocument);
      assert.deepEqual(signupPage.consoleProblems, [], "minor signup and legal review must have no console errors");
    } finally { await signupPage.context.close(); }

    const resumableSignupState = { mode: "signup", signedOut: true, accepted: false, receiptStatus: "pending" };
    const resumableSignupPage = await createQaPage(browser, viewports[1], origin, networkLedger, legalDocument, resumableSignupState, clerkChunkPaths);
    try {
      await exerciseResumableMobileSignup(resumableSignupPage.page, origin, resumableSignupState);
      assert.deepEqual(resumableSignupPage.consoleProblems, [], "resumable iPhone signup must have no console errors");
    } finally { await resumableSignupPage.context.close(); }

    const signupZoomState = { mode: "signup", signedOut: true, accepted: false, receiptStatus: "pending" };
    const signupZoomPage = await createQaPage(browser, signupZoomViewport, origin, networkLedger, legalDocument, signupZoomState, clerkChunkPaths);
    try {
      await exerciseSignupZoom(signupZoomPage.page, origin);
      assert.deepEqual(signupZoomPage.consoleProblems, [], "200 percent zoom signup must have no console errors");
    } finally { await signupZoomPage.context.close(); }

    const returningState = { mode: "dashboard", signedOut: true, accepted: true, receiptStatus: "sent" };
    const returningPage = await createQaPage(browser, viewports[1], origin, networkLedger, legalDocument, returningState, clerkChunkPaths);
    try {
      await exerciseReturningSignInAndHeader(returningPage.page, origin);
      assert.deepEqual(returningPage.consoleProblems, [], "returning sign-in and shared header must have no console errors");
    } finally { await returningPage.context.close(); }

    const delayedState = { mode: "dashboard", signedOut: true, accepted: true, receiptStatus: "sent", bootstrapFailuresRemaining: 5 };
    const delayedPage = await createQaPage(browser, viewports[1], origin, networkLedger, legalDocument, delayedState, clerkChunkPaths);
    try {
      await exerciseDelayedProvisioningRecovery(delayedPage.page, origin, delayedState);
      assert.equal(delayedPage.consoleProblems.filter((message) => /503 \(Service Unavailable\)/.test(message)).length, 5, "the delayed provisioning fixture must exercise exactly five transient responses");
      assert.deepEqual(delayedPage.consoleProblems.filter((message) => !/503 \(Service Unavailable\)/.test(message)), [], "delayed provisioning recovery must have no unexpected console errors");
    } finally { await delayedPage.context.close(); }

    const incompleteProfileState = { mode: "dashboard", signedOut: true, accepted: false, receiptStatus: "pending", dashboardProfileIncomplete: true };
    const incompleteProfilePage = await createQaPage(browser, viewports[1], origin, networkLedger, legalDocument, incompleteProfileState, clerkChunkPaths);
    try {
      await exerciseValidSessionIncompleteProfile(incompleteProfilePage.page, origin);
      assert.deepEqual(incompleteProfilePage.consoleProblems, [], "valid session with incomplete profile must have no console errors");
    } finally { await incompleteProfilePage.context.close(); }

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
          receiptStatus: viewport.name === "iphone" ? "sent" : viewport.name === "zoom" ? "failed" : "pending",
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
    assert.equal(identityBootstrapWrites, 13, "identity/profile bootstrap must cover dashboard, two exact-once verified signups, returning sign-in, delayed retry and incomplete-profile journeys");
    assert.equal(mockedWriteCounts["/api/v1/me/profile"], 2);
    assert.equal(mockedWriteCounts["/api/v1/me/waiver/review"], 3);
    assert.equal(mockedWriteCounts["/api/v1/me/waiver/accept"], 3);
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
