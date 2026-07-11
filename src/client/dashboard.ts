const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback = "Not supplied"): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

interface HunterAuthHook {
  getToken: () => Promise<string | null>;
}

interface PublicConfig {
  hunterPublishableKey: string | null;
  hunterAccountPortalUrl: string | null;
  turnstileSiteKey: string | null;
}

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: "profile";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

const profileTurnstileApi = (): TurnstileApi | undefined =>
  (window as unknown as TurnstileWindow).turnstile;

export interface HunterProfileDraft {
  fullName: string;
  phone: string;
  townArea: string;
  ageBand: string;
  interests: string[];
  discoverySource: string;
  adultAttested: boolean;
  huntEmail: boolean;
  marketing: boolean;
  sms: boolean;
  turnstileToken: string;
}

type ProfileErrors = Partial<Record<"fullName" | "phone" | "adultAttested" | "turnstileToken", string>>;

const validAgeBands = new Set(["", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]);

export function validateProfileDraft(draft: HunterProfileDraft): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!draft.fullName.trim()) errors.fullName = "Enter your name.";
  if (draft.sms && !draft.phone.trim()) errors.phone = "Add a phone number before choosing SMS updates.";
  if (!draft.adultAttested) {
    errors.adultAttested = "An adult participant must accept the eligibility statement.";
  }
  if (!draft.turnstileToken) errors.turnstileToken = "Complete the human check.";
  return errors;
}

export function buildProfilePayload(draft: HunterProfileDraft): Record<string, unknown> {
  return {
    fullName: draft.fullName.trim(),
    phone: draft.phone.trim() || null,
    townArea: draft.townArea.trim() || null,
    ageBand: validAgeBands.has(draft.ageBand) && draft.ageBand ? draft.ageBand : null,
    interests: draft.interests.slice(0, 10),
    discoverySource: draft.discoverySource.trim() || null,
    adultAttested: draft.adultAttested,
    consents: {
      huntEmail: draft.huntEmail,
      marketing: draft.marketing,
      sms: draft.sms,
    },
    cfTurnstileResponse: draft.turnstileToken,
  };
}

const unavailableConfig = (): PublicConfig => ({
  hunterPublishableKey: null,
  hunterAccountPortalUrl: null,
  turnstileSiteKey: null,
});

let profileTurnstileToken = "";
let profileTurnstileWidget: string | null = null;

async function authHeaders(auth: HunterAuthHook | null): Promise<Headers> {
  const headers = new Headers({ Accept: "application/json" });
  try {
    const token = await auth?.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    // A same-origin identity cookie may still be available to the backend.
  }
  return headers;
}

function safeHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.origin === window.location.origin ? url : null;
  } catch {
    return null;
  }
}

async function loadPublicConfig(): Promise<PublicConfig> {
  try {
    const response = await fetch("/api/v1/config", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return unavailableConfig();
    }
    const envelope: unknown = await response.json();
    if (!isRecord(envelope) || !isRecord(envelope.data)) {
      return unavailableConfig();
    }
    return {
      hunterPublishableKey:
        typeof envelope.data.hunterPublishableKey === "string" &&
        envelope.data.hunterPublishableKey
          ? envelope.data.hunterPublishableKey
          : null,
      hunterAccountPortalUrl:
        typeof envelope.data.hunterAccountPortalUrl === "string" &&
        envelope.data.hunterAccountPortalUrl
          ? envelope.data.hunterAccountPortalUrl
          : null,
      turnstileSiteKey:
        typeof envelope.data.turnstileSiteKey === "string" && envelope.data.turnstileSiteKey
          ? envelope.data.turnstileSiteKey
          : null,
    };
  } catch {
    return unavailableConfig();
  }
}

async function initializeManagedAuth(config: PublicConfig): Promise<HunterAuthHook | null> {
  if (!config.hunterPublishableKey) return null;
  try {
    const { Clerk } = await import("@clerk/clerk-js");
    const clerk = new Clerk(config.hunterPublishableKey);
    await clerk.load();
    const auth: HunterAuthHook = {
      getToken: async () => clerk.session?.getToken() ?? null,
    };
    (window as unknown as { timLostAuth?: HunterAuthHook }).timLostAuth = auth;
    return auth;
  } catch {
    return null;
  }
}

function accountPortalUrl(config: PublicConfig): URL | null {
  const url = safeHttpsUrl(config.hunterAccountPortalUrl);
  if (url) url.searchParams.set("redirect_url", window.location.href);
  return url;
}

function message(kind: "info" | "error" | "success", copy: string): void {
  const element = document.querySelector<HTMLElement>("[data-dashboard-message]");
  if (!element) return;
  element.dataset.kind = kind;
  element.textContent = copy;
  element.hidden = false;
}

function showSignedOut(reason: "signed-out" | "unavailable", config: PublicConfig): void {
  const gate = document.querySelector<HTMLElement>("[data-dashboard-state]");
  const content = document.querySelector<HTMLElement>("[data-dashboard-content]");
  if (gate) {
    gate.hidden = false;
    gate.dataset.dashboardState = reason;
  }
  if (content) content.hidden = true;

  const signIn = document.querySelector<HTMLAnchorElement>("[data-dashboard-sign-in]");
  const portal = accountPortalUrl(config);
  if (signIn && portal) {
    signIn.href = portal.toString();
    signIn.setAttribute("aria-disabled", "false");
    signIn.removeAttribute("tabindex");
  }

  message(
    reason === "signed-out" ? "info" : "error",
    reason === "signed-out"
      ? "Sign in to retrieve your private Hunter Dashboard."
      : "Hunter Dashboard data cannot be verified right now. Public pages and private reporting remain available.",
  );
}

function renderProfile(profile: unknown): void {
  const root = document.querySelector<HTMLElement>("[data-dashboard-profile]");
  if (!root) return;
  root.replaceChildren();
  if (!isRecord(profile)) {
    const copy = document.createElement("p");
    copy.textContent = "Complete your private profile before using member tools.";
    root.appendChild(copy);
    return;
  }

  const heading = document.createElement("h2");
  const handle = document.createElement("p");
  const location = document.createElement("p");
  heading.textContent = text(profile.fullName, "Hunter profile");
  handle.className = "identity-card__handle";
  handle.textContent = text(profile.publicHandle, "Public handle pending");
  location.textContent = text(profile.townArea, "Town or area not supplied");
  root.appendChild(heading);
  root.appendChild(handle);
  root.appendChild(location);
}

function zoneState(value: unknown): string {
  const allowed = new Set(["open", "restricted", "hazardous", "temporarily_closed", "unreviewed"]);
  return typeof value === "string" && allowed.has(value) ? value : "unreviewed";
}

function renderWaypoints(waypoints: unknown, status: unknown): void {
  const list = document.querySelector<HTMLOListElement>("[data-dashboard-waypoints]");
  if (!list) return;
  list.replaceChildren();
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No approved member waypoints are available.";
    list.appendChild(item);
    return;
  }

  const caseOpen = isRecord(status) && status.state === "open";
  for (const raw of waypoints) {
    if (!isRecord(raw)) continue;
    const item = document.createElement("li");
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    const description = document.createElement("p");
    const state = zoneState(raw.zoneState);
    const badge = document.createElement("span");
    heading.textContent = text(raw.name, "Waypoint");
    description.textContent = text(raw.description, "No additional description is available.");
    badge.className = "zone-state";
    badge.dataset.zone = state;
    badge.textContent = state.replaceAll("_", " ");
    copy.appendChild(heading);
    copy.appendChild(description);

    const exactUrl = safeHttpsUrl(raw.exactUrl);
    if (caseOpen && state === "open" && exactUrl) {
      const link = document.createElement("a");
      link.href = exactUrl.toString();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open approved directions";
      copy.appendChild(document.createElement("br"));
      copy.appendChild(link);
    } else {
      const locked = document.createElement("span");
      locked.className = "field-hint";
      locked.textContent = "Exact directions locked by current case or access state.";
      copy.appendChild(locked);
    }
    item.appendChild(copy);
    item.appendChild(badge);
    list.appendChild(item);
  }
}

function renderLatestUpdate(value: unknown): void {
  const root = document.querySelector<HTMLElement>("[data-dashboard-latest-update]");
  if (!root || !isRecord(value)) return;
  const title = document.createElement("h2");
  const body = document.createElement("p");
  const provenance = document.createElement("p");
  title.textContent = text(value.title, "Official update");
  body.textContent = text(value.body, "No update details were supplied.");
  provenance.className = "provenance";
  provenance.textContent = `${text(value.publisherName, "Campaign operator")} · ${text(value.publishedAt, "Time unavailable")}`;
  root.replaceChildren();
  root.appendChild(title);
  root.appendChild(provenance);
  root.appendChild(body);
}

function renderRecords(selector: string, values: unknown, empty: string): void {
  const list = document.querySelector<HTMLUListElement>(selector);
  if (!list) return;
  list.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) {
    const item = document.createElement("li");
    item.textContent = empty;
    list.appendChild(item);
    return;
  }
  for (const raw of values) {
    if (!isRecord(raw)) continue;
    const item = document.createElement("li");
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    const detail = document.createElement("p");
    const state = document.createElement("span");
    heading.textContent = text(raw.title, text(raw.type, "Record"));
    detail.textContent = text(raw.createdAt, "Date unavailable");
    state.className = "record-state";
    state.textContent = text(raw.status, "Pending");
    copy.appendChild(heading);
    copy.appendChild(detail);
    item.appendChild(copy);
    item.appendChild(state);
    list.appendChild(item);
  }
}

function renderDashboard(data: Record<string, unknown>): void {
  const gate = document.querySelector<HTMLElement>("[data-dashboard-state]");
  const content = document.querySelector<HTMLElement>("[data-dashboard-content]");
  if (gate) gate.hidden = true;
  if (content) content.hidden = false;
  renderProfile(data.profile);
  renderLatestUpdate(data.latestUpdate);
  renderWaypoints(data.waypoints, data.status);
  renderRecords("[data-dashboard-reports]", data.reports, "No private reports yet.");
  renderRecords("[data-dashboard-notes]", data.notes, "No Field Notes yet.");
  message(
    isRecord(data.profile) ? "success" : "info",
    isRecord(data.profile)
      ? "Your private Hunter Dashboard is up to date."
      : "You are signed in. Complete the private profile to unlock approved exact directions and community tools.",
  );
}

function profileInput<T extends HTMLInputElement | HTMLSelectElement>(
  form: HTMLFormElement,
  selector: string,
): T | null {
  return form.querySelector<T>(selector);
}

function fillProfileForm(form: HTMLFormElement, profile: unknown): void {
  if (!isRecord(profile)) return;
  const setValue = (name: string, value: unknown): void => {
    const input = profileInput<HTMLInputElement | HTMLSelectElement>(form, `[name="${name}"]`);
    if (input) input.value = typeof value === "string" ? value : "";
  };
  setValue("fullName", profile.fullName);
  setValue("phone", profile.phone);
  setValue("townArea", profile.townArea);
  setValue("ageBand", profile.ageBand);
  setValue("discoverySource", profile.discoverySource);

  const interests = new Set(
    Array.isArray(profile.interests)
      ? profile.interests.filter((item): item is string => typeof item === "string")
      : [],
  );
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="interests"]')) {
    input.checked = interests.has(input.value);
  }

  const consents = isRecord(profile.consents) ? profile.consents : {};
  for (const name of ["huntEmail", "marketing", "sms"] as const) {
    const input = profileInput<HTMLInputElement>(form, `input[name="${name}"]`);
    if (input) input.checked = consents[name] === true;
  }
  const adult = profileInput<HTMLInputElement>(form, 'input[name="adultAttested"]');
  if (adult) adult.checked = Boolean(profile.adultAttestedAt);
}

function readProfileDraft(form: HTMLFormElement): HunterProfileDraft {
  const value = (name: string): string =>
    profileInput<HTMLInputElement | HTMLSelectElement>(form, `[name="${name}"]`)?.value ?? "";
  const checked = (name: string): boolean =>
    profileInput<HTMLInputElement>(form, `input[name="${name}"]`)?.checked ?? false;
  return {
    fullName: value("fullName"),
    phone: value("phone"),
    townArea: value("townArea"),
    ageBand: value("ageBand"),
    interests: [...form.querySelectorAll<HTMLInputElement>('input[name="interests"]:checked')].map(
      (input) => input.value,
    ),
    discoverySource: value("discoverySource"),
    adultAttested: checked("adultAttested"),
    huntEmail: checked("huntEmail"),
    marketing: checked("marketing"),
    sms: checked("sms"),
    turnstileToken: profileTurnstileToken,
  };
}

function showProfileErrors(errors: ProfileErrors): void {
  const summary = document.querySelector<HTMLElement>("[data-profile-errors]");
  for (const element of document.querySelectorAll<HTMLElement>("[data-profile-error-for]")) {
    element.textContent = "";
  }
  for (const [field, copy] of Object.entries(errors)) {
    const error = document.querySelector<HTMLElement>(`[data-profile-error-for="${field}"]`);
    if (error) error.textContent = copy;
    const control = document.querySelector<HTMLElement>(`[name="${field}"]`);
    control?.setAttribute("aria-invalid", "true");
  }
  if (!summary) return;
  const messages = Object.values(errors);
  summary.hidden = messages.length === 0;
  summary.innerHTML = messages.length
    ? `<strong>Please fix this:</strong><ul>${messages.map((copy) => `<li>${copy}</li>`).join("")}</ul>`
    : "";
  if (messages.length) summary.focus();
}

function setProfileResult(copy: string, kind: "success" | "error"): void {
  const result = document.querySelector<HTMLElement>("[data-profile-result]");
  if (!result) return;
  result.dataset.kind = kind;
  result.textContent = copy;
  result.hidden = false;
  result.focus();
}

function profileErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : payload;
  return typeof error.message === "string" && error.message.trim() ? error.message : fallback;
}

async function waitForTurnstile(): Promise<TurnstileApi | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const turnstile = profileTurnstileApi();
    if (turnstile) return turnstile;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  return null;
}

async function initializeProfileTurnstile(config: PublicConfig): Promise<void> {
  const container = document.querySelector<HTMLElement>("[data-profile-turnstile]");
  const state = document.querySelector<HTMLElement>("[data-profile-turnstile-state]");
  const submit = document.querySelector<HTMLButtonElement>("[data-profile-submit]");
  if (!container || !state || !submit) return;
  const turnstile = await waitForTurnstile();
  if (!turnstile || !config.turnstileSiteKey) {
    state.textContent = "Human verification is not configured. Profile changes remain unavailable.";
    submit.disabled = true;
    return;
  }
  state.remove();
  profileTurnstileWidget = turnstile.render(container, {
    sitekey: config.turnstileSiteKey,
    action: "profile",
    callback: (token) => {
      profileTurnstileToken = token;
      submit.disabled = false;
      const error = document.querySelector<HTMLElement>('[data-profile-error-for="turnstileToken"]');
      if (error) error.textContent = "";
    },
    "expired-callback": () => {
      profileTurnstileToken = "";
      submit.disabled = true;
    },
    "error-callback": () => {
      profileTurnstileToken = "";
      submit.disabled = true;
      setProfileResult("The human check could not load. Refresh the page before saving.", "error");
    },
  });
}

async function fetchDashboard(auth: HunterAuthHook | null): Promise<Response> {
  return await fetch("/api/v1/me/dashboard", {
    headers: await authHeaders(auth),
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(10_000),
  });
}

async function initializeProfileForm(
  auth: HunterAuthHook | null,
  config: PublicConfig,
  profile: unknown,
): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("[data-profile-form]");
  const submit = document.querySelector<HTMLButtonElement>("[data-profile-submit]");
  if (!form || !submit) return;
  fillProfileForm(form, profile);
  void initializeProfileTurnstile(config);

  form.addEventListener("input", () => {
    for (const control of form.querySelectorAll<HTMLElement>('[aria-invalid="true"]')) {
      control.removeAttribute("aria-invalid");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = readProfileDraft(form);
    const errors = validateProfileDraft(draft);
    showProfileErrors(errors);
    if (Object.keys(errors).length > 0) return;

    submit.disabled = true;
    try {
      const headers = await authHeaders(auth);
      headers.set("Content-Type", "application/json");
      const response = await fetch("/api/v1/me/profile", {
        method: "PATCH",
        headers,
        credentials: "same-origin",
        body: JSON.stringify(buildProfilePayload(draft)),
        signal: AbortSignal.timeout(12_000),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(profileErrorMessage(payload, "Your profile could not be saved."));
      const saved = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      if (saved) {
        renderProfile(saved);
        fillProfileForm(form, saved);
      }

      const dashboardResponse = await fetchDashboard(auth);
      if (dashboardResponse.ok) {
        const dashboardPayload: unknown = await dashboardResponse.json();
        if (isRecord(dashboardPayload) && isRecord(dashboardPayload.data)) {
          renderDashboard(dashboardPayload.data);
          fillProfileForm(form, dashboardPayload.data.profile);
        }
      }
      showProfileErrors({});
      setProfileResult("Profile saved. Your approved route access and contact choices are up to date.", "success");
      profileTurnstileToken = "";
      const turnstile = profileTurnstileApi();
      if (turnstile && profileTurnstileWidget) turnstile.reset(profileTurnstileWidget);
    } catch (error) {
      setProfileResult(error instanceof Error ? error.message : "Your profile could not be saved.", "error");
    } finally {
      submit.disabled = profileTurnstileToken.length === 0;
    }
  });
}

async function initializeDashboard(): Promise<void> {
  const config = await loadPublicConfig();
  const auth = await initializeManagedAuth(config);
  try {
    const response = await fetchDashboard(auth);
    if (response.status === 401 || response.status === 403) {
      showSignedOut("signed-out", config);
      return;
    }
    if (!response.ok) throw new Error("dashboard unavailable");
    const envelope: unknown = await response.json();
    if (!isRecord(envelope) || !isRecord(envelope.data)) throw new Error("dashboard unavailable");
    renderDashboard(envelope.data);
    await initializeProfileForm(auth, config, envelope.data.profile);
  } catch {
    showSignedOut("unavailable", config);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initializeDashboard(), { once: true });
  } else {
    void initializeDashboard();
  }
}

export {};
