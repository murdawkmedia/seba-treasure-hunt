import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/server/errors";
import { ManagedPlayerAccounts } from "../src/server/player-accounts";
import { ManagedStaffAccounts } from "../src/server/staff-accounts";
import {
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMailer,
  type TransactionalMessage,
} from "../src/server/transactional-mail";

const validationOrigin = "https://codex-validation.seba-treasure-hunt.pages.dev";
const sender = {
  name: "Tim Lost Something? by SebaHub",
  address: "tech@sebahub.com",
};
const replyTo = "casey@sebahub.com";
const accepted: TransactionalMailAcceptance = {
  provider: "microsoft_graph",
  providerReference: "graph-request-1",
  providerReferenceKind: "graph_request_id",
  acceptedAt: "2026-07-14T18:00:00.000Z",
};

function capturingMailer(messages: TransactionalMessage[]): TransactionalMailer {
  return {
    async send(message) {
      messages.push(message);
      return accepted;
    },
  };
}

function playerManager(mailer: TransactionalMailer) {
  return new ManagedPlayerAccounts(null, {
    dashboardUrl: `${validationOrigin}/dashboard`,
    mailer,
    sender,
    recoveryEmailReplyTo: replyTo,
  });
}

function staffManager(mailer: TransactionalMailer) {
  return new ManagedStaffAccounts(null, {
    accountPortalUrl: `${validationOrigin}/ops`,
    invitationRedirectUrl: `${validationOrigin}/ops`,
    mailer,
    sender,
    recoveryEmailReplyTo: replyTo,
  });
}

test("both managed recovery flows send provider-neutral messages with stable validation links", async () => {
  const messages: TransactionalMessage[] = [];
  const mailer = capturingMailer(messages);

  const playerResult = await playerManager(mailer).execute("recovery", {
    verifiedEmail: "player@example.test",
  });
  const staffResult = await staffManager(mailer).execute("recovery", {
    email: "staff@example.test",
  });

  assert.deepEqual(playerResult, { status: "instructions_sent" });
  assert.deepEqual(staffResult, { status: "instructions_sent" });
  assert.equal(JSON.stringify([playerResult, staffResult]).includes("graph-request-1"), false);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((message) => message.to), [
    "player@example.test",
    "staff@example.test",
  ]);
  for (const message of messages) {
    assert.deepEqual(message.from, sender);
    assert.equal(message.replyTo, replyTo);
    assert.equal(message.html, null);
    assert.match(message.correlationId, /^[0-9a-f-]{36}$/i);
  }
  assert.match(messages[0]!.text, new RegExp(`${validationOrigin}/dashboard`));
  assert.match(messages[1]!.text, new RegExp(`${validationOrigin}/ops`));
  assert.doesNotMatch(messages.map((message) => message.text).join("\n"), /www\.timlostsomething\.com/);
});

test("both managed recovery flows map mail-provider failures to one non-sensitive API error", async (t) => {
  const providerCodes = [
    "provider_unavailable",
    "provider_rejected",
    "provider_response_invalid",
    "provider_delivery_uncertain",
  ] as const;

  for (const code of providerCodes) {
    for (const [kind, manager, target] of [
      ["player", playerManager, { verifiedEmail: "player@example.test" }],
      ["staff", staffManager, { email: "staff@example.test" }],
    ] as const) {
      await t.test(`${kind}: ${code}`, async () => {
        const mailer: TransactionalMailer = {
          async send() {
            throw new TransactionalMailError(code);
          },
        };
        await assert.rejects(
          () => manager(mailer).execute("recovery", target),
          (error: unknown) =>
            error instanceof ApiError &&
            error.status === 502 &&
            error.code === "recovery_delivery_failed" &&
            !error.message.includes(code),
        );
      });
    }
  }
});
