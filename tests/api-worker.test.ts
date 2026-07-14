import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker";
import { responseJson } from "./api-test-kit";

const context = {
  waitUntil() {},
  passThroughOnException() {},
  props: {}
} as unknown as ExecutionContext;

test("production worker delegates clean routes to the Pages asset binding", async () => {
  const seen: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        seen.push(new URL(request.url).pathname);
        return new Response("asset");
      }
    }
  };

  const response = await worker.fetch(
    new Request("https://www.timlostsomething.com/start"),
    env as never,
    context
  );

  assert.equal(response.status, 200);
  assert.equal(seen.at(-1), "/start");
});

test("production worker fails closed for data APIs without a D1 binding", async () => {
  const env = {
    ASSETS: { fetch: async () => new Response("asset") }
  };

  const response = await worker.fetch(
    new Request("https://www.timlostsomething.com/api/v1/status"),
    env as never,
    context
  );
  const body = await responseJson(response);

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "status_unavailable");
  assert.ok(body.error.requestId);
});

test("production worker keeps method-safe apex canonicalization", async () => {
  const env = {
    ASSETS: { fetch: async () => new Response("asset") }
  };

  const response = await worker.fetch(
    new Request("https://timlostsomething.com/api/v1/reports?source=qr", {
      method: "POST",
      body: "payload"
    }),
    env as never,
    context
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://www.timlostsomething.com/api/v1/reports?source=qr"
  );
});

test("validation HTML carries a persistent disposable-data notice and noindex header", async () => {
  const env = {
    DEPLOYMENT_ENV: "validation",
    ASSETS: {
      fetch: async () => new Response(
        "<!doctype html><html><head><title>Test</title></head><body><main>Campaign</main></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } }
      )
    }
  };

  const response = await worker.fetch(
    new Request("https://codex-validation.seba-treasure-hunt.pages.dev/start"),
    env as never,
    context
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/i);
  assert.match(html, /Validation environment/i);
  assert.match(html, /test accounts and submissions will be deleted before launch/i);
  assert.match(html, /role="status"/i);
});

test("validation public config rejects live Clerk publishable keys", async () => {
  const env = {
    DEPLOYMENT_ENV: "validation",
    HUNTER_CLERK_PUBLISHABLE_KEY: "pk_live_hunter",
    STAFF_CLERK_PUBLISHABLE_KEY: "pk_live_staff",
    HUNTER_ACCOUNT_PORTAL_URL: "https://www.timlostsomething.com/dashboard",
    STAFF_ACCOUNT_PORTAL_URL: "https://www.timlostsomething.com/ops",
    ASSETS: { fetch: async () => new Response("asset") }
  };

  const response = await worker.fetch(
    new Request("https://codex-validation.seba-treasure-hunt.pages.dev/api/v1/config"),
    env as never,
    context
  );
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.data.hunterPublishableKey, null);
  assert.equal(body.data.staffPublishableKey, null);
  assert.equal(body.data.hunterAccountPortalUrl, null);
  assert.equal(body.data.staffAccountPortalUrl, null);
});

test("production HTML never renders the validation notice", async () => {
  const env = {
    DEPLOYMENT_ENV: "production",
    ASSETS: {
      fetch: async () => new Response(
        "<!doctype html><html><body><main>Campaign</main></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } }
      )
    }
  };

  const response = await worker.fetch(
    new Request("https://www.timlostsomething.com/start"),
    env as never,
    context
  );

  assert.doesNotMatch(await response.text(), /Validation environment/i);
  assert.equal(response.headers.get("x-robots-tag"), null);
});
