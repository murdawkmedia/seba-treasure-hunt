import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatStatusUpdated,
  normalizeStatusEnvelope,
} from "../src/client/status";
import {
  applyPrefill,
  buildReportFormData,
  buildReportRequestHeaders,
  buildReportPayload,
  failReportAttempt,
  mergeReportWaypointChoices,
  normalizeReportWaypoints,
  reportErrorSelector,
  reportLocationResetModel,
  reportProfilePrefill,
  reportSuccessModel,
  validateReportDraft,
  waitForReportToken,
  type ReportDraft,
} from "../src/client/report";
import {
  buildProfilePayload,
  profileMutationInvalidatesWaiver,
  supervisedDependantsState,
  validateProfileDraft,
  waiverMinorsForParticipationBasis,
  waitForActiveSession,
  type HunterProfileDraft,
} from "../src/client/dashboard";

function reportStaticWaypointChoices() {
  const html = readFileSync(new URL("../report.html", import.meta.url), "utf8");
  const select = html.match(/<select id="report-waypoint"[\s\S]*?<\/select>/)?.[0] ?? "";
  return [...select.matchAll(/<option\b([^>]*)data-report-waypoint([^>]*)>([^<]*)<\/option>/g)].map(
    (match) => {
      const attributes = `${match[1]}${match[2]}`;
      return {
        id: attributes.match(/\bvalue="([^"]+)"/)?.[1] ?? "",
        routeOrder: Number(attributes.match(/\bdata-route-order="([^"]+)"/)?.[1]),
        name: match[3]?.trim() ?? "",
      };
    },
  );
}

test("status parser fails closed when the API response is absent or malformed", () => {
  assert.equal(normalizeStatusEnvelope(undefined).state, "unavailable");
  assert.equal(normalizeStatusEnvelope({ data: { state: "OPEN" } }).state, "unavailable");
  assert.equal(
    normalizeStatusEnvelope({
      data: {
        state: "paused",
        hours: {
          opens: "09:00",
          closes: "20:00",
          timezone: "America/Edmonton",
        },
        updatedAt: "2026-07-11T16:00:00.000Z",
        nextClue: null,
        version: 3,
      },
    }).state,
    "paused",
  );
});

test("status timestamp formatter includes an absolute time and relative age", () => {
  const label = formatStatusUpdated(
    "2026-07-11T16:00:00.000Z",
    new Date("2026-07-11T18:05:00.000Z"),
  );
  assert.match(label, /Jul/);
  assert.match(label, /2 hours ago/);
});

test("active-session wait tolerates one transient token rejection", async () => {
  let reads = 0;
  const session = {
    id: "session-1",
    getToken: async () => {
      reads += 1;
      if (reads === 1) throw new Error("not ready");
      return "token";
    },
  };
  const delays: number[] = [];
  assert.equal(await waitForActiveSession("session-1", () => session, async (ms) => { delays.push(ms); }, 3), true);
  assert.deepEqual(delays, [150]);
});

test("active-session wait returns false after bounded null-token attempts", async () => {
  let reads = 0;
  const session = { id: "session-1", getToken: async () => { reads += 1; return null; } };
  assert.equal(await waitForActiveSession("session-1", () => session, async () => undefined, 3), false);
  assert.equal(reads, 3);
});

test("active-session wait accepts delayed session activation", async () => {
  let checks = 0;
  const session = { id: "session-1", getToken: async () => "token" };
  assert.equal(
    await waitForActiveSession("session-1", () => (++checks < 3 ? null : session), async () => undefined, 4),
    true,
  );
});

const baseReport: ReportDraft = {
  type: "tip",
  name: "A Hunter",
  email: "hunter@example.test",
  phone: "",
  waypointId: "4",
  locationDescription: "Near the signed trail entrance.",
  details: "I saw a small elastic-wrapped bundle beside the path.",
  photo: null,
  turnstileToken: "verified-token",
  coordinates: null,
  accuracy: true,
  publicAttributionKind: "hunter_handle",
};

test("report waypoints preserve stable IDs while sorting and labeling by public route order", () => {
  assert.deepEqual(
    normalizeReportWaypoints({
      data: [
        { id: 5, routeOrder: 6, name: "The Lookout" },
        { id: "13", routeOrder: 5, name: " Derby's Lakeview General Store " },
        { id: 1, routeOrder: 1, name: "The Creek Property" },
        { id: "13", routeOrder: 5, name: "Duplicate Derby's" },
        { id: 0, routeOrder: 2, name: "Invalid low" },
        { id: "14", routeOrder: 13, name: "Invalid high" },
        { id: 2, routeOrder: 14, name: "Invalid order" },
        { id: 3, name: "Missing order" },
        { id: 4, routeOrder: 4, name: " " },
        { id: true, routeOrder: 2, name: "Boolean ID" },
        { id: "1e1", routeOrder: 10, name: "Exponent ID" },
        { id: 2, routeOrder: "02", name: "Leading-zero order" },
      ],
    }),
    [
      { id: "1", routeOrder: 1, name: "The Creek Property" },
      { id: "13", routeOrder: 5, name: "Derby's Lakeview General Store" },
      { id: "5", routeOrder: 6, name: "The Lookout" },
    ],
  );
});

test("report waypoint labels use public order while option values remain stable IDs", async () => {
  const reportModule = await import("../src/client/report") as Record<string, unknown>;
  assert.equal(typeof reportModule.reportWaypointLabel, "function");
  if (typeof reportModule.reportWaypointLabel !== "function") return;
  assert.equal(
    reportModule.reportWaypointLabel({ id: "13", routeOrder: 5, name: "Derby's Lakeview General Store" }),
    "Stop 05 · Derby's General Store",
  );
});

test("static report options expose stable IDs paired with public route order", () => {
  assert.deepEqual(
    reportStaticWaypointChoices().map(({ id, routeOrder }) => [id, routeOrder]),
    [
      ["1", 1], ["2", 2], ["3", 3], ["4", 4], ["13", 5], ["5", 6], ["6", 7],
      ["7", 8], ["8", 9], ["9", 10], ["10", 11], ["11", 12], ["12", 13],
    ],
  );
});

test("actual static report choices survive partial and empty waypoint refreshes", () => {
  const staticChoices = reportStaticWaypointChoices();
  const partial = mergeReportWaypointChoices(staticChoices, {
    data: [
      { id: 13, routeOrder: 5, name: "Derby's Lakeview General Store" },
      { id: "5", routeOrder: 6, name: "The Lookout" },
      { id: 14, routeOrder: 13, name: "Invalid" },
    ],
  });
  assert.equal(partial.length, 13);
  assert.equal(partial[0]?.name, "Stop 01 · Creek Property");
  assert.equal(partial[4]?.id, "13");
  assert.equal(partial[4]?.name, "Derby's Lakeview General Store");
  assert.equal(partial[5]?.id, "5");

  const empty = mergeReportWaypointChoices(partial, { data: [] });
  assert.equal(empty.length, 13);
  assert.deepEqual(empty, partial);
});

test("dashboard route rows and record labels use public order without guessing hidden metadata", async () => {
  const dashboardModule = await import("../src/client/dashboard") as Record<string, unknown>;
  assert.equal(typeof dashboardModule.normalizeDashboardWaypoints, "function");
  assert.equal(typeof dashboardModule.dashboardRecordWaypointLabel, "function");
  if (typeof dashboardModule.normalizeDashboardWaypoints !== "function" || typeof dashboardModule.dashboardRecordWaypointLabel !== "function") return;
  const normalized = dashboardModule.normalizeDashboardWaypoints([
    { id: 5, routeOrder: 6, name: "The Lookout", description: "Public description", zoneState: "open", exactUrl: null },
    { id: 13, routeOrder: 5, name: "Derby's Lakeview General Store", description: "Public description", zoneState: "open", exactUrl: null },
    { id: 14, routeOrder: 13, name: "Invalid", description: "No", zoneState: "open", exactUrl: null },
  ]) as Array<{ id: number; routeOrder: number }>;
  assert.deepEqual(normalized.map((row) => [row.id, row.routeOrder]), [[13, 5], [5, 6]]);
  assert.equal(dashboardModule.dashboardRecordWaypointLabel({ waypointId: 13, waypointRouteOrder: 5, waypointName: "Derby's Lakeview General Store" }), "Waypoint 5 — Derby's Lakeview General Store");
  assert.equal(dashboardModule.dashboardRecordWaypointLabel({ waypointId: 5, waypointRouteOrder: null, waypointName: null }), "Waypoint details unavailable");
});

test("report request headers authenticate signed-in hunters without gating public reporters", () => {
  const signedIn = buildReportRequestHeaders("report-key", "hunter-token");
  assert.equal(signedIn.get("Idempotency-Key"), "report-key");
  assert.equal(signedIn.get("Authorization"), "Bearer hunter-token");
  const publicHeaders = buildReportRequestHeaders("public-key", null);
  assert.equal(publicHeaders.get("Idempotency-Key"), "public-key");
  assert.equal(publicHeaders.has("Authorization"), false);
});

test("report token acquisition tolerates bounded Clerk activation delay", async () => {
  const tokens = [null, null, "hunter-token"];
  const delays: number[] = [];
  assert.equal(
    await waitForReportToken(
      async () => tokens.shift() ?? null,
      async (milliseconds) => { delays.push(milliseconds); },
      4,
    ),
    "hunter-token",
  );
  assert.deepEqual(delays, [150, 150]);

  let attempts = 0;
  assert.equal(
    await waitForReportToken(
      async () => { attempts += 1; throw new Error("session not ready"); },
      async () => undefined,
      3,
    ),
    null,
  );
  assert.equal(attempts, 3);
});

test("failed report attempts clear and reset human proof while preserving the idempotency key", () => {
  let resets = 0;
  assert.deepEqual(failReportAttempt("report-key", () => { resets += 1; }), {
    idempotencyKey: "report-key",
    turnstileToken: "",
  });
  assert.equal(resets, 1);
});

test("an input edit during a deferred failed report restores the request's original retry key", async () => {
  let rejectRequest!: (reason?: unknown) => void;
  const request = new Promise<void>((_resolve, reject) => { rejectRequest = reject; });
  let pendingKey: string | undefined = "report-key";
  const attemptKey = pendingKey;
  let resets = 0;
  const running = request.catch(() => {
    const failure = failReportAttempt(attemptKey, () => { resets += 1; });
    pendingKey = failure.idempotencyKey;
  });

  pendingKey = undefined; // The form's input/change handler runs while the POST is pending.
  rejectRequest(new Error("network failed"));
  await running;

  assert.equal(pendingKey, "report-key");
  assert.equal(resets, 1);
});

test("another-report reset restores location UI and Turnstile uses a real focus target", () => {
  assert.deepEqual(reportLocationResetModel(), {
    buttonText: "Use my current location",
    stateText: "Location sharing is optional and starts only when you press the button.",
  });
  assert.equal(reportErrorSelector("turnstileToken"), "[data-turnstile]");
  assert.equal(reportErrorSelector("photo"), '[name="images"]');
  assert.equal(reportErrorSelector("email"), '[name="email"]');
});

test("report profile prefill preserves anything already typed", () => {
  assert.deepEqual(reportProfilePrefill({ fullName: " Alex Hunter ", email: " alex@example.ca " }), {
    name: "Alex Hunter",
    email: "alex@example.ca",
  });
  assert.deepEqual(reportProfilePrefill({ data: { fullName: "Nested Hunter", email: "nested@example.ca" } }), {
    name: "Nested Hunter",
    email: "nested@example.ca",
  });
  assert.deepEqual(reportProfilePrefill(null), { name: "", email: "" });
  assert.equal(applyPrefill("Typed Name", "Profile Name"), "Typed Name");
  assert.equal(applyPrefill("", "Profile Name"), "Profile Name");
});

test("successful private reports retain an explicit receipt reference", () => {
  assert.deepEqual(reportSuccessModel({ id: "report-123" }), {
    reference: "report-123",
    heading: "Report received privately",
    message: "This report stays private unless a representative from SebaHub deliberately approves a public version.",
  });
  assert.deepEqual(reportSuccessModel({}), {
    reference: "recorded",
    heading: "Report received privately",
    message: "This report stays private unless a representative from SebaHub deliberately approves a public version.",
  });
});

test("report payload omits non-waypoint fallback choices", () => {
  for (const waypointId of ["", "not_sure", "different_location", "01", "+1", "1e1", "0xA"]) {
    assert.equal("waypointId" in buildReportPayload({ ...baseReport, waypointId }), false);
  }
  assert.equal(buildReportPayload({ ...baseReport, waypointId: "12" }).waypointId, "12");
  assert.equal(buildReportPayload({ ...baseReport, waypointId: "13" }).waypointId, "13");
  assert.equal("waypointId" in buildReportPayload({ ...baseReport, waypointId: "14" }), false);
});

test("find reports require an image while tips and safety reports do not", () => {
  assert.deepEqual(validateReportDraft(baseReport), {});
  assert.equal(
    validateReportDraft({ ...baseReport, type: "find" }).photo,
    "Add a clear photo for a find claim.",
  );
  assert.deepEqual(validateReportDraft({ ...baseReport, type: "safety" }), {});
});

test("report payload carries the required attribution choice but never a public label", () => {
  const payload = buildReportPayload({ ...baseReport, publicAttributionKind: "display_name" });
  assert.equal(payload.publicAttributionKind, "display_name");
  assert.equal("publicAttribution" in payload, false);
  assert.equal(
    validateReportDraft({ ...baseReport, publicAttributionKind: "" as ReportDraft["publicAttributionKind"] })
      .publicAttributionKind,
    "Choose how this report may be credited if a representative from SebaHub publishes it.",
  );
});

test("report form data uses browser-prepared upload files", () => {
  const original = new File(["original"], "large.jpg", { type: "image/jpeg" });
  const prepared = new File(["prepared"], "large.webp", { type: "image/webp" });
  const formData = buildReportFormData(
    { ...baseReport, type: "find", photo: original },
    [prepared],
  );
  const images = formData.getAll("images");
  assert.equal(images.length, 1);
  assert.equal((images[0] as File).name, "large.webp");
  assert.equal((images[0] as File).type, "image/webp");
});

test("report payload includes coordinates only after explicit location capture", () => {
  const withoutLocation = buildReportPayload(baseReport);
  assert.equal("latitude" in withoutLocation, false);
  assert.equal("longitude" in withoutLocation, false);

  const withLocation = buildReportPayload({
    ...baseReport,
    coordinates: { latitude: 53.5, longitude: -114.7 },
  });
  assert.equal(withLocation.latitude, 53.5);
  assert.equal(withLocation.longitude, -114.7);
});

test("report validation catches missing contact, context, and human proof", () => {
  const errors = validateReportDraft({
    ...baseReport,
    name: " ",
    email: "not-an-email",
    locationDescription: "",
    details: "",
    turnstileToken: "",
    accuracy: false,
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    "accuracy",
    "details",
    "email",
    "locationDescription",
    "name",
    "turnstileToken",
  ]);
});

const baseProfile: HunterProfileDraft = {
  fullName: "A Hunter",
  publicDisplayName: "Trail Friends",
  townArea: "Seba Beach",
  interests: ["community", "outdoors"],
  discoverySource: "friend",
  participationBasis: "adult",
  guardianPermissionAttested: false,
  privacyMediaAccepted: true,
  huntEmail: true,
  marketing: false,
};

test("hunter profile requires a participation basis, a name, and the current privacy-media notice", () => {
  assert.deepEqual(validateProfileDraft(baseProfile), {});
  assert.deepEqual(
    validateProfileDraft({
      ...baseProfile,
      fullName: " ",
      participationBasis: "" as HunterProfileDraft["participationBasis"],
      privacyMediaAccepted: false,
    }),
    {
      fullName: "Enter your name.",
      participationBasis: "Choose whether you are 18 or older or participating with guardian permission.",
      privacyMediaAccepted: "Read and accept the current Privacy Policy & Media Notice.",
    },
  );
});

test("minor profile requires guardian permission while an adult profile does not", () => {
  assert.deepEqual(validateProfileDraft({
    ...baseProfile,
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttested: false,
  }), {
    guardianPermissionAttested: "Confirm that your parent or legal guardian reviewed the documents, gave permission, and will supervise your participation.",
  });
  assert.deepEqual(validateProfileDraft({
    ...baseProfile,
    participationBasis: "minor_guardian_permission",
    guardianPermissionAttested: true,
  }), {});
});

test("profile payload keeps hunt and marketing permissions separate", () => {
  assert.deepEqual(buildProfilePayload(baseProfile), {
    fullName: "A Hunter",
    publicDisplayName: "Trail Friends",
    townArea: "Seba Beach",
    interests: ["community", "outdoors"],
    discoverySource: "friend",
    participationBasis: "adult",
    guardianPermissionAttested: false,
    privacyMediaAccepted: true,
    privacyMediaVersion: "2026.3",
    consents: { huntEmail: true, marketing: false },
  });
});

test("optional public display names use a short, non-contact public label", () => {
  assert.deepEqual(validateProfileDraft({ ...baseProfile, publicDisplayName: "Nancy & Ron" }), {});
  assert.equal(
    validateProfileDraft({ ...baseProfile, publicDisplayName: "nobody@example.ca" }).publicDisplayName,
    "Use a public name without an email address or phone number.",
  );
  assert.equal(
    validateProfileDraft({ ...baseProfile, publicDisplayName: "A" }).publicDisplayName,
    "Public display names must be 2 to 40 characters, or left blank.",
  );
});

test("changing a participant name or participation basis invalidates the displayed waiver", () => {
  const adult = { fullName: "A Hunter", participationBasis: "adult" };
  assert.equal(profileMutationInvalidatesWaiver(adult, { ...adult, fullName: "A New Hunter" }), true);
  assert.equal(profileMutationInvalidatesWaiver(adult, {
    ...adult,
    participationBasis: "minor_guardian_permission",
  }), true);
  assert.equal(profileMutationInvalidatesWaiver(adult, { ...adult, townArea: "Seba Beach" }), false);
});

test("minor participants cannot retain or submit supervised-dependent rows", () => {
  assert.deepEqual(supervisedDependantsState("minor_guardian_permission"), {
    hidden: true,
    disabled: true,
    clearRows: true,
  });
  assert.deepEqual(supervisedDependantsState("adult"), {
    hidden: false,
    disabled: false,
    clearRows: false,
  });
  assert.deepEqual(
    waiverMinorsForParticipationBasis("minor_guardian_permission", [
      { fullName: "Hidden Minor", birthYear: "2014" },
    ]),
    [],
  );
});

test("signup legal review never needs to toggle acceptance controls", () => {
  const client = readFileSync(new URL("../src/client/dashboard.ts", import.meta.url), "utf8");
  const setup = client.match(/function setupSignupLegalReview[\s\S]*?\r?\n}\r?\n\r?\nasync function saveSignupProfileAndPrivacy/)?.[0] ?? "";

  assert.match(setup, /dialog\.showModal\(\)/);
  assert.match(setup, /reloadSignupLegalViewer/);
  assert.doesNotMatch(setup, /\.checked\s*=|\.disabled\s*=/);
});
