import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import { ApiError } from "../src/server/errors";
import { D1EnvironmentGuard } from "../src/server/environment-guard";
import {
  FakeIdentity,
  FakeRateLimits,
  FakeStaffAccounts,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  json,
  responseJson
} from "./api-test-kit";

const mismatch = {
  checks: 0,
  async assertWritable() {
    this.checks += 1;
    throw new ApiError(
      503,
      "environment_mismatch",
      "Writes are disabled because the deployment environment does not match its data store."
    );
  }
};

const makeApp = () => {
  const store = new FakeStore();
  const uploads = new FakeUploads();
  const environment = { ...mismatch, checks: 0 };
  const accounts = new FakeStaffAccounts();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads,
    rateLimits: new FakeRateLimits(),
    playerAccounts: accounts,
    staffAccounts: accounts,
    environment
  });
  return { app, store, uploads, environment };
};

const assertMismatch = async (response: Response) => {
  assert.equal(response.status, 503);
  assert.equal((await responseJson(response)).error.code, "environment_mismatch");
};

test("blocks public report uploads before R2 or report mutation on environment mismatch", async () => {
  const { app, store, uploads, environment } = makeApp();
  const form = new FormData();
  form.set("type", "find");
  form.set("name", "Test Hunter");
  form.set("email", "hunter@example.test");
  form.set("locationDescription", "Near the public trail.");
  form.set("details", "A test find claim that must never be stored.");
  form.set("cfTurnstileResponse", "human-token");
  form.append(
    "images",
    new File([new Uint8Array([0xff, 0xd8, 0xff])], "find.jpg", { type: "image/jpeg" })
  );

  const response = await app.request("https://www.timlostsomething.com/api/v1/reports", {
    method: "POST",
    headers: { "idempotency-key": "mismatch-report-1" },
    body: form
  });

  await assertMismatch(response);
  assert.equal(environment.checks, 1);
  assert.equal(uploads.saved.length, 0);
  assert.equal(store.reports.length, 0);
});

test("blocks sponsor inquiries before lookup, rate limiting, Turnstile, or mutation", async () => {
  class GuardedStore extends FakeStore {
    sponsorLookups = 0;
    override async getSponsorInquiryByIdempotencyKey(key: string) {
      this.sponsorLookups += 1;
      return super.getSponsorInquiryByIdempotencyKey(key);
    }
  }
  const store = new GuardedStore();
  const rateLimits = new FakeRateLimits();
  const turnstile = {
    checks: 0,
    async verify() {
      this.checks += 1;
      return true;
    }
  };
  const environment = { ...mismatch, checks: 0 };
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile,
    uploads: new FakeUploads(),
    rateLimits,
    environment
  });

  const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    ...json(
      {
        contactName: "Pat Sponsor",
        organization: "Community Co-op",
        email: "sponsor@example.test",
        supportType: "community",
        desiredOutcome: "Support the community treasure hunt.",
        acknowledgementAccepted: true,
        acknowledgementVersion: "2026.1",
        cfTurnstileResponse: "human-token"
      },
      { "idempotency-key": "sponsor-mismatch" }
    )
  });

  await assertMismatch(response);
  assert.equal(environment.checks, 1);
  assert.equal(store.sponsorLookups, 0);
  assert.equal(rateLimits.seen.length, 0);
  assert.equal(turnstile.checks, 0);
  assert.equal((await store.listSponsorInquiries()).items.length, 0);
});

test("blocks privacy acceptance and profile mutation on environment mismatch", async () => {
  const { app, store } = makeApp();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");

  const response = await app.request("https://www.timlostsomething.com/api/v1/me/profile", {
    method: "PATCH",
    ...json(
      {
        fullName: "Test Hunter",
        adultAttested: true,
        privacyMediaAccepted: true,
        privacyMediaVersion: "2026.1",
        consents: { huntEmail: false, marketing: false }
      },
      { authorization: "Bearer hunter-token" }
    )
  });

  await assertMismatch(response);
  assert.equal(store.profiles.size, 0);
  assert.equal(store.legalEvents.length, 0);
});

test("blocks staff mutations before authorization or audit writes on environment mismatch", async () => {
  const { app, store } = makeApp();
  const response = await app.request("https://www.timlostsomething.com/api/v1/ops/status", {
    method: "PUT",
    ...json(
      { state: "paused", reason: "Environment regression test" },
      { authorization: "Bearer staff-token" }
    )
  });

  await assertMismatch(response);
  assert.equal(store.status?.state, "open");
  assert.equal(store.audits.length, 0);
});

test("keeps public reads available when writes are disabled", async () => {
  const { app, environment } = makeApp();
  const response = await app.request("https://www.timlostsomething.com/api/v1/status");

  assert.equal(response.status, 200);
  assert.equal(environment.checks, 0);
});

const database = (value: string | null | Error) => ({
  prepare() {
    return {
      async first() {
        if (value instanceof Error) throw value;
        return value === null ? null : { environment: value };
      }
    };
  }
});

test("allows writes only when the configured environment matches the D1 sentinel", async () => {
  await new D1EnvironmentGuard(database("validation") as never, "validation").assertWritable();

  await assert.rejects(
    new D1EnvironmentGuard(database("production") as never, "validation").assertWritable(),
    (error: { code?: string }) => error.code === "environment_mismatch"
  );
});

test("fails closed when environment configuration or the sentinel is unavailable", async () => {
  await assert.rejects(
    new D1EnvironmentGuard(null, "validation").assertWritable(),
    (error: { code?: string }) => error.code === "environment_unavailable"
  );
  await assert.rejects(
    new D1EnvironmentGuard(database(new Error("D1 unavailable")) as never, "validation").assertWritable(),
    (error: { code?: string }) => error.code === "environment_unavailable"
  );
});
