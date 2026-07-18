import assert from "node:assert/strict";
import test from "node:test";

import { campaignAccountModel } from "../src/client/account";
import { provisioningFailureMessage } from "../src/client/dashboard";
import { getHunterAuthSessionCoordinator } from "../src/client/hunter-auth-session";

test("campaign account presentation uses the privacy-safe handle and never derives identity from email", () => {
  assert.deepEqual(campaignAccountModel(null, null), {
    signedIn: false,
    handle: "Sign in",
    avatarUrl: null,
    initial: "?",
  });
  assert.deepEqual(
    campaignAccountModel(
      { imageUrl: "https://img.clerk.test/avatar.png" },
      { publicHandle: "Hunter A1B2", email: "private.name@example.test", fullName: "Private Name" },
    ),
    {
      signedIn: true,
      handle: "Hunter A1B2",
      avatarUrl: "https://img.clerk.test/avatar.png",
      initial: "H",
    },
  );
});

test("campaign account presentation uses the custom public display name", () => {
  assert.deepEqual(
    campaignAccountModel(
      { imageUrl: "https://img.clerk.test/avatar.png" },
      { publicDisplayName: "Nancy & Ron", publicHandle: "Hunter 43BA" },
    ),
    {
      signedIn: true,
      handle: "Nancy & Ron",
      avatarUrl: "https://img.clerk.test/avatar.png",
      initial: "N",
    },
  );
});

test("verified-account provisioning guidance never presents a password or bad-login failure", () => {
  const transient = provisioningFailureMessage("retryable");
  const terminal = provisioningFailureMessage("terminal");
  for (const copy of [transient, terminal]) {
    assert.match(copy, /email (?:is )?verified/i);
    assert.doesNotMatch(copy, /password|bad login|invalid credentials|database|webhook|Clerk/i);
  }
  assert.match(transient, /sync/i);
  assert.match(transient, /try again|refresh/i);
  assert.match(terminal, /sign in again/i);
});

test("separately bundled clients share one Clerk instance and one provider listener", async () => {
  const browserGlobal: Record<string, unknown> = {};
  let constructors = 0;
  let loads = 0;
  let listeners = 0;
  let removeListeners = 0;
  let providerListener: (() => void) | null = null;
  const provider = {
    user: null,
    session: null,
    client: null,
    async load() { loads += 1; },
    addListener(listener: () => void) {
      listeners += 1;
      providerListener = listener;
      return () => { removeListeners += 1; };
    },
    async setActive() {},
    async signOut() {},
  };
  const createClerk = async () => {
    constructors += 1;
    return provider;
  };

  const accountBundle = getHunterAuthSessionCoordinator({ browserGlobal, createClerk });
  const dashboardBundle = getHunterAuthSessionCoordinator({ browserGlobal, createClerk });
  assert.equal(accountBundle, dashboardBundle);

  const received: unknown[] = [];
  const unsubscribe = accountBundle.subscribe((snapshot) => received.push(snapshot));
  await Promise.all([
    accountBundle.load("pk_test_shared"),
    dashboardBundle.load("pk_test_shared"),
  ]);
  assert.equal(constructors, 1);
  assert.equal(loads, 1);
  assert.equal(listeners, 1);

  provider.user = { id: "user_1" } as never;
  provider.session = { id: "session_1", getToken: async () => "token_1" } as never;
  providerListener?.();
  assert.equal(received.length, 2, "initial readiness and sign-in each publish once");

  accountBundle.setProfile({
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA",
    participationBasis: "adult",
  });
  dashboardBundle.setProfile({
    participationBasis: "adult",
    publicHandle: "Hunter 43BA",
    publicDisplayName: "Nancy & Ron",
  });
  assert.equal(received.length, 3, "equivalent profile sources publish one effective identity change");

  unsubscribe();
  provider.user = null;
  provider.session = null;
  providerListener?.();
  assert.equal(received.length, 3, "unsubscribed clients do not receive later changes");
  accountBundle.teardown();
  assert.equal(removeListeners, 1);
});
