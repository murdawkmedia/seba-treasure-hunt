import assert from "node:assert/strict";
import test from "node:test";
import { ManagedPlayerAccounts } from "../src/server/player-accounts";
import { ManagedStaffAccounts } from "../src/server/staff-accounts";

const validationOrigin = "https://codex-validation.seba-treasure-hunt.pages.dev";

test("managed recovery instructions use only the configured stable validation links", async (t) => {
  const originalFetch = globalThis.fetch;
  const messages: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { text: string };
    messages.push(body.text);
    return Response.json({ id: "test-message" });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const playerAccounts = new ManagedPlayerAccounts(null, {
    dashboardUrl: `${validationOrigin}/dashboard`,
    resendApiKey: "test-only-key",
    recoveryEmailFrom: "Test sender <sender@example.test>"
  });
  const staffAccounts = new ManagedStaffAccounts(null, {
    accountPortalUrl: `${validationOrigin}/ops`,
    invitationRedirectUrl: `${validationOrigin}/ops`,
    resendApiKey: "test-only-key",
    recoveryEmailFrom: "Test sender <sender@example.test>"
  });

  await playerAccounts.execute("recovery", { verifiedEmail: "player@example.test" });
  await staffAccounts.execute("recovery", { email: "staff@example.test" });

  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.includes(`${validationOrigin}/dashboard`), true);
  assert.equal(messages[1]!.includes(`${validationOrigin}/ops`), true);
  assert.doesNotMatch(messages.join("\n"), /www\.timlostsomething\.com/);
});
