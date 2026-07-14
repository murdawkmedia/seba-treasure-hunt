import assert from "node:assert/strict";
import test from "node:test";
import {
  ManagedWaiverReceipts,
  renderWaiverReceipt,
} from "../src/server/waiver-receipts";
import { participationWaiverDocument } from "../src/server/legal-documents";
import type {
  DataStore,
  WaiverReceiptEnvelope,
  WaiverReceiptErrorCode,
  WaiverReceiptJob,
} from "../src/server/types";

const envelope: WaiverReceiptEnvelope = {
  verifiedEmail: "hunter@example.test",
  acceptance: {
    id: "acceptance-12345678",
    subject: "hunter-1",
    documentVersion: participationWaiverDocument.version,
    documentHash: participationWaiverDocument.hash,
    acceptedAt: "2026-07-13T20:02:00.000Z",
    referenceCode: "TLS-W-12345678",
    participants: [
      { role: "adult", fullName: "Alex Hunter", birthYear: null, guardianAttested: false },
      { role: "minor", fullName: "Sam Hunter", birthYear: 2014, guardianAttested: true },
    ],
    receipt: { jobId: "job-1", status: "pending", attempts: 0, sentAt: null },
  },
};

class ReceiptStore {
  claims: WaiverReceiptJob[] = [{
    id: "job-1",
    acceptanceId: envelope.acceptance.id,
    attempts: 1,
    leaseToken: "opaque-lease-1",
  }];
  envelope: WaiverReceiptEnvelope | null = envelope;
  completions: Array<
    | { jobId: string; status: "sent"; providerMessageId: string }
    | { jobId: string; status: "failed"; errorCode: WaiverReceiptErrorCode }
  > = [];

  async claimWaiverReceiptJob() {
    return this.claims.shift() ?? null;
  }

  async getWaiverReceiptEnvelope() {
    return this.envelope;
  }

  async completeWaiverReceiptJob(
    job: WaiverReceiptJob,
    result:
      | { status: "sent"; providerMessageId: string }
      | { status: "failed"; errorCode: WaiverReceiptErrorCode },
  ) {
    this.completions.push({ jobId: job.id, ...result });
  }
}

const config = (fetcher: typeof fetch) => ({
  fetch: fetcher,
  apiKey: "resend-test-key",
  from: "Tim Lost Something? <legal@example.test>",
  replyTo: "help@example.test",
  canonicalOrigin: "https://www.timlostsomething.com/",
});

test("waiver receipt renderer includes the complete legal record and escapes controlled values", () => {
  const message = renderWaiverReceipt(envelope, "https://www.timlostsomething.com");
  assert.match(message.subject, /Tim Lost Something\?/);
  assert.match(message.text, /SebaHub Tim Lost Something\?/);
  assert.match(message.text, /Alex Hunter/);
  assert.match(message.text, /hunter@example\.test/);
  assert.match(message.text, /Sam Hunter \(birth year 2014\)/);
  assert.match(message.text, /In an emergency, I will call 911\./);
  assert.match(message.text, new RegExp(participationWaiverDocument.acceptanceStatement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(message.text, new RegExp(participationWaiverDocument.guardianStatement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(message.text, /Version 2026\.1/);
  assert.match(message.text, /Effective July 13, 2026/);
  assert.match(message.text, /TLS-W-12345678/);
  assert.match(message.text, /\/waiver/);
  assert.match(message.text, /\/rules/);
  assert.match(message.text, /registration confirmation/i);
  for (const section of participationWaiverDocument.sections) {
    assert.match(message.text, new RegExp(section.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const controlled: WaiverReceiptEnvelope = {
    ...envelope,
    verifiedEmail: `hunter+"quote"@example.test`,
    acceptance: {
      ...envelope.acceptance,
      participants: [
        {
          role: "adult",
          fullName: "Alex & Hunter <script>alert('x')</script>",
          birthYear: null,
          guardianAttested: false,
        },
      ],
    },
  };
  const escaped = renderWaiverReceipt(controlled, "https://www.timlostsomething.com");
  assert.match(escaped.html, /Alex &amp; Hunter &lt;script&gt;/);
  assert.match(escaped.html, /hunter\+&quot;quote&quot;@example\.test/);
  assert.doesNotMatch(escaped.html, /<script|exactUrl|report evidence/i);
});

test("waiver receipt renderer requires an explicitly configured campaign base URL", () => {
  assert.throws(() => renderWaiverReceipt(envelope, ""), /campaign base URL/i);
});

test("waiver receipt renderer uses the configured stable validation origin for every campaign link", () => {
  const message = renderWaiverReceipt(
    envelope,
    "https://codex-validation.seba-treasure-hunt.pages.dev"
  );

  assert.match(message.text, /https:\/\/codex-validation\.seba-treasure-hunt\.pages\.dev\/waiver/);
  assert.match(message.text, /https:\/\/codex-validation\.seba-treasure-hunt\.pages\.dev\/rules/);
  assert.match(message.html, /https:\/\/codex-validation\.seba-treasure-hunt\.pages\.dev\/waiver/);
  assert.match(message.html, /https:\/\/codex-validation\.seba-treasure-hunt\.pages\.dev\/rules/);
  assert.doesNotMatch(message.text, /www\.timlostsomething\.com/);
  assert.doesNotMatch(message.html, /www\.timlostsomething\.com/);
});

test("managed waiver receipts sends one Resend request and stores only the provider message id", async () => {
  const store = new ReceiptStore();
  const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json({ id: "resend-message-1", ignored_private_detail: "do not persist" });
  };
  const sender = new ManagedWaiverReceipts(store as unknown as DataStore, config(fetcher));

  assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.resend.com/emails");
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(new Headers(requests[0]?.init.headers).get("authorization"), "Bearer resend-test-key");
  assert.deepEqual(requests[0]?.body.to, ["hunter@example.test"]);
  assert.equal(requests[0]?.body.from, "Tim Lost Something? <legal@example.test>");
  assert.equal(requests[0]?.body.reply_to, "help@example.test");
  assert.match(String(requests[0]?.body.html), /https:\/\/www\.timlostsomething\.com\/waiver/);
  assert.deepEqual(store.completions, [
    { jobId: "job-1", status: "sent", providerMessageId: "resend-message-1" },
  ]);
  assert.equal(JSON.stringify(store.completions).includes("ignored_private_detail"), false);
});

test("managed waiver receipts rejects acceptance documents that do not exactly match the rendered waiver", async (t) => {
  const mismatches: Array<{
    name: string;
    documentVersion: string;
    documentHash: string;
  }> = [
    {
      name: "version mismatch",
      documentVersion: "2025.9",
      documentHash: participationWaiverDocument.hash,
    },
    {
      name: "hash mismatch",
      documentVersion: participationWaiverDocument.version,
      documentHash: "f".repeat(64),
    },
  ];

  for (const mismatch of mismatches) {
    await t.test(mismatch.name, async () => {
      const store = new ReceiptStore();
      store.envelope = {
        ...envelope,
        acceptance: {
          ...envelope.acceptance,
          documentVersion: mismatch.documentVersion,
          documentHash: mismatch.documentHash,
        },
      };
      let networkCalls = 0;
      const sender = new ManagedWaiverReceipts(
        store as unknown as DataStore,
        config(async () => {
          networkCalls += 1;
          return Response.json({ id: "must-not-send" });
        }),
      );

      assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "failed" });
      assert.equal(networkCalls, 0, "a mismatched legal document never reaches the provider");
      assert.deepEqual(store.completions, [
        { jobId: "job-1", status: "failed", errorCode: "document_mismatch" },
      ]);
    });
  }
});

test("managed waiver receipts suppresses an unavailable lease and can send a deliberate resend", async () => {
  const store = new ReceiptStore();
  let networkCalls = 0;
  const fetcher: typeof fetch = async () => {
    networkCalls += 1;
    return Response.json({ id: `message-${networkCalls}` });
  };
  const sender = new ManagedWaiverReceipts(store as unknown as DataStore, config(fetcher));

  assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.equal(networkCalls, 1, "a missing claim never reaches the provider");

  store.claims.push({
    id: "job-1",
    acceptanceId: envelope.acceptance.id,
    attempts: 2,
    leaseToken: "opaque-lease-2",
  });
  assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.equal(networkCalls, 2, "a deliberately requeued job may be sent after success");
});

test("managed waiver receipts completes the exact claimed lease generation", async () => {
  const claimed = {
    id: "job-1",
    acceptanceId: envelope.acceptance.id,
    attempts: 7,
    leaseToken: "opaque-lease-7",
  };
  const store = new ReceiptStore();
  store.claims = [claimed];
  const completedClaims: unknown[] = [];
  store.completeWaiverReceiptJob = async (job: unknown) => {
    completedClaims.push(job);
  };
  const sender = new ManagedWaiverReceipts(
    store as unknown as DataStore,
    config(async () => Response.json({ id: "message-7" })),
  );

  await sender.deliver(envelope.acceptance.id);

  assert.deepEqual(completedClaims, [claimed]);
});

test("managed waiver receipts fails retryably when dedicated sender configuration is missing", async () => {
  for (const missing of ["apiKey", "from", "replyTo"] as const) {
    const store = new ReceiptStore();
    let networkCalls = 0;
    const fetcher: typeof fetch = async () => {
      networkCalls += 1;
      return Response.json({ id: "must-not-send" });
    };
    const options = { ...config(fetcher), [missing]: null };
    const sender = new ManagedWaiverReceipts(store as unknown as DataStore, options);

    assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "failed" });
    assert.equal(networkCalls, 0);
    assert.deepEqual(store.completions, [
      { jobId: "job-1", status: "failed", errorCode: "provider_unavailable" },
    ]);
  }
});

test("managed waiver receipts maps provider failures to fixed non-sensitive codes", async (t) => {
  const cases: Array<{
    name: string;
    fetcher: typeof fetch;
    errorCode: WaiverReceiptErrorCode;
  }> = [
    {
      name: "network unavailable",
      fetcher: async () => {
        throw new Error("private network detail");
      },
      errorCode: "provider_unavailable",
    },
    {
      name: "provider rejection",
      fetcher: async () => new Response("private rejection body", { status: 422 }),
      errorCode: "provider_rejected",
    },
    {
      name: "malformed provider JSON",
      fetcher: async () => new Response("not-json", { status: 200 }),
      errorCode: "provider_response_invalid",
    },
    {
      name: "missing provider message id",
      fetcher: async () => Response.json({ ok: true }),
      errorCode: "provider_response_invalid",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const store = new ReceiptStore();
      const sender = new ManagedWaiverReceipts(
        store as unknown as DataStore,
        config(scenario.fetcher),
      );
      assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "failed" });
      assert.deepEqual(store.completions, [
        { jobId: "job-1", status: "failed", errorCode: scenario.errorCode },
      ]);
      const persisted = JSON.stringify(store.completions);
      assert.equal(persisted.includes("private network detail"), false);
      assert.equal(persisted.includes("private rejection body"), false);
    });
  }
});
