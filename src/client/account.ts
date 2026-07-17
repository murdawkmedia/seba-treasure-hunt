import type { Clerk } from "@clerk/clerk-js";
import { privateAccountIdentity } from "../shared/public-identity";

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
    if (!publishableKey) return null;
    const { Clerk: ClerkConstructor } = await import("@clerk/clerk-js");
    const clerk = new ClerkConstructor(publishableKey);
    await clerk.load();
    const session: CampaignHunterSession = {
      clerk,
      getToken: async () => clerk.session?.getToken() ?? null,
    };
    const target = window as unknown as { timLostAuth?: { getToken: () => Promise<string | null> } };
    target.timLostAuth ??= { getToken: session.getToken };
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

async function initializeCampaignAccount(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-campaign-account]");
  if (!root) return;
  const signIn = root.querySelector<HTMLButtonElement>("[data-campaign-account-sign-in]");
  signIn?.addEventListener("click", () => navigateTo("/dashboard?intent=signin"));

  const session = await campaignHunterSession();
  const profile = session?.clerk.user ? await fetchPrivateProfile(session) : null;
  const model = campaignAccountModel(session?.clerk.user ?? null, profile);
  if (!model.signedIn || !session) return;

  const toggle = root.querySelector<HTMLButtonElement>("[data-campaign-account-toggle]");
  const menu = root.querySelector<HTMLElement>("[data-campaign-account-menu]");
  const avatar = root.querySelector<HTMLElement>("[data-campaign-account-avatar]");
  const handle = root.querySelector<HTMLElement>("[data-campaign-account-handle]");
  if (signIn) signIn.hidden = true;
  if (toggle) toggle.hidden = false;
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
    await session.clerk.signOut();
    window.location.reload();
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
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initializeCampaignAccount(), { once: true });
  } else {
    void initializeCampaignAccount();
  }
}
