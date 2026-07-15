import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStatusUpdated,
  normalizeStatusEnvelope,
} from "../src/client/status";
import {
  buildReportPayload,
  validateReportDraft,
  type ReportDraft,
} from "../src/client/report";
import {
  buildProfilePayload,
  validateProfileDraft,
  waitForActiveSession,
  type HunterProfileDraft,
} from "../src/client/dashboard";

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
  waypointId: "wp-4",
  locationDescription: "Near the signed trail entrance.",
  details: "I saw a small elastic-wrapped bundle beside the path.",
  photo: null,
  turnstileToken: "verified-token",
  coordinates: null,
  accuracy: true,
};

test("find reports require an image while tips and safety reports do not", () => {
  assert.deepEqual(validateReportDraft(baseReport), {});
  assert.equal(
    validateReportDraft({ ...baseReport, type: "find" }).photo,
    "Add a clear photo for a find claim.",
  );
  assert.deepEqual(validateReportDraft({ ...baseReport, type: "safety" }), {});
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
  townArea: "Seba Beach",
  interests: ["community", "outdoors"],
  discoverySource: "friend",
  adultAttested: true,
  privacyMediaAccepted: true,
  huntEmail: true,
  marketing: false,
};

test("hunter profile requires an adult, a name, and the current privacy-media notice", () => {
  assert.deepEqual(validateProfileDraft(baseProfile), {});
  assert.deepEqual(
    validateProfileDraft({
      ...baseProfile,
      fullName: " ",
      adultAttested: false,
      privacyMediaAccepted: false,
    }),
    {
      fullName: "Enter your name.",
      adultAttested: "An adult participant must accept the eligibility statement.",
      privacyMediaAccepted: "Read and accept the current Privacy Policy & Media Notice.",
    },
  );
});

test("profile payload keeps hunt and marketing permissions separate", () => {
  assert.deepEqual(buildProfilePayload(baseProfile), {
    fullName: "A Hunter",
    townArea: "Seba Beach",
    interests: ["community", "outdoors"],
    discoverySource: "friend",
    adultAttested: true,
    privacyMediaAccepted: true,
    privacyMediaVersion: "2026.2",
    consents: { huntEmail: true, marketing: false },
  });
});
