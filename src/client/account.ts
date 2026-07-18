import type { Clerk } from "@clerk/clerk-js";
import { privateAccountIdentity } from "../shared/public-identity";
import {
  getHunterAuthSessionCoordinator,
  type HunterAuthSessionCoordinator,
  type HunterAuthSessionSnapshot,
} from "./hunter-auth-session";
import { browserHunterSignupResumeStore } from "./hunter-signup-resume";
import { managePageLifecycleSubscription } from "./page-lifecycle-subscription";

type AccountUser = { imageUrl?: string | null };

export interface CampaignAccountModel {
  signedIn: boolean;
  handle: string;
  avatarUrl: string | null;
  initial: string;
}

export interface CampaignHunterSession {
  clerk: Clerk;
  getToken: () => Promise<string | null>;
  coordinator: HunterAuthSessionCoordinator;
  deploymentEnvironment: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function campaignAccountModel(user: AccountUser | null, profile: unknown): CampaignAccountModel {
  if (!user) return { signedIn: false, handle: "Sign in", avatarUrl: null, initial: "?" };
  const handle = privateAccountIdentity(isRecord(profile) ? profile : {});
  return {
    signedIn: true,
    handle,
    avatarUrl: safeAvatarUrl(user.imageUrl),
    initial: handle.charAt(0).toUpperCase() || "H",
  };
}

let sessionPromise: Promise<CampaignHunterSession | null> | null = null;

async function loadCampaignHunterSession(): Promise<CampaignHunterSession | null> {
  try {
    const response = await fetch("/api/v1/config", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const payload: unknown = response.ok ? await response.json() : null;
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    const publishableKey = isRecord(data) && typeof data.hunterPublishableKey === "string"
      ? data.hunterPublishableKey.trim()
      : "";
    const deploymentEnvironment = isRecord(data) && typeof data.deploymentEnvironment === "string" && data.deploymentEnvironment.trim()
      ? data.deploymentEnvironment.trim().toLowerCase()
      : null;
    if (!publishableKey) return null;
    const coordinator = getHunterAuthSessionCoordinator();
    const snapshot = await coordinator.load(publishableKey);
    const clerk = snapshot.clerk;
    if (!clerk || snapshot.status !== "ready") return null;
    const session: CampaignHunterSession = {
      clerk,
      getToken: coordinator.getToken,
      coordinator,
      deploymentEnvironment,
    };
    return session;
  } catch {
    return null;
  }
}

export function campaignHunterSession(): Promise<CampaignHunterSession | null> {
  sessionPromise ??= loadCampaignHunterSession();
  return sessionPromise;
}

async function fetchPrivateProfile(session: CampaignHunterSession): Promise<unknown> {
  const token = await session.getToken().catch(() => null);
  if (!token) return null;
  const response = await fetch("/api/v1/me/profile", {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const payload: unknown = response.ok ? await response.json() : null;
  return isRecord(payload) && Object.hasOwn(payload, "data") ? payload.data : null;
}

function navigateTo(destination: string): void {
  window.location.assign(destination);
}

export async function signOutCampaignHunterSession(
  providerSignOut: () => Promise<void>,
  clearSignupResume: () => void,
): Promise<void> {
  await providerSignOut();
  clearSignupResume();
}

async function initializeCampaignAccount(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-campaign-account]");
  if (!root || root.dataset.campaignAccountBound === "true") return;
  root.dataset.campaignAccountBound = "true";
  const signIn = root.querySelector<HTMLButtonElement>("[data-campaign-account-sign-in]");
  signIn?.addEventListener("click", () => navigateTo("/dashboard?intent=signin"));

  const toggle = root.querySelector<HTMLButtonElement>("[data-campaign-account-toggle]");
  const menu = root.querySelector<HTMLElement>("[data-campaign-account-menu]");
  const avatar = root.querySelector<HTMLElement>("[data-campaign-account-avatar]");
  const handle = root.querySelector<HTMLElement>("[data-campaign-account-handle]");

  const close = (): void => {
    if (menu) menu.hidden = true;
    toggle?.setAttribute("aria-expanded", "false");
  };
  toggle?.addEventListener("click", () => {
    const open = menu?.hidden !== false;
    if (menu) menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-campaign-account-destination]")) {
    button.addEventListener("click", () => navigateTo(button.dataset.campaignAccountDestination ?? "/dashboard"));
  }
  root.querySelector<HTMLButtonElement>("[data-campaign-sign-out]")?.addEventListener("click", async () => {
    const dashboardSignOut = document.querySelector<HTMLButtonElement>("[data-hunter-sign-out]");
    if (dashboardSignOut) {
      dashboardSignOut.click();
      return;
    }
    const activeSession = await campaignHunterSession();
    if (!activeSession) return;
    try {
      await signOutCampaignHunterSession(
        activeSession.coordinator.signOut,
        () => browserHunterSignupResumeStore(activeSession.deploymentEnvironment).clear(),
      );
    } catch {
      // The provider session and recoverable signup state remain intact when sign-out fails.
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !root.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu?.hidden === false) {
      close();
      toggle?.focus();
    }
  });

  let profileRequestSessionId: string | null = null;
  const render = (snapshot: HunterAuthSessionSnapshot): void => {
    const model = campaignAccountModel(snapshot.user, snapshot.profile);
    if (signIn) signIn.hidden = model.signedIn;
    if (toggle) toggle.hidden = !model.signedIn;
    if (handle) handle.textContent = model.handle;
    if (avatar) {
      avatar.textContent = model.initial;
      if (model.avatarUrl) {
        const image = document.createElement("img");
        image.src = model.avatarUrl;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        avatar.replaceChildren(image);
      }
    }
    if (!model.signedIn) close();
  };

  const session = await campaignHunterSession();
  if (!session) return;
  const refreshProfile = (snapshot: HunterAuthSessionSnapshot): void => {
    render(snapshot);
    const sessionId = snapshot.session?.id ?? null;
    if (!snapshot.user || snapshot.profile || !sessionId || profileRequestSessionId === sessionId) return;
    profileRequestSessionId = sessionId;
    void fetchPrivateProfile(session)
      .then((profile) => {
        if (session.coordinator.snapshot().session?.id === sessionId) {
          session.coordinator.setProfile(profile);
        }
      })
      .catch(() => {
        // The privacy-safe provider fallback remains available while profile data is unavailable.
      })
      .finally(() => {
        if (profileRequestSessionId === sessionId) profileRequestSessionId = null;
      });
  };
  managePageLifecycleSubscription(
    () => session.coordinator.subscribe(refreshProfile),
    () => refreshProfile(session.coordinator.refresh()),
  );
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initializeCampaignAccount(), { once: true });
  } else {
    void initializeCampaignAccount();
  }
}
