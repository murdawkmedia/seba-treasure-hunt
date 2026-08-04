import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/server/app";
import {
  FINDER_SHARING_NOTICE_VERSION,
  normalizePublicationPreference,
} from "../src/shared/report-sharing";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeOperatorAlertSender,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson,
} from "./api-test-kit";

const origin = "https://www.timlostsomething.com";

const makeApp = () => {
  const store = new FakeStore();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    operatorAlerts: new FakeOperatorAlertSender(),
    environment: new FakeEnvironment(),
  });
  return { app, store };
};

const report = (overrides: Record<string, unknown> = {}) => ({
  type: "find",
  name: "A Finder",
  email: "finder@example.test",
  locationDescription: "Near the signed public path",
  details: "I found the pictured item and took it with me.",
  publicationPreference: "share_after_review",
  sharingNoticeVersion: FINDER_SHARING_NOTICE_VERSION,
  sharingAcknowledgementAccepted: true,
  ...overrides,
});

test("normalizes only the two supported finder publication choices", () => {
  assert.equal(normalizePublicationPreference("share_after_review"), "share_after_review");
  assert.equal(normalizePublicationPreference("private"), "private");
  assert.equal(normalizePublicationPreference("publish_now"), null);
});

test("find reports accept optional photos and store the versioned sharing choice", async () => {
  const { app, store } = makeApp();
  const response = await app.request(`${origin}/api/v1/reports`, {
    method: "POST",
    ...json(report({ customItemName: "A mysterious little box" }), {
      "idempotency-key": "optional-photo-find",
      "cf-turnstile-response": "human-token",
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(store.reports[0]?.customItemName, "A mysterious little box");
  assert.equal(store.reports[0]?.publicationPreference, "share_after_review");
  assert.equal(store.reports[0]?.sharingNoticeVersion, FINDER_SHARING_NOTICE_VERSION);
  assert.match(String(store.reports[0]?.sharingNoticeAcceptedAt), /^\d{4}-\d{2}-\d{2}T/);
});

test("report capture rejects a missing or stale sharing acknowledgement", async () => {
  const { app } = makeApp();
  const missing = await app.request(`${origin}/api/v1/reports`, {
    method: "POST",
    ...json(report({ sharingAcknowledgementAccepted: false }), {
      "idempotency-key": "missing-sharing-ack",
      "cf-turnstile-response": "human-token",
    }),
  });
  assert.equal(missing.status, 422);
  assert.equal((await responseJson(missing)).error.code, "sharing_acknowledgement_required");

  const stale = await app.request(`${origin}/api/v1/reports`, {
    method: "POST",
    ...json(report({ sharingNoticeVersion: "2025.9" }), {
      "idempotency-key": "stale-sharing-ack",
      "cf-turnstile-response": "human-token",
    }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await responseJson(stale)).error.code, "sharing_notice_outdated");
});

test("a report cannot identify both a known item and a custom item", async () => {
  const { app } = makeApp();
  const response = await app.request(`${origin}/api/v1/reports`, {
    method: "POST",
    ...json(report({ caseItemId: "item-camera", customItemName: "A second camera" }), {
      "idempotency-key": "known-and-custom",
      "cf-turnstile-response": "human-token",
    }),
  });
  assert.equal(response.status, 422);
  assert.equal((await responseJson(response)).error.code, "report_item_choice_invalid");
});

test("an item find must identify a known item or name the item", async () => {
  const { app } = makeApp();
  const response = await app.request(`${origin}/api/v1/reports`, {
    method: "POST",
    ...json(report(), {
      "idempotency-key": "missing-item-choice",
      "cf-turnstile-response": "human-token",
    }),
  });
  assert.equal(response.status, 422);
  assert.equal((await responseJson(response)).error.code, "report_item_required");
});

test("confirmed Case Note publication closes only a configured finite known item", async () => {
  const { app, store } = makeApp();
  store.caseItems.push({
    id: "item-cash",
    slug: "cash",
    owner: "tim",
    category: "cash",
    title: "Cash keeps appearing",
    description: "Cash is still appearing.",
    finderKeeps: true,
    closeOnFind: false,
    status: "out_there",
    displayOrder: 2,
    reportable: true,
    version: 1,
    uploads: [],
  });
  store.reports.push({
    id: "report-camera",
    type: "find",
    status: "verified",
    publicAttribution: "Community Hunter",
    attributionKind: "community",
    publicationPreference: "share_after_review",
    caseItemId: "item-camera",
    caseItemTitle: "A camera",
    media: [],
  }, {
    id: "report-cash",
    type: "find",
    status: "verified",
    publicAttribution: "Community Hunter",
    attributionKind: "community",
    publicationPreference: "share_after_review",
    caseItemId: "item-cash",
    caseItemTitle: "Cash keeps appearing",
    media: [],
  }, {
    id: "report-custom",
    type: "find",
    status: "verified",
    publicAttribution: "Community Hunter",
    attributionKind: "community",
    publicationPreference: "share_after_review",
    customItemName: "A mystery trinket",
    media: [],
  });
  const headers = { authorization: "Bearer staff-token", origin };
  for (const id of ["report-camera", "report-cash", "report-custom"]) {
    const response = await app.request(`${origin}/api/v1/ops/reports/${id}/case-note`, {
      method: "POST",
      ...json({ body: `Reviewed public note for ${id}.`, mediaIds: [] }, headers),
    });
    assert.equal(response.status, 200);
  }

  const camera = store.caseItems.find((item) => item.id === "item-camera");
  const cash = store.caseItems.find((item) => item.id === "item-cash");
  assert.equal(camera?.status, "found");
  assert.equal(camera?.version, 2);
  assert.equal(cash?.status, "out_there");
  assert.equal(cash?.version, 1);
  assert.equal(store.audits.some((event) => event.action === "case_item.found_from_case_note"), true);
});
