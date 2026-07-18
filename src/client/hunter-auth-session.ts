import type { Clerk } from "@clerk/clerk-js";
import type { SignInResource, SignUpResource } from "@clerk/shared/types";
import type { SignupProviderAttemptSnapshot } from "./hunter-signup-resume";

const GLOBAL_COORDINATOR_KEY = "__timLostHunterAuthSessionV1";

type BrowserGlobal = Record<string, unknown>;
type SessionStatus = "idle" | "ready" | "unavailable";

export interface HunterAuthPublicIdentity {
  publicDisplayName?: string;
  publicHandle?: string;
}

export interface HunterAuthPrincipal {
  subject: string;
  version: number;
}

export interface HunterAuthSessionSnapshot {
  status: SessionStatus;
  principal: HunterAuthPrincipal | null;
  profile: HunterAuthPublicIdentity | null;
}

export interface HunterAuthSessionCoordinator {
  load: (publishableKey: string) => Promise<HunterAuthSessionSnapshot>;
  snapshot: () => HunterAuthSessionSnapshot;
  subscribe: (listener: (snapshot: HunterAuthSessionSnapshot) => void) => () => void;
  refresh: () => HunterAuthSessionSnapshot;
  setProfile: (profile: unknown) => void;
  getToken: () => Promise<string | null>;
  activate: (sessionId: string) => Promise<void>;
  hasActiveSession: (sessionId: string) => boolean;
  signOut: () => Promise<void>;
  signupAttempt: () => SignupProviderAttemptSnapshot | null;
  createSignup: (emailAddress: string, password: string) => Promise<SignupProviderAttemptSnapshot>;
  prepareSignupVerification: () => Promise<SignupProviderAttemptSnapshot>;
  attemptSignupVerification: (code: string) => Promise<SignupProviderAttemptSnapshot>;
  signInWithPassword: (identifier: string, password: string) => Promise<HunterSignInResult>;
  beginPasswordRecovery: (identifier: string) => Promise<void>;
  completePasswordRecovery: (code: string, password: string) => Promise<HunterSignInResult>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  primaryEmailMatches: (emailAddress: string) => boolean;
  teardown: () => void;
}

export interface HunterSignInResult {
  status: string | null;
  createdSessionId: string | null;
}

interface CoordinatorOptions {
  browserGlobal?: BrowserGlobal;
  createClerk?: (publishableKey: string) => Promise<Clerk>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const projectPublicIdentity = (value: unknown): HunterAuthPublicIdentity | null => {
  if (!isRecord(value)) return null;
  const projected: HunterAuthPublicIdentity = {};
  if (typeof value.publicDisplayName === "string" && value.publicDisplayName.trim()) {
    projected.publicDisplayName = value.publicDisplayName.trim();
  }
  if (typeof value.publicHandle === "string" && value.publicHandle.trim()) {
    projected.publicHandle = value.publicHandle.trim();
  }
  return Object.freeze(projected);
};

const profileIdentityKey = (value: HunterAuthPublicIdentity | null): string => JSON.stringify([
  typeof value?.publicDisplayName === "string" ? value.publicDisplayName.trim() : "",
  typeof value?.publicHandle === "string" ? value.publicHandle.trim() : "",
]);

const signupAttemptSnapshot = (attempt: SignUpResource | null | undefined): SignupProviderAttemptSnapshot | null => {
  if (!attempt) return null;
  return Object.freeze({
    id: attempt.id ?? undefined,
    status: attempt.status ?? null,
    emailAddress: attempt.emailAddress ?? null,
    createdSessionId: attempt.createdSessionId ?? null,
    unverifiedFields: Object.freeze([...(attempt.unverifiedFields ?? [])]),
    missingFields: Object.freeze([...(attempt.missingFields ?? [])]),
    verifications: attempt.verifications ? {
      emailAddress: attempt.verifications.emailAddress ? {
        status: attempt.verifications.emailAddress.status ?? null,
        strategy: attempt.verifications.emailAddress.strategy ?? null,
      } : null,
    } : null,
  });
};

const signInResult = (attempt: SignInResource): HunterSignInResult => Object.freeze({
  status: attempt.status ?? null,
  createdSessionId: attempt.createdSessionId ?? null,
});

const defaultCreateClerk = async (publishableKey: string): Promise<Clerk> => {
  const { Clerk: ClerkConstructor } = await import("@clerk/clerk-js");
  return new ClerkConstructor(publishableKey);
};

function createCoordinator(
  browserGlobal: BrowserGlobal,
  createClerk: (publishableKey: string) => Promise<Clerk>,
): HunterAuthSessionCoordinator {
  let clerk: Clerk | null = null;
  let publishableKey: string | null = null;
  let loadPromise: Promise<HunterAuthSessionSnapshot> | null = null;
  let removeProviderListener: (() => void) | null = null;
  let ownedAuthHook: { getToken: () => Promise<string | null> } | null = null;
  let signInAttempt: SignInResource | null = null;
  let profile: HunterAuthPublicIdentity | null = null;
  let profileSessionId: string | null = null;
  let status: SessionStatus = "idle";
  let principalVersion = 0;
  let principalUserId: string | null = null;
  let principalSessionId: string | null = null;
  let lifecycleGeneration = 0;
  let disposed = false;
  const listeners = new Set<(snapshot: HunterAuthSessionSnapshot) => void>();
  let current: HunterAuthSessionSnapshot = Object.freeze({
    status,
    principal: null,
    profile,
  });

  const publish = (): HunterAuthSessionSnapshot => {
    const user = clerk?.user ?? null;
    const session = clerk?.session ?? null;
    const userId = typeof user?.id === "string" && user.id ? user.id : null;
    const sessionId = session?.id ?? null;
    if (principalUserId !== userId || principalSessionId !== sessionId) {
      principalVersion += 1;
      principalUserId = userId;
      principalSessionId = sessionId;
    }
    const principal = userId && sessionId
      ? Object.freeze({ subject: userId, version: principalVersion })
      : null;
    if (profileSessionId !== sessionId) {
      profile = null;
      profileSessionId = sessionId;
    }
    const changed = current.status !== status ||
      current.principal?.subject !== principal?.subject ||
      current.principal?.version !== principal?.version ||
      current.profile !== profile;
    if (!changed) return current;
    current = Object.freeze({ status, principal, profile });
    for (const listener of [...listeners]) listener(current);
    return current;
  };

  const coordinator: HunterAuthSessionCoordinator = {
    load(key) {
      if (disposed) return Promise.resolve(current);
      const normalizedKey = key.trim();
      if (!normalizedKey) return Promise.resolve(current);
      if (publishableKey && publishableKey !== normalizedKey) {
        return Promise.reject(new Error("Hunter identity was initialized with a different publishable key."));
      }
      publishableKey = normalizedKey;
      const activeLifecycleGeneration = lifecycleGeneration;
      const loadIsCurrent = (): boolean =>
        !disposed && lifecycleGeneration === activeLifecycleGeneration;
      loadPromise ??= (async () => {
        try {
          const loadedClerk = await createClerk(normalizedKey);
          if (!loadIsCurrent()) return current;
          clerk = loadedClerk;
          await loadedClerk.load();
          if (!loadIsCurrent()) return current;
          status = "ready";
          const installedProviderListener = loadedClerk.addListener(() => {
            if (loadIsCurrent()) publish();
          });
          if (!loadIsCurrent()) {
            installedProviderListener();
            return current;
          }
          removeProviderListener = installedProviderListener;
          const auth = { getToken: coordinator.getToken };
          if (!isRecord(browserGlobal.timLostAuth)) {
            browserGlobal.timLostAuth = auth;
            ownedAuthHook = auth;
          }
          return publish();
        } catch {
          if (!loadIsCurrent()) return current;
          status = "unavailable";
          clerk = null;
          return publish();
        }
      })();
      return loadPromise;
    },
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: publish,
    setProfile(nextProfile) {
      const normalizedProfile = projectPublicIdentity(nextProfile);
      const nextProfileSessionId = clerk?.session?.id ?? null;
      if (
        profileSessionId === nextProfileSessionId &&
        profileIdentityKey(profile) === profileIdentityKey(normalizedProfile)
      ) {
        profile = normalizedProfile;
        current = Object.freeze({ ...current, profile });
        return;
      }
      profile = normalizedProfile;
      profileSessionId = nextProfileSessionId;
      publish();
    },
    async getToken() {
      try {
        return await clerk?.session?.getToken() ?? null;
      } catch {
        return null;
      }
    },
    async activate(sessionId) {
      if (!clerk || !sessionId) throw new Error("Hunter identity is not ready.");
      await clerk.setActive({ session: sessionId });
      publish();
    },
    hasActiveSession: (sessionId) => clerk?.session?.id === sessionId,
    async signOut() {
      if (!clerk) return;
      await clerk.signOut();
      publish();
    },
    signupAttempt: () => signupAttemptSnapshot(clerk?.client?.signUp),
    async createSignup(emailAddress, password) {
      if (!clerk?.client) throw new Error("Hunter identity is not ready.");
      return signupAttemptSnapshot(await clerk.client.signUp.create({ emailAddress, password })) ?? {};
    },
    async prepareSignupVerification() {
      const attempt = clerk?.client?.signUp;
      if (!attempt) throw new Error("Hunter sign-up is not ready.");
      return signupAttemptSnapshot(await attempt.prepareEmailAddressVerification({ strategy: "email_code" })) ?? {};
    },
    async attemptSignupVerification(code) {
      const attempt = clerk?.client?.signUp;
      if (!attempt) throw new Error("Hunter sign-up is not ready.");
      return signupAttemptSnapshot(await attempt.attemptEmailAddressVerification({ code })) ?? {};
    },
    async signInWithPassword(identifier, password) {
      if (!clerk?.client) throw new Error("Hunter identity is not ready.");
      signInAttempt = await clerk.client.signIn.create({ strategy: "password", identifier, password });
      return signInResult(signInAttempt);
    },
    async beginPasswordRecovery(identifier) {
      if (!clerk?.client) throw new Error("Hunter identity is not ready.");
      signInAttempt = await clerk.client.signIn.create({ strategy: "reset_password_email_code", identifier });
      const factor = signInAttempt.supportedFirstFactors?.find((item) => item.strategy === "reset_password_email_code");
      if (!factor || factor.strategy !== "reset_password_email_code") throw new Error("Email recovery is unavailable.");
      signInAttempt = await signInAttempt.prepareFirstFactor({
        strategy: "reset_password_email_code",
        emailAddressId: factor.emailAddressId,
      });
    },
    async completePasswordRecovery(code, password) {
      if (!signInAttempt) throw new Error("Password recovery is not ready.");
      signInAttempt = await signInAttempt.attemptFirstFactor({ strategy: "reset_password_email_code", code });
      if (signInAttempt.status === "needs_new_password") {
        signInAttempt = await signInAttempt.resetPassword({ password, signOutOfOtherSessions: true });
      }
      return signInResult(signInAttempt);
    },
    async updatePassword(currentPassword, newPassword) {
      if (!clerk?.user) throw new Error("Hunter identity is not ready.");
      await clerk.user.updatePassword({ currentPassword, newPassword, signOutOfOtherSessions: true });
    },
    primaryEmailMatches(emailAddress) {
      return clerk?.user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() === emailAddress.trim().toLowerCase();
    },
    teardown() {
      if (disposed) return;
      disposed = true;
      lifecycleGeneration += 1;
      removeProviderListener?.();
      removeProviderListener = null;
      listeners.clear();
      if (ownedAuthHook && browserGlobal.timLostAuth === ownedAuthHook) {
        delete browserGlobal.timLostAuth;
      }
      ownedAuthHook = null;
      if (browserGlobal[GLOBAL_COORDINATOR_KEY] === coordinator) {
        delete browserGlobal[GLOBAL_COORDINATOR_KEY];
      }
      clerk = null;
      profile = null;
      profileSessionId = null;
      status = "idle";
      principalUserId = null;
      principalSessionId = null;
      current = Object.freeze({ status, principal: null, profile });
    },
  };
  return coordinator;
}

export function getHunterAuthSessionCoordinator(
  options: CoordinatorOptions = {},
): HunterAuthSessionCoordinator {
  const browserGlobal = options.browserGlobal ?? window as unknown as BrowserGlobal;
  const existing = browserGlobal[GLOBAL_COORDINATOR_KEY];
  if (existing) return existing as HunterAuthSessionCoordinator;
  const coordinator = createCoordinator(browserGlobal, options.createClerk ?? defaultCreateClerk);
  browserGlobal[GLOBAL_COORDINATOR_KEY] = coordinator;
  return coordinator;
}
