import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import type { PlayerAccessState } from "../src/server/types";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeOperatorAlertSender,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  responseJson
} from "./api-test-kit";

const origin = "https://www.timlostsomething.com";
const hunterHeaders = { authorization: "Bearer hunter-token" };

const item = (
  id: string,
  slug: string,
  audience: "public" | "hunter_only",
  mediaAudience: "public" | "hunter_only"
) => ({
  id,
  slug,
  owner: "tim",
  category: "object",
  title: slug === "camera" ? "A camera" : "A wallet",
  description: "Out there.",
  finderKeeps: false,
  status: "out_there",
  displayOrder: id === "public" ? 1 : 2,
  collection: "fresh_drops",
  collectionOrder: id === "public" ? 1 : 2,
  audience,
  showOnBoard: audience === "public",
  teaserOrder: id === "public" ? 1 : null,
  reportable: true,
  version: 1,
  uploads: [{
    id: `${id}-media`,
    key: "derivatives/media-ready.webp",
    contentType: "image/webp",
    status: "ready",
    position: 0,
    altText: `Evidence for ${slug}`,
    caption: null,
    audience: mediaAudience
  }]
});

const makeApp = () => {
  const store = new FakeStore();
  store.caseItems = [
    item("public", "camera", "public", "public"),
    item("private", "wallet", "hunter_only", "hunter_only")
  ];
  const uploads = new FakeUploads();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads,
    rateLimits: new FakeRateLimits(),
    operatorAlerts: new FakeOperatorAlertSender(),
    environment: new FakeEnvironment()
  });
  return { app, store };
};

const unlockedAccess: PlayerAccessState = {
  accountState: "active",
  profileComplete: true,
  privacyMediaRequired: false,
  privacyMediaVersion: "2026.2",
  waiverStatus: "accepted",
  waiverVersion: "2026.1",
  participationUnlocked: true
};

test("public items exclude hunter-only records and media", async () => {
  const { app } = makeApp();
  const response = await app.request(`${origin}/api/v1/items`);
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.map((candidate: { id: string }) => candidate.id), ["public"]);
  assert.doesNotMatch(JSON.stringify(body), /private-media|wallet/);
  assert.equal("collectionOrder" in body.data[0], false);
});

test("Fresh Drops requires an unlocked hunter", async () => {
  const { app } = makeApp();
  assert.equal((await app.request(`${origin}/api/v1/me/fresh-drops`)).status, 401);

  const locked = await app.request(`${origin}/api/v1/me/fresh-drops`, { headers: hunterHeaders });
  assert.equal(locked.status, 403);
  assert.equal((await responseJson(locked)).error.code, "participation_locked");
});

test("an unlocked hunter receives hunter-only items and private media", async () => {
  const { app, store } = makeApp();
  store.getPlayerAccess = async () => unlockedAccess;

  const response = await app.request(`${origin}/api/v1/me/fresh-drops`, { headers: hunterHeaders });
  const body = await responseJson(response);
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.map((candidate: { id: string }) => candidate.id), ["public", "private"]);
  assert.match(body.data[1].media[0].url, /^\/api\/v1\/me\/fresh-drops\/media\/private-media$/);

  const media = await app.request(`${origin}/api/v1/me/fresh-drops/media/private-media`, {
    headers: hunterHeaders
  });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("cache-control"), "private, no-store");
});

test("hunter media cannot be read through the public media endpoint", async () => {
  const { app, store } = makeApp();
  store.publicMedia.set("private-media", {
    key: "derivatives/media-ready.webp",
    contentType: "image/webp",
    cacheControl: "no-store"
  });

  assert.equal((await app.request(`${origin}/api/v1/media/private-media`)).status, 404);
});

test("only an unlocked hunter can associate a report with a reportable Fresh Drop", async () => {
  const { app, store } = makeApp();
  store.getPlayerAccess = async () => unlockedAccess;
  const request = (headers: Record<string, string>) => app.request(`${origin}/api/v1/reports`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      "cf-turnstile-response": "human-token",
      origin,
      ...headers,
    },
    body: JSON.stringify({
      publicationPreference: "private",
      sharingNoticeVersion: "2026.1",
      sharingAcknowledgementAccepted: true,
      type: "tip",
      name: "A Hunter",
      email: "hunter@example.test",
      locationDescription: "Near the public trail",
      details: "I found the item shown in Fresh Drops.",
      publicAttributionKind: "community",
      caseItemId: "private",
    }),
  });

  const guest = await request({});
  assert.equal(guest.status, 401);

  const response = await request(hunterHeaders);
  const body = await responseJson(response);
  assert.equal(response.status, 201);
  assert.equal(body.data.caseItemId, "private");
  assert.equal(body.data.caseItemTitle, "A wallet");
});
