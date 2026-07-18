import assert from "node:assert/strict";
import test from "node:test";

import { campaignAccountModel, signOutCampaignHunterSession } from "../src/client/account";
import { provisioningFailureMessage } from "../src/client/dashboard";
import { getHunterAuthSessionCoordinator } from "../src/client/hunter-auth-session";
import { managePageLifecycleSubscription } from "../src/client/page-lifecycle-subscription";

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

test("page lifecycle subscriptions can defer refresh until a persisted restore", () => {
  const browserWindow = new EventTarget();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  let subscriptions = 0;
  let unsubscriptions = 0;
  let refreshes = 0;
  try {
    const stop = managePageLifecycleSubscription(
      () => {
        subscriptions += 1;
        return () => { unsubscriptions += 1; };
      },
      () => { refreshes += 1; },
      { refreshOnStart: false },
    );
    assert.deepEqual({ subscriptions, unsubscriptions, refreshes }, {
      subscriptions: 1,
      unsubscriptions: 0,
      refreshes: 0,
    });

    const pagehide = new Event("pagehide") as PageTransitionEvent;
    Object.defineProperty(pagehide, "persisted", { value: true });
    browserWindow.dispatchEvent(pagehide);
    const pageshow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(pageshow, "persisted", { value: true });
    browserWindow.dispatchEvent(pageshow);
    assert.deepEqual({ subscriptions, unsubscriptions, refreshes }, {
      subscriptions: 2,
      unsubscriptions: 1,
      refreshes: 1,
    });
    stop();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as Record<string, unknown>).window;
  }
});

test("shared coordinator snapshots project raw profiles to display-safe identity only", async () => {
  const browserGlobal: Record<string, unknown> = {};
  const provider = {
    user: {
      id: "user_private_subject",
      firstName: "Private",
      lastName: "Participant",
      primaryEmailAddress: { emailAddress: "provider-private@example.test" },
      primaryPhoneNumber: { phoneNumber: "+1 555 555 0100" },
      privateMetadata: { internalNote: "provider private metadata" },
    },
    session: {
      id: "session_private_secret",
      lastActiveToken: { jwt: "provider-secret-jwt" },
      getToken: async () => "private-token",
    },
    client: null,
    async load() {},
    addListener() { return () => {}; },
    async setActive() {},
    async signOut() {},
  };
  const coordinator = getHunterAuthSessionCoordinator({
    browserGlobal,
    createClerk: async () => provider as never,
  });
  await coordinator.load("pk_test_privacy_projection");

  coordinator.setProfile({
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA",
    fullName: "Private Legal Name",
    email: "private@example.test",
    townArea: "Private Town",
    interests: ["private interest"],
    consents: { marketing: true },
    participationBasis: "adult",
  });

  assert.deepEqual(coordinator.snapshot(), {
    status: "ready",
    principal: { subject: "user_private_subject", version: 1 },
    profile: {
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA",
    },
  });
  assert.equal(
    campaignAccountModel(coordinator.snapshot().principal, coordinator.snapshot().profile).handle,
    "Nancy & Ron",
  );
  const windowCoordinator = browserGlobal.__timLostHunterAuthSessionV1 as typeof coordinator;
  assert.equal(windowCoordinator, coordinator);
  const serializedGlobal = JSON.stringify(windowCoordinator.snapshot());
  for (const privateValue of [
    "Private Legal Name",
    "private@example.test",
    "Private Town",
    "private interest",
    "marketing",
    "participationBasis",
    "provider-private@example.test",
    "+1 555 555 0100",
    "provider private metadata",
    "session_private_secret",
    "provider-secret-jwt",
    "private-token",
    "primaryEmailAddress",
    "privateMetadata",
    "lastActiveToken",
  ]) {
    assert.equal(serializedGlobal.toLowerCase().includes(privateValue.toLowerCase()), false, privateValue);
  }

  coordinator.setProfile({ fullName: "Another Private Name", email: "another@example.test" });
  assert.deepEqual(coordinator.snapshot().profile, {});
  assert.equal(campaignAccountModel(coordinator.snapshot().principal, coordinator.snapshot().profile).handle, "Hunter");
});

test("signup attempt projections copy and freeze provider-owned field arrays", async () => {
  const unverifiedFields = ["email_address"];
  const missingFields = ["password"];
  const browserGlobal: Record<string, unknown> = {};
  const provider = {
    user: null,
    session: null,
    client: {
      signUp: {
        id: "signup_array_projection",
        status: "missing_requirements",
        emailAddress: "safe@example.test",
        createdSessionId: null,
        unverifiedFields,
        missingFields,
        verifications: null,
      },
    },
    async load() {},
    addListener() { return () => {}; },
    async setActive() {},
    async signOut() {},
  };
  const coordinator = getHunterAuthSessionCoordinator({
    browserGlobal,
    createClerk: async () => provider as never,
  });
  await coordinator.load("pk_test_signup_array_projection");

  const attempt = coordinator.signupAttempt();
  assert.notEqual(attempt?.unverifiedFields, unverifiedFields);
  assert.notEqual(attempt?.missingFields, missingFields);
  assert.equal(Object.isFrozen(attempt?.unverifiedFields), true);
  assert.equal(Object.isFrozen(attempt?.missingFields), true);
  unverifiedFields.push("phone_number");
  missingFields.push("first_name");
  assert.deepEqual(attempt?.unverifiedFields, ["email_address"]);
  assert.deepEqual(attempt?.missingFields, ["password"]);
  assert.throws(() => (attempt?.unverifiedFields as string[]).push("unsafe"), TypeError);
  assert.throws(() => (attempt?.missingFields as string[]).push("unsafe"), TypeError);
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

test("coordinator teardown invalidates a pending provider load before it can publish globals", async () => {
  const browserGlobal: Record<string, unknown> = {};
  let releaseLoad: (() => void) | null = null;
  let providerListeners = 0;
  let removedListeners = 0;
  const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
  const staleProvider = {
    user: { id: "user_stale" },
    session: { id: "session_stale", getToken: async () => "stale-token" },
    client: null,
    async load() { await loadGate; },
    addListener() {
      providerListeners += 1;
      return () => { removedListeners += 1; };
    },
    async setActive() {},
    async signOut() {},
  };
  const stale = getHunterAuthSessionCoordinator({
    browserGlobal,
    createClerk: async () => staleProvider as never,
  });
  const pending = stale.load("pk_test_teardown_race");
  await Promise.resolve();
  stale.teardown();
  releaseLoad?.();
  const staleSnapshot = await pending;

  assert.equal(providerListeners, 0);
  assert.equal(removedListeners, 0);
  assert.equal(browserGlobal.timLostAuth, undefined);
  assert.equal(browserGlobal.__timLostHunterAuthSessionV1, undefined);
  assert.deepEqual(staleSnapshot, { status: "idle", principal: null, profile: null });

  const activeProvider = {
    user: { id: "user_active" },
    session: { id: "session_active", getToken: async () => "active-token" },
    client: null,
    async load() {},
    addListener() { providerListeners += 1; return () => { removedListeners += 1; }; },
    async setActive() {},
    async signOut() {},
  };
  const active = getHunterAuthSessionCoordinator({
    browserGlobal,
    createClerk: async () => activeProvider as never,
  });
  const activeSnapshot = await active.load("pk_test_teardown_race");
  assert.equal(activeSnapshot.status, "ready");
  assert.equal(providerListeners, 1);
  assert.equal(await (browserGlobal.timLostAuth as { getToken: () => Promise<string | null> }).getToken(), "active-token");
});
