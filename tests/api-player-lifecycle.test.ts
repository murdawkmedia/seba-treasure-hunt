import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import {
  FakeIdentity,
  FakeEnvironment,
  FakeRateLimits,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson,
} from "./api-test-kit";
import type { IdentityLifecycleEvent, PlayerAccessState } from "../src/server/types";

const auth = { authorization: "Bearer hunter-token" };

class PlayerStore extends FakeStore {
  accounts = new Map<string, Record<string, unknown>>();
  legalEvents: Array<Record<string, unknown>> = [];
  identityEvents = new Set<string>();

  async upsertPlayerAccount(subject: string, verifiedEmail: string) {
    const existing = this.accounts.get(subject);
    const account = {
      subject,
      verifiedEmail,
      accountState: "active",
      createdAt: existing?.createdAt ?? "2026-07-13T12:00:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z",
    };
    this.accounts.set(subject, account);
    return account;
  }

  async getPlayerAccess(subject: string): Promise<PlayerAccessState> {
    const profileComplete = this.profiles.has(subject);
    const privacyAccepted = this.legalEvents.some(
      (event) => event.subject === subject && event.documentType === "privacy_media" && event.version === "2026.1",
    );
    return {
      accountState: this.accounts.has(subject) ? "active" : "missing",
      profileComplete,
      privacyMediaRequired: !privacyAccepted,
      privacyMediaVersion: privacyAccepted ? "2026.1" : null,
      waiverStatus: "pending",
      waiverVersion: null,
      participationUnlocked: false,
    };
  }

  override async upsertProfile(subject: string, input: Record<string, unknown>) {
    if (input.privacyMediaAccepted === true) {
      this.legalEvents.push({
        subject,
        documentType: "privacy_media",
        version: input.privacyMediaVersion,
        documentHash: input.privacyMediaHash,
      });
    }
    return await super.upsertProfile(subject, input);
  }

  async applyIdentityEvent(event: IdentityLifecycleEvent) {
    const eventId = String(event.id);
    if (this.identityEvents.has(eventId)) return { replayed: true };
    this.identityEvents.add(eventId);
    const data = event.data as Record<string, unknown>;
    if (event.type === "user.deleted") this.accounts.delete(String(data.subject));
    else await this.upsertPlayerAccount(String(data.subject), String(data.verifiedEmail));
    return { replayed: false };
  }

  async listPlayers() {
    return {
      counts: { verifiedAccounts: this.accounts.size, completedProfiles: this.profiles.size, huntEmail: 0, marketing: 0 },
      items: [...this.accounts.values()],
      nextCursor: null,
    };
  }
}

class FakeWebhookVerifier {
  async verify(request: Request) {
    const id = request.headers.get("svix-id");
    if (!id || !["evt_1", "evt_hunter"].includes(id)) return null;
    return {
      id,
      type: "user.created",
      data: id === "evt_hunter"
        ? { subject: "hunter-1", verifiedEmail: "hunter@example.test" }
        : { subject: "hunter-webhook", verifiedEmail: "webhook@example.test" },
    };
  }
}

const makeApp = () => {
  const store = new PlayerStore();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits: new FakeRateLimits(),
    webhooks: new FakeWebhookVerifier(),
    environment: new FakeEnvironment(),
  } as never);
  return { app, store };
};

const acceptedProfile = {
  fullName: "A Hunter",
  townArea: "Seba Beach",
  interests: ["treasure-hunt"],
  discoverySource: "friend",
  adultAttested: true,
  privacyMediaAccepted: true,
  privacyMediaVersion: "2026.1",
  consents: { huntEmail: false, marketing: false },
};

const syncVerifiedHunter = async (app: ReturnType<typeof createApi>) => {
  await app.request("https://www.timlostsomething.com/api/v1/webhooks/clerk", {
    method: "POST",
    headers: { "svix-id": "evt_hunter", "content-type": "application/json" },
    body: "{}",
  });
};

test("verified hunters bootstrap a private player account before completing a profile", async () => {
  const { app, store } = makeApp();
  const pending = await app.request("https://www.timlostsomething.com/api/v1/me/bootstrap", {
    method: "POST",
    headers: auth,
  });
  assert.equal(pending.status, 409);

  await syncVerifiedHunter(app);
  const response = await app.request("https://www.timlostsomething.com/api/v1/me/bootstrap", {
    method: "POST",
    headers: auth,
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(store.accounts.size, 1);
  assert.equal(body.data.verifiedEmail, "hunter@example.test");
  assert.equal(body.data.profileComplete, false);
  assert.equal(body.data.privacyMediaRequired, true);
  assert.equal(body.data.waiverStatus, "pending");
  assert.equal(body.data.participationUnlocked, false);
});

test("profile completion requires the current privacy-media notice but not Turnstile", async () => {
  const { app } = makeApp();
  await syncVerifiedHunter(app);
  await app.request("https://www.timlostsomething.com/api/v1/me/bootstrap", { method: "POST", headers: auth });

  const missing = await app.request("https://www.timlostsomething.com/api/v1/me/profile", {
    method: "PATCH",
    ...json({ ...acceptedProfile, privacyMediaAccepted: false }, auth),
  });
  assert.equal(missing.status, 422);
  assert.equal((await responseJson(missing)).error.code, "privacy_media_acceptance_required");

  const accepted = await app.request("https://www.timlostsomething.com/api/v1/me/profile", {
    method: "PATCH",
    ...json(acceptedProfile, auth),
  });
  const body = await responseJson(accepted);
  assert.equal(accepted.status, 200);
  assert.equal(body.data.profileComplete, true);
  assert.equal(body.data.privacyMediaRequired, false);
  assert.equal(body.data.waiverStatus, "pending");
  assert.equal(body.data.participationUnlocked, false);
});

test("pending waiver keeps exact directions and participation writes locked", async () => {
  const { app } = makeApp();
  await syncVerifiedHunter(app);
  await app.request("https://www.timlostsomething.com/api/v1/me/bootstrap", { method: "POST", headers: auth });
  await app.request("https://www.timlostsomething.com/api/v1/me/profile", {
    method: "PATCH",
    ...json(acceptedProfile, auth),
  });

  for (const [url, init] of [
    ["https://www.timlostsomething.com/api/v1/member/waypoints/1", { headers: auth }],
    ["https://www.timlostsomething.com/api/v1/progress/1", { method: "PUT", ...json({ state: "visited" }, auth) }],
  ] as const) {
    const response = await app.request(url, init);
    assert.equal(response.status, 423);
    assert.equal((await responseJson(response)).error.code, "participation_waiver_pending");
  }
});

test("verified Clerk lifecycle webhooks are idempotent and populate the player ledger", async () => {
  const { app, store } = makeApp();
  const request = () => app.request("https://www.timlostsomething.com/api/v1/webhooks/clerk", {
    method: "POST",
    headers: { "svix-id": "evt_1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal((await request()).status, 202);
  assert.equal((await request()).status, 200);
  assert.equal(store.accounts.get("hunter-webhook")?.verifiedEmail, "webhook@example.test");
  assert.equal(store.identityEvents.size, 1);
});

test("Ops exposes the player lifecycle ledger and retains the subscriber alias", async () => {
  const { app } = makeApp();
  await syncVerifiedHunter(app);
  await app.request("https://www.timlostsomething.com/api/v1/me/bootstrap", { method: "POST", headers: auth });
  const headers = { authorization: "Bearer staff-token" };
  const players = await app.request("https://www.timlostsomething.com/api/v1/ops/players", { headers });
  const subscribers = await app.request("https://www.timlostsomething.com/api/v1/ops/subscribers", { headers });
  assert.equal(players.status, 200);
  assert.equal(subscribers.status, 200);
  assert.equal((await responseJson(players)).data.counts.verifiedAccounts, 1);
});
