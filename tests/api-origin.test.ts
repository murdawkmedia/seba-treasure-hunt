import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  responseJson
} from "./api-test-kit";

const makeApp = async () => {
  const store = new FakeStore();
  await store.upsertPlayerAccount("hunter-1", "hunter@example.test");
  return createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    environment: new FakeEnvironment()
  });
};

const requestBootstrap = (app: ReturnType<typeof createApi>, origin?: string) =>
  app.request("https://www.timlostsomething.com/api/v1/me/bootstrap", {
    method: "POST",
    headers: {
      authorization: "Bearer hunter-token",
      ...(origin === undefined ? {} : { origin })
    }
  });

test("rejects missing, opaque, malformed, insecure and hostname-lookalike write origins", async () => {
  const rejectedOrigins: Array<{ name: string; origin?: string }> = [
    { name: "missing" },
    { name: "opaque", origin: "null" },
    { name: "malformed", origin: "://not-an-origin" },
    { name: "canonical over HTTP", origin: "http://www.timlostsomething.com" },
    { name: "canonical alternate port", origin: "https://www.timlostsomething.com:8443" },
    { name: "canonical suffix lookalike", origin: "https://www.timlostsomething.com.evil.example" },
    { name: "preview over HTTP", origin: "http://branch.seba-treasure-hunt.pages.dev" },
    { name: "preview alternate port", origin: "https://branch.seba-treasure-hunt.pages.dev:8443" },
    { name: "preview suffix lookalike", origin: "https://branch.seba-treasure-hunt.pages.dev.evil.example" },
    { name: "preview prefix lookalike", origin: "https://evilseba-treasure-hunt.pages.dev" },
    { name: "Pages project root", origin: "https://seba-treasure-hunt.pages.dev" },
    { name: "unrelated Pages project", origin: "https://other.pages.dev" },
    { name: "remote HTTP host with local port", origin: "http://attacker.example:8788" }
  ];

  for (const item of rejectedOrigins) {
    const response = await requestBootstrap(await makeApp(), item.origin);
    assert.equal(response.status, 403, item.name);
    assert.equal((await responseJson(response)).error.code, "origin_rejected", item.name);
  }
});

test("accepts only the canonical, scoped HTTPS preview and explicit local development origins", async () => {
  const allowedOrigins = [
    "https://www.timlostsomething.com",
    "https://branch.seba-treasure-hunt.pages.dev",
    "http://localhost",
    "http://localhost:8788",
    "https://localhost:3000",
    "http://127.0.0.1:8788",
    "https://127.0.0.1:3000"
  ];

  for (const origin of allowedOrigins) {
    const response = await requestBootstrap(await makeApp(), origin);
    assert.equal(response.status, 200, origin);
  }
});
