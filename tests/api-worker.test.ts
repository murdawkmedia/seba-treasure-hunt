import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import worker, { transactionalMailRuntimeForEnvironment } from "../src/worker";
import { TransactionalMailError } from "../src/server/transactional-mail";
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

const testMessage = {
  to: "hunter@example.test",
  from: { name: "Tim Lost Something? by SebaHub", address: "tech@sebahub.com" },
  replyTo: "casey@sebahub.com",
  subject: "Configuration check",
  text: "Configuration check",
  html: null,
  correlationId: "8d75fa86-6ced-4a44-8f21-977397c78bd7"
};

test("the Worker cache and environment boundary include every transactional provider setting", async () => {
  const [workerSource, typeSource] = await Promise.all([
    readFile(path.resolve("src", "worker.ts"), "utf8"),
    readFile(path.resolve("src", "server", "types.ts"), "utf8")
  ]);
  const providerSettings = [
    "TRANSACTIONAL_EMAIL_PROVIDER",
    "GRAPH_CLIENT_ID",
    "GRAPH_TENANT_ID",
    "GRAPH_REFRESH_TOKEN_BOOTSTRAP",
    "GRAPH_TOKEN_ENCRYPTION_KEY",
    "GRAPH_TOKEN_KEY_VERSION",
    "TRANSACTIONAL_EMAIL_FROM_ADDRESS",
    "TRANSACTIONAL_EMAIL_FROM_NAME",
    "TRANSACTIONAL_EMAIL_REPLY_TO"
  ];

  for (const setting of providerSettings) {
    assert.match(typeSource, new RegExp(`${setting}\\?:`), `${setting} must be declared on PagesEnv`);
    assert.match(workerSource, new RegExp(`env\\.${setting} \\?\\? null`), `${setting} must invalidate the cached app`);
  }
  assert.doesNotMatch(workerSource, /RESEND_API_KEY_SEBAHUB_PENDING/);
});

test("the Worker constructs one selected mailer and shares it with every transactional consumer", async () => {
  const workerSource = await readFile(path.resolve("src", "worker.ts"), "utf8");

  assert.match(workerSource, /const graphTokenStore = new D1GraphTokenStore\(/);
  assert.match(workerSource, /const graphMailer = new MicrosoftGraphTransactionalMailer\(/);
  assert.match(workerSource, /const resendMailer = new ResendTransactionalMailer\(/);
  assert.match(workerSource, /const transactionalMailer = createTransactionalMailer\(/);
  assert.match(workerSource, /operatorAlerts:\s*new ManagedOperatorAlerts\(store,/);
  const applicationWiring = workerSource.slice(workerSource.indexOf("const app = createApi"));
  assert.equal((applicationWiring.match(/mailer:\s*transactionalMailer/g) ?? []).length, 4);
});

test("production snapshot dependencies are composed only for validation", async () => {
  const [workerSource, typeSource] = await Promise.all([
    readFile(path.resolve("src", "worker.ts"), "utf8"),
    readFile(path.resolve("src", "server", "types.ts"), "utf8")
  ]);

  assert.match(typeSource, /PRODUCTION_SNAPSHOT_DB\?: D1Database/);
  assert.match(typeSource, /PRODUCTION_SNAPSHOT_MEDIA\?: R2Bucket/);
  assert.match(
    workerSource,
    /env\.DEPLOYMENT_ENV === "validation" && env\.PRODUCTION_SNAPSHOT_DB/
  );
  assert.match(
    workerSource,
    /env\.DEPLOYMENT_ENV === "validation" && env\.PRODUCTION_SNAPSHOT_MEDIA/
  );
  assert.doesNotMatch(workerSource, /DEPLOYMENT_ENV === "production"[^;]+PRODUCTION_SNAPSHOT/s);
});

test("missing Graph configuration fails before any provider network access", async () => {
  let networkCalls = 0;
  const runtime = transactionalMailRuntimeForEnvironment(
    {
      TRANSACTIONAL_EMAIL_PROVIDER: "microsoft_graph"
    },
    async () => {
      networkCalls += 1;
      throw new Error("network must not be reached");
    }
  );

  await assert.rejects(
    runtime.mailer.send(testMessage),
    (error: unknown) =>
      error instanceof TransactionalMailError && error.code === "provider_unavailable"
  );
  assert.equal(networkCalls, 0);
});
