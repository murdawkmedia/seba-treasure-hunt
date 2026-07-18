import type { Clerk } from "@clerk/clerk-js";

const GLOBAL_COORDINATOR_KEY = "__timLostHunterAuthSessionV1";

type BrowserGlobal = Record<string, unknown>;
type SessionStatus = "idle" | "ready" | "unavailable";

export interface HunterAuthPublicIdentity {
  publicDisplayName?: string;
  publicHandle?: string;
}

export interface HunterAuthSessionSnapshot {
  status: SessionStatus;
  clerk: Clerk | null;
  user: NonNullable<Clerk["user"]> | null;
  session: NonNullable<Clerk["session"]> | null;
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
  signOut: () => Promise<void>;
  teardown: () => void;
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
  let profile: HunterAuthPublicIdentity | null = null;
  let profileSessionId: string | null = null;
  let status: SessionStatus = "idle";
  let lifecycleGeneration = 0;
  let disposed = false;
  const listeners = new Set<(snapshot: HunterAuthSessionSnapshot) => void>();
  let current: HunterAuthSessionSnapshot = Object.freeze({
    status,
    clerk,
    user: null,
    session: null,
    profile,
  });

  const publish = (): HunterAuthSessionSnapshot => {
    const user = clerk?.user ?? null;
    const session = clerk?.session ?? null;
    const sessionId = session?.id ?? null;
    if (profileSessionId !== sessionId) {
      profile = null;
      profileSessionId = sessionId;
    }
    const changed = current.status !== status || current.clerk !== clerk ||
      current.user !== user || current.session !== session || current.profile !== profile;
    if (!changed) return current;
    current = Object.freeze({ status, clerk, user, session, profile });
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
    async signOut() {
      if (!clerk) return;
      await clerk.signOut();
      publish();
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
      current = Object.freeze({ status, clerk, user: null, session: null, profile });
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
