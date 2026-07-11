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
  phone: "",
  townArea: "Seba Beach",
  ageBand: "35-44",
  interests: ["community", "outdoors"],
  discoverySource: "friend",
  adultAttested: true,
  huntEmail: true,
  marketing: false,
  sms: false,
  turnstileToken: "verified-token",
};

test("hunter profile requires an adult, a name, and human verification", () => {
  assert.deepEqual(validateProfileDraft(baseProfile), {});
  assert.deepEqual(
    validateProfileDraft({
      ...baseProfile,
      fullName: " ",
      adultAttested: false,
      turnstileToken: "",
    }),
    {
      fullName: "Enter your name.",
      adultAttested: "An adult participant must accept the eligibility statement.",
      turnstileToken: "Complete the human check.",
    },
  );
});

test("SMS consent requires a phone and profile payload keeps consent purposes separate", () => {
  assert.equal(
    validateProfileDraft({ ...baseProfile, sms: true }).phone,
    "Add a phone number before choosing SMS updates.",
  );
  assert.deepEqual(buildProfilePayload(baseProfile), {
    fullName: "A Hunter",
    phone: null,
    townArea: "Seba Beach",
    ageBand: "35-44",
    interests: ["community", "outdoors"],
    discoverySource: "friend",
    adultAttested: true,
    consents: { huntEmail: true, marketing: false, sms: false },
    cfTurnstileResponse: "verified-token",
  });
});
