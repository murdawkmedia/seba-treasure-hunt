import assert from "node:assert/strict";
import test from "node:test";
import { ManagedClueNotices, renderClueNotice, type ClueNoticeStore } from "../src/server/clue-notices";
import type { ClueNoticeRecipientClaim } from "../src/server/types";
import type { TransactionalMessage } from "../src/server/transactional-mail";

const claim: ClueNoticeRecipientClaim = {
  id: "recipient-1", jobId: "job-1", kind: "clue_order_approved", email: "hunter@example.test",
  attempts: 1, leaseToken: "lease-1", correlationId: "cluenotice_123"
};

class NoticeStore implements ClueNoticeStore {
  batches: ClueNoticeRecipientClaim[][] = [[claim], []];
  completions: string[] = [];
  reconciled: string[] = [];
  configurationFailures: string[] = [];
  async claimClueNoticeRecipients() { return this.batches.shift() ?? []; }
  async completeClueNoticeRecipient(recipient: ClueNoticeRecipientClaim) { this.completions.push(recipient.id); }
  async reconcileClueNoticeJob(jobId: string) { this.reconciled.push(jobId); }
  async failClueNoticeConfiguration(jobId: string) { this.configurationFailures.push(jobId); }
}

test("clue notice mail links to My Hunt without decoder or purchaser details", () => {
  const message = renderClueNotice("clue_order_approved", "https://www.timlostsomething.com/");
  assert.match(message.text, /dashboard\.html/);
  assert.doesNotMatch(message.text, /private decoder|payment reference|@/i);
  assert.doesNotMatch(message.html, /decoder explanation|private/i);
});

test("managed clue notices deliver each claimed recipient and reconcile the durable job", async () => {
  const store = new NoticeStore();
  const messages: TransactionalMessage[] = [];
  const notices = new ManagedClueNotices(store, {
    mailer: { async send(message) { messages.push(message); return {
      provider: "resend" as const, providerReference: "message-1", providerReferenceKind: "resend_message_id" as const,
      acceptedAt: "2026-08-07T00:00:00.000Z"
    }; } },
    sender: { name: "Tim Lost Something?", address: "updates@sebahub.com" },
    replyTo: "casey@sebahub.com",
    canonicalOrigin: "https://www.timlostsomething.com"
  });

  assert.deepEqual(await notices.deliver("job-1"), { status: "sent", sent: 1, failed: 0 });
  assert.deepEqual(messages.map((message) => message.to), ["hunter@example.test"]);
  assert.deepEqual(store.completions, ["recipient-1"]);
  assert.deepEqual(store.reconciled, ["job-1"]);
});

test("invalid mail configuration explicitly fails and reconciles the durable job", async () => {
  const store = new NoticeStore();
  const notices = new ManagedClueNotices(store, {
    mailer: null,
    sender: { name: "", address: "" },
    replyTo: "",
    canonicalOrigin: "https://www.timlostsomething.com"
  });

  assert.deepEqual(await notices.deliver("job-1"), { status: "failed", sent: 0, failed: 0 });
  assert.deepEqual(store.configurationFailures, ["job-1"]);
  assert.deepEqual(store.reconciled, ["job-1"]);
});
