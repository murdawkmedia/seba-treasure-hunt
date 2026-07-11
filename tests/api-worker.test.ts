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
