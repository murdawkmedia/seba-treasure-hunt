import type { Clerk } from "@clerk/clerk-js";

const GLOBAL_COORDINATOR_KEY = "__timLostHunterAuthSessionV1";

type BrowserGlobal = Record<string, unknown>;
type SessionStatus = "idle" | "ready" | "unavailable";

export interface HunterAuthSessionSnapshot {
  status: SessionStatus;
  clerk: Clerk | null;
  user: NonNullable<Clerk["user"]> | null;
  session: NonNullable<Clerk["session"]> | null;
  profile: Record<string, unknown> | null;
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

const profileIdentityKey = (value: Record<string, unknown> | null): string => JSON.stringify([
  typeof value?.publicDisplayName === "string" ? value.publicDisplayName.trim() : "",
  typeof value?.publicHandle === "string" ? value.publicHandle.trim() : "",
  typeof value?.participationBasis === "string" ? value.participationBasis : "",
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
  let profile: Record<string, unknown> | null = null;
  let profileSessionId: string | null = null;
  let status: SessionStatus = "idle";
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
      const normalizedKey = key.trim();
      if (!normalizedKey) return Promise.resolve(current);
      if (publishableKey && publishableKey !== normalizedKey) {
        return Promise.reject(new Error("Hunter identity was initialized with a different publishable key."));
      }
      publishableKey = normalizedKey;
      loadPromise ??= (async () => {
        try {
          clerk = await createClerk(normalizedKey);
          await clerk.load();
          status = "ready";
          removeProviderListener = clerk.addListener(() => { publish(); });
          const auth = { getToken: coordinator.getToken };
          if (!isRecord(browserGlobal.timLostAuth)) browserGlobal.timLostAuth = auth;
          return publish();
        } catch {
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
      const normalizedProfile = isRecord(nextProfile) ? nextProfile : null;
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
      removeProviderListener?.();
      removeProviderListener = null;
      listeners.clear();
      if (browserGlobal[GLOBAL_COORDINATOR_KEY] === coordinator) {
        delete browserGlobal[GLOBAL_COORDINATOR_KEY];
      }
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
