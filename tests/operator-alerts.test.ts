import assert from "node:assert/strict";
import test from "node:test";
import {
  ManagedOperatorAlerts,
  renderOperatorAlert,
  type OperatorAlertRecipientClaim,
  type OperatorAlertStore,
} from "../src/server/operator-alerts";
import {
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMessage,
} from "../src/server/transactional-mail";

const accepted: TransactionalMailAcceptance = {
  provider: "microsoft_graph",
  providerReference: "graph-request-1",
  providerReferenceKind: "graph_request_id",
  acceptedAt: "2026-07-16T18:00:00.000Z",
};

const claims: OperatorAlertRecipientClaim[] = [
  {
    id: "delivery-1",
    jobId: "job-1",
    kind: "operator_private_report",
    targetRecordId: "report-opaque-1",
    email: "operator-one@example.test",
    attempts: 1,
    leaseToken: "lease-1",
    correlationId: "opalert_report_opaque_1_one",
  },
  {
    id: "delivery-2",
    jobId: "job-1",
    kind: "operator_private_report",
    targetRecordId: "report-opaque-1",
    email: "operator-two@example.test",
    attempts: 1,
    leaseToken: "lease-2",
    correlationId: "opalert_report_opaque_1_two",
  },
];

class AlertStore implements OperatorAlertStore {
  batches: OperatorAlertRecipientClaim[][] = claims.map((claim) => [claim]);
  completions: Array<{ id: string; result: Record<string, unknown> }> = [];
  reconciled: string[] = [];

  async claimOperatorAlertRecipients() {
    return this.batches.shift() ?? [];
  }

  async completeOperatorAlertRecipient(
    claim: OperatorAlertRecipientClaim,
    result: Record<string, unknown>,
  ) {
    this.completions.push({ id: claim.id, result });
  }

  async reconcileOperatorAlertJob(jobId: string) {
    this.reconciled.push(jobId);
  }
}

const config = (messages: TransactionalMessage[]) => ({
  mailer: {
    async send(message: TransactionalMessage) {
      messages.push(message);
      return accepted;
    },
  },
  sender: { name: "Tim Lost Something? by SebaHub", address: "tech@sebahub.com" },
  replyTo: "casey@sebahub.com",
  canonicalOrigin: "https://codex-validation.seba-treasure-hunt.pages.dev/",
});

test("operator alert renderer contains only a generic label, opaque reference, and the correct Ops link", () => {
  const report = renderOperatorAlert(
    "operator_private_report",
    "report-opaque-1",
    "https://codex-validation.seba-treasure-hunt.pages.dev/",
  );
  assert.match(report.subject, /private report/i);
  assert.match(report.text, /report-opaque-1/);
  assert.match(report.text, /\/ops#reports/);

  const note = renderOperatorAlert(
    "operator_field_note_moderation",
    "note-opaque-1",
    "https://codex-validation.seba-treasure-hunt.pages.dev/",
  );
  assert.match(note.subject, /moderation/i);
  assert.match(note.text, /note-opaque-1/);
  assert.match(note.text, /\/ops#moderation/);

  const rendered = `${report.subject}\n${report.text}\n${report.html}\n${note.subject}\n${note.text}\n${note.html}`;
  for (const privateSentinel of [
    "Private Person",
    "private@example.test",
    "+1 780 555 0100",
    "53.123456",
    "-114.654321",
    "behind the private trailer",
    "private report details",
    "private field note body",
    "private-object-key",
    "hunter-subject-secret",
  ]) {
    assert.doesNotMatch(rendered, new RegExp(privateSentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("managed operator alerts sends one separate message per claimed active recipient", async () => {
  const store = new AlertStore();
  const messages: TransactionalMessage[] = [];
  const alerts = new ManagedOperatorAlerts(store, config(messages));

  assert.deepEqual(await alerts.deliver("job-1"), { status: "sent", sent: 2, failed: 0 });
  assert.deepEqual(messages.map((message) => message.to), [
    "operator-one@example.test",
    "operator-two@example.test",
  ]);
  assert.ok(messages.every((message) => !message.to.includes(",") && !message.to.includes(";")));
  assert.ok(messages.every((message) => message.from.address === "tech@sebahub.com"));
  assert.ok(messages.every((message) => message.replyTo === "casey@sebahub.com"));
  assert.deepEqual(store.completions.map(({ id, result }) => ({ id, status: result.status })), [
    { id: "delivery-1", status: "sent" },
    { id: "delivery-2", status: "sent" },
  ]);
  assert.deepEqual(store.reconciled, ["job-1"]);
});

test("partial failure does not fail fast and a retry sends only the still-claimable recipient", async () => {
  const store = new AlertStore();
  store.batches.push([]);
  const messages: TransactionalMessage[] = [];
  let failedOnce = false;
  const alerts = new ManagedOperatorAlerts(store, {
    ...config(messages),
    mailer: {
      async send(message: TransactionalMessage) {
        messages.push(message);
        if (message.to === "operator-two@example.test" && !failedOnce) {
          failedOnce = true;
          throw new TransactionalMailError("provider_unavailable");
        }
        return accepted;
      },
    },
  });

  assert.deepEqual(await alerts.deliver("job-1"), { status: "partial", sent: 1, failed: 1 });
  store.batches = [[{ ...claims[1]!, attempts: 2, leaseToken: "lease-2b" }], []];
  assert.deepEqual(await alerts.deliver("job-1"), { status: "sent", sent: 1, failed: 0 });
  assert.deepEqual(messages.map((message) => message.to), [
    "operator-one@example.test",
    "operator-two@example.test",
    "operator-two@example.test",
  ]);
});

test("provider-uncertain delivery is recorded safely and a missing later claim never resends it", async () => {
  const store = new AlertStore();
  store.batches = [[claims[0]!], []];
  let mailCalls = 0;
  const alerts = new ManagedOperatorAlerts(store, {
    ...config([]),
    mailer: {
      async send() {
        mailCalls += 1;
        throw new TransactionalMailError("provider_delivery_uncertain");
      },
    },
  });

  assert.deepEqual(await alerts.deliver("job-1"), { status: "failed", sent: 0, failed: 1 });
  assert.deepEqual(await alerts.deliver("job-1"), { status: "sent", sent: 0, failed: 0 });
  assert.equal(mailCalls, 1);
  assert.deepEqual(store.completions[0]?.result, {
    status: "uncertain",
    errorCode: "provider_delivery_uncertain",
  });
});

test("a post-acceptance evidence-write failure is never reclassified for automatic resend", async () => {
  const store = new AlertStore();
  store.batches = [[claims[0]!], [claims[1]!]];
  const completionStatuses: string[] = [];
  store.completeOperatorAlertRecipient = async (_claim, result) => {
    completionStatuses.push(result.status);
    if (result.status === "sent") throw new Error("D1 evidence write unavailable");
  };
  let providerCalls = 0;
  const alerts = new ManagedOperatorAlerts(store, {
    ...config([]),
    mailer: {
      async send() {
        providerCalls += 1;
        return accepted;
      },
    },
  });

  await assert.rejects(() => alerts.deliver("job-1"), /evidence write unavailable/);
  assert.equal(providerCalls, 1);
  assert.deepEqual(completionStatuses, ["sent"]);
  assert.deepEqual(store.reconciled, []);
  assert.equal(store.batches.length, 1, "a later operator is not claimed before the accepted send is recorded");
});

test("missing mail configuration fails before claim and preserves pending recipients", async () => {
  const store = new AlertStore();
  const alerts = new ManagedOperatorAlerts(store, {
    mailer: null,
    sender: { name: "", address: "" },
    replyTo: "",
    canonicalOrigin: "",
  });

  assert.deepEqual(await alerts.deliver("job-1"), { status: "failed", sent: 0, failed: 0 });
  assert.equal(store.batches.length, 2, "the store is not claimed until configuration is usable");
  assert.deepEqual(store.completions, []);
  assert.deepEqual(store.reconciled, []);
});

test("header-unsafe or malformed sender configuration is rejected before claim", async (t) => {
  for (const invalid of [
    { name: "control in sender name", senderName: "Case\u0000Room", senderAddress: "tech@sebahub.com", replyTo: "casey@sebahub.com" },
    { name: "invalid sender address", senderName: "Case Room", senderAddress: "tech..alerts@sebahub.com", replyTo: "casey@sebahub.com" },
    { name: "invalid reply-to domain", senderName: "Case Room", senderAddress: "tech@sebahub.com", replyTo: "casey@sebahub..com" },
  ]) {
    await t.test(invalid.name, async () => {
      const store = new AlertStore();
      let providerCalls = 0;
      const alerts = new ManagedOperatorAlerts(store, {
        mailer: { async send() { providerCalls += 1; return accepted; } },
        sender: { name: invalid.senderName, address: invalid.senderAddress },
        replyTo: invalid.replyTo,
        canonicalOrigin: "https://codex-validation.seba-treasure-hunt.pages.dev",
      });

      assert.deepEqual(await alerts.deliver("job-1"), { status: "failed", sent: 0, failed: 0 });
      assert.equal(providerCalls, 0);
      assert.equal(store.batches.length, 2);
    });
  }
});
