import assert from "node:assert/strict";
import test from "node:test";
import { ResendTransactionalMailer } from "../src/server/resend-mailer";
import { createTransactionalMailer } from "../src/server/transactional-mail-factory";
import {
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMailer,
  type TransactionalMessage
} from "../src/server/transactional-mail";

const message: TransactionalMessage = {
  to: "hunter@example.test",
  from: {
    name: "Tim Lost Something? by SebaHub",
    address: "tech@sebahub.com"
  },
  replyTo: "casey@sebahub.com",
  subject: "Your waiver receipt",
  text: "Plain legal receipt",
  html: "<p>HTML legal receipt</p>",
  correlationId: "mail-attempt-1",
  sentAt: new Date("2026-07-14T18:00:00.000Z")
};

const graphAcceptance: TransactionalMailAcceptance = {
  provider: "microsoft_graph",
  providerReference: "graph-request-1",
  providerReferenceKind: "graph_request_id",
  acceptedAt: "2026-07-14T18:00:00.000Z"
};

const resendAcceptance: TransactionalMailAcceptance = {
  provider: "resend",
  providerReference: "resend-message-1",
  providerReferenceKind: "resend_message_id",
  acceptedAt: "2026-07-14T18:00:00.000Z"
};

function recordingMailer(
  acceptance: TransactionalMailAcceptance,
  calls: TransactionalMessage[]
): TransactionalMailer {
  return {
    async send(candidate) {
      calls.push(candidate);
      return acceptance;
    }
  };
}

function assertMailError(error: unknown, code: TransactionalMailError["code"]): boolean {
  assert.ok(error instanceof TransactionalMailError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  return true;
}

test("microsoft_graph selects only the Graph mailer", async () => {
  const graphCalls: TransactionalMessage[] = [];
  const resendCalls: TransactionalMessage[] = [];
  const mailer = createTransactionalMailer({
    provider: "microsoft_graph",
    graph: recordingMailer(graphAcceptance, graphCalls),
    resend: recordingMailer(resendAcceptance, resendCalls)
  });

  assert.deepEqual(await mailer.send(message), graphAcceptance);
  assert.deepEqual(graphCalls, [message]);
  assert.equal(resendCalls.length, 0);
});

test("resend selects only the Resend mailer", async () => {
  const graphCalls: TransactionalMessage[] = [];
  const resendCalls: TransactionalMessage[] = [];
  const mailer = createTransactionalMailer({
    provider: "resend",
    graph: recordingMailer(graphAcceptance, graphCalls),
    resend: recordingMailer(resendAcceptance, resendCalls)
  });

  assert.deepEqual(await mailer.send(message), resendAcceptance);
  assert.equal(graphCalls.length, 0);
  assert.deepEqual(resendCalls, [message]);
});

for (const provider of [null, "", "RESEND", "other"] as const) {
  test(`provider ${JSON.stringify(provider)} fails closed before either provider is called`, async () => {
    const graphCalls: TransactionalMessage[] = [];
    const resendCalls: TransactionalMessage[] = [];
    const mailer = createTransactionalMailer({
      provider,
      graph: recordingMailer(graphAcceptance, graphCalls),
      resend: recordingMailer(resendAcceptance, resendCalls)
    });

    await assert.rejects(
      () => mailer.send(message),
      (error) => assertMailError(error, "provider_unavailable")
    );
    assert.equal(graphCalls.length, 0);
    assert.equal(resendCalls.length, 0);
  });
}

test("does not fall back to Resend when Graph rejects a send", async () => {
  let graphCalls = 0;
  let resendCalls = 0;
  const mailer = createTransactionalMailer({
    provider: "microsoft_graph",
    graph: {
      async send() {
        graphCalls += 1;
        throw new TransactionalMailError("provider_rejected");
      }
    },
    resend: {
      async send() {
        resendCalls += 1;
        return resendAcceptance;
      }
    }
  });

  await assert.rejects(
    () => mailer.send(message),
    (error) => assertMailError(error, "provider_rejected")
  );
  assert.equal(graphCalls, 1);
  assert.equal(resendCalls, 0);
});

test("Resend sends the provider-neutral fields and maps its response id", async () => {
  const requests: Array<{ input: unknown; init: unknown }> = [];
  const mailer = new ResendTransactionalMailer({
    apiKey: "active-resend-key",
    fetch: async (input, init) => {
      requests.push({ input, init });
      return Response.json({ id: "resend-message-1" });
    },
    now: () => new Date("2026-07-14T18:00:00.000Z")
  });

  assert.deepEqual(await mailer.send(message), resendAcceptance);
  assert.equal(requests.length, 1);
  assert.equal(String(requests[0]?.input), "https://api.resend.com/emails");
  const init = requests[0]?.init as RequestInit | undefined;
  assert.equal(init?.method, "POST");
  assert.equal(init?.redirect, "manual");
  const headers = new Headers(init?.headers);
  assert.equal(headers.get("authorization"), "Bearer active-resend-key");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    from: "Tim Lost Something? by SebaHub <tech@sebahub.com>",
    to: ["hunter@example.test"],
    reply_to: "casey@sebahub.com",
    subject: "Your waiver receipt",
    text: "Plain legal receipt",
    html: "<p>HTML legal receipt</p>"
  });
});

test("Resend omits html when the message has no html representation", async () => {
  let payload: Record<string, unknown> | null = null;
  const mailer = new ResendTransactionalMailer({
    apiKey: "active-resend-key",
    fetch: async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "resend-message-2" });
    }
  });

  await mailer.send({ ...message, html: null });
  assert.ok(payload);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "html"), false);
});

test("Resend rejects missing configuration before network access", async () => {
  let fetchCalls = 0;
  const mailer = new ResendTransactionalMailer({
    apiKey: " ",
    fetch: async () => {
      fetchCalls += 1;
      return Response.json({ id: "unexpected" });
    }
  });

  await assert.rejects(
    () => mailer.send(message),
    (error) => assertMailError(error, "provider_unavailable")
  );
  assert.equal(fetchCalls, 0);
});

test("Resend maps a provider rejection without parsing or exposing its body", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("private provider response"));
    },
    cancel() {
      cancelled = true;
    }
  });
  let cancelled = false;
  const mailer = new ResendTransactionalMailer({
    apiKey: "active-resend-key",
    fetch: async () => new Response(body, { status: 400 })
  });

  await assert.rejects(
    () => mailer.send(message),
    (error) => assertMailError(error, "provider_rejected")
  );
  assert.equal(cancelled, true);
});

test("Resend maps malformed success JSON to a fixed safe error", async () => {
  const mailer = new ResendTransactionalMailer({
    apiKey: "active-resend-key",
    fetch: async () => new Response("not-json", { status: 200 })
  });

  await assert.rejects(
    () => mailer.send(message),
    (error) => assertMailError(error, "provider_response_invalid")
  );
});

test("Resend maps a missing response id to a fixed safe error", async () => {
  const mailer = new ResendTransactionalMailer({
    apiKey: "active-resend-key",
    fetch: async () => Response.json({ id: " " })
  });

  await assert.rejects(
    () => mailer.send(message),
    (error) => assertMailError(error, "provider_response_invalid")
  );
});

test("Resend maps a network failure to provider_unavailable without fallback", async () => {
  const mailer = new ResendTransactionalMailer({
    apiKey: "active-resend-key",
    fetch: async () => {
      throw new Error("network detail that must stay private");
    }
  });

  await assert.rejects(
    () => mailer.send(message),
    (error) => assertMailError(error, "provider_unavailable")
  );
});
