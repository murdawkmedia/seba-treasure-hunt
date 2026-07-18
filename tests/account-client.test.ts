import assert from "node:assert/strict";
import test from "node:test";

import { campaignAccountModel, signOutCampaignHunterSession } from "../src/client/account";
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

test("campaign sign out clears safe signup resume only after provider success", async () => {
  const order: string[] = [];
  await signOutCampaignHunterSession(
    async () => { order.push("provider"); },
    () => { order.push("resume"); },
  );
  assert.deepEqual(order, ["provider", "resume"]);

  let clears = 0;
  await assert.rejects(
    signOutCampaignHunterSession(
      async () => { throw new Error("provider unavailable"); },
      () => { clears += 1; },
    ),
    /provider unavailable/,
  );
  assert.equal(clears, 0);
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

test("coordinator teardown replaces only its owned legacy token hook on reinitialization", async () => {
  const browserGlobal: Record<string, unknown> = {};
  let removed = 0;
  const provider = (token: string) => ({
    user: { id: `user_${token}` },
    session: { id: `session_${token}`, getToken: async () => token },
    client: null,
    async load() {},
    addListener() { return () => { removed += 1; }; },
    async setActive() {},
    async signOut() {},
  });

  const first = getHunterAuthSessionCoordinator({
    browserGlobal,
    createClerk: async () => provider("old-token") as never,
  });
  await first.load("pk_test_reinit");
  const firstHook = browserGlobal.timLostAuth as { getToken: () => Promise<string | null> };
  assert.equal(await firstHook.getToken(), "old-token");
  first.teardown();
  assert.equal(browserGlobal.timLostAuth, undefined);
  assert.equal(removed, 1);

  const second = getHunterAuthSessionCoordinator({
    browserGlobal,
    createClerk: async () => provider("new-token") as never,
  });
  await second.load("pk_test_reinit");
  const secondHook = browserGlobal.timLostAuth as { getToken: () => Promise<string | null> };
  assert.notEqual(secondHook, firstHook);
  assert.equal(await secondHook.getToken(), "new-token");

  const foreignHook = { getToken: async () => "foreign-token" };
  const foreignGlobal: Record<string, unknown> = { timLostAuth: foreignHook };
  const preserving = getHunterAuthSessionCoordinator({
    browserGlobal: foreignGlobal,
    createClerk: async () => provider("provider-token") as never,
  });
  await preserving.load("pk_test_foreign");
  preserving.teardown();
  assert.equal(foreignGlobal.timLostAuth, foreignHook);
});
