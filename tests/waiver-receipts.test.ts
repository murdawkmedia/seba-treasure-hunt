import assert from "node:assert/strict";
import test from "node:test";
import {
  ManagedWaiverReceipts,
  renderWaiverReceipt,
} from "../src/server/waiver-receipts";
import { participationWaiverDocument } from "../src/server/legal-documents";
import {
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMailer,
  type TransactionalMessage,
} from "../src/server/transactional-mail";
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
  activeLease: WaiverReceiptJob | null = null;
  completions: Array<
    | ({ jobId: string; status: "sent" } & TransactionalMailAcceptance)
    | {
        jobId: string;
        status: "failed";
        errorCode: WaiverReceiptErrorCode;
      }
  > = [];

  async claimWaiverReceiptJob() {
    const claimed = this.claims.shift() ?? null;
    this.activeLease = claimed;
    return claimed;
  }

  async getWaiverReceiptEnvelope() {
    return this.envelope;
  }

  async completeWaiverReceiptJob(
    job: WaiverReceiptJob,
    result:
      | ({ status: "sent" } & TransactionalMailAcceptance)
      | {
          status: "failed";
          errorCode: WaiverReceiptErrorCode;
        },
  ) {
    this.completions.push({ jobId: job.id, ...result });
    if (this.activeLease?.leaseToken === job.leaseToken) this.activeLease = null;
  }
}

const accepted: TransactionalMailAcceptance = {
  provider: "microsoft_graph",
  providerReference: "graph-request-1",
  providerReferenceKind: "graph_request_id",
  acceptedAt: "2026-07-14T18:00:00.000Z",
};
const sender = {
  name: "Tim Lost Something? by SebaHub",
  address: "tech@sebahub.com",
};

const config = (mailer: TransactionalMailer) => ({
  mailer,
  sender,
  replyTo: "casey@sebahub.com",
  canonicalOrigin: "https://www.timlostsomething.com/",
});

const captureMailer = (messages: TransactionalMessage[]): TransactionalMailer => ({
  async send(message) {
    messages.push(message);
    return accepted;
  },
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

test("managed waiver receipts sends the exact legal receipt to the verified email and stores Graph acceptance evidence", async () => {
  const store = new ReceiptStore();
  const messages: TransactionalMessage[] = [];
  const receiptSender = new ManagedWaiverReceipts(
    store as unknown as DataStore,
    config(captureMailer(messages)),
  );
  const expected = renderWaiverReceipt(envelope, "https://www.timlostsomething.com/");

  assert.deepEqual(await receiptSender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.to, envelope.verifiedEmail);
  assert.deepEqual(messages[0]?.from, sender);
  assert.equal(messages[0]?.replyTo, "casey@sebahub.com");
  assert.equal(messages[0]?.subject, expected.subject);
  assert.equal(messages[0]?.text, expected.text);
  assert.equal(messages[0]?.html, expected.html);
  assert.match(messages[0]?.correlationId ?? "", /^[0-9a-f-]{36}$/i);
  assert.deepEqual(store.completions, [
    { jobId: "job-1", status: "sent", ...accepted },
  ]);
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
      let mailCalls = 0;
      const sender = new ManagedWaiverReceipts(
        store as unknown as DataStore,
        config({
          async send() {
            mailCalls += 1;
            return accepted;
          },
        }),
      );

      assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "failed" });
      assert.equal(mailCalls, 0, "a mismatched legal document never reaches the provider");
      assert.deepEqual(store.completions, [
        { jobId: "job-1", status: "failed", errorCode: "document_mismatch" },
      ]);
    });
  }
});

test("managed waiver receipts suppresses an unavailable lease and can send a deliberate resend", async () => {
  const store = new ReceiptStore();
  let mailCalls = 0;
  const mailer: TransactionalMailer = {
    async send() {
      mailCalls += 1;
      return { ...accepted, providerReference: `graph-request-${mailCalls}` };
    },
  };
  const receiptSender = new ManagedWaiverReceipts(store as unknown as DataStore, config(mailer));

  assert.deepEqual(await receiptSender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.deepEqual(await receiptSender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.equal(mailCalls, 1, "a missing claim never reaches the provider");

  store.claims.push({
    id: "job-1",
    acceptanceId: envelope.acceptance.id,
    attempts: 2,
    leaseToken: "opaque-lease-2",
  });
  assert.deepEqual(await receiptSender.deliver(envelope.acceptance.id), { status: "sent" });
  assert.equal(mailCalls, 2, "a deliberately requeued job may be sent after success");
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
    config({ async send() { return accepted; } }),
  );

  await sender.deliver(envelope.acceptance.id);

  assert.deepEqual(completedClaims, [claimed]);
});

test("managed waiver receipts records a safe failure and releases its lease when rendering throws", async () => {
  const store = new ReceiptStore();
  store.envelope = {
    ...envelope,
    acceptance: {
      ...envelope.acceptance,
      participants: null as unknown as WaiverReceiptEnvelope["acceptance"]["participants"],
    },
  };
  let mailCalls = 0;
  const sender = new ManagedWaiverReceipts(
    store as unknown as DataStore,
    config({
      async send() {
        mailCalls += 1;
        return accepted;
      },
    }),
  );

  assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "failed" });
  assert.equal(mailCalls, 0);
  assert.equal(store.activeLease, null);
  assert.deepEqual(store.completions, [
    { jobId: "job-1", status: "failed", errorCode: "provider_unavailable" },
  ]);
});

test("managed waiver receipts fails retryably when shared mail configuration is missing", async () => {
  for (const missing of ["mailer", "sender", "replyTo", "canonicalOrigin"] as const) {
    const store = new ReceiptStore();
    let mailCalls = 0;
    const options = {
      ...config({
        async send() {
          mailCalls += 1;
          return accepted;
        },
      }),
      [missing]: null,
    };
    const sender = new ManagedWaiverReceipts(store as unknown as DataStore, options);

    assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "failed" });
    assert.equal(mailCalls, 0);
    assert.deepEqual(store.completions, [
      { jobId: "job-1", status: "failed", errorCode: "provider_unavailable" },
    ]);
  }
});

test("managed waiver receipts maps provider failures to fixed non-sensitive codes", async (t) => {
  const cases: Array<{
    name: string;
    errorCode: TransactionalMailError["code"];
  }> = [
    {
      name: "network unavailable",
      errorCode: "provider_unavailable",
    },
    {
      name: "provider rejection",
      errorCode: "provider_rejected",
    },
    {
      name: "malformed provider response",
      errorCode: "provider_response_invalid",
    },
    {
      name: "provider delivery uncertain",
      errorCode: "provider_delivery_uncertain",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const store = new ReceiptStore();
      const sender = new ManagedWaiverReceipts(
        store as unknown as DataStore,
        config({
          async send() {
            throw new TransactionalMailError(scenario.errorCode);
          },
        }),
      );
      assert.deepEqual(await sender.deliver(envelope.acceptance.id), { status: "failed" });
      assert.deepEqual(store.completions, [
        { jobId: "job-1", status: "failed", errorCode: scenario.errorCode },
      ]);
      const persisted = JSON.stringify(store.completions);
      assert.equal(persisted.includes("graph-request-1"), false);
    });
  }
});
