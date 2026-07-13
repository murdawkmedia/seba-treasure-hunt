const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback = "Not supplied"): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

interface HunterAuthHook {
  getToken: () => Promise<string | null>;
}

interface PublicConfig {
  hunterPublishableKey: string | null;
}

export interface HunterProfileDraft {
  fullName: string;
  townArea: string;
  interests: string[];
  discoverySource: string;
  adultAttested: boolean;
  privacyMediaAccepted: boolean;
  huntEmail: boolean;
  marketing: boolean;
}

type ProfileErrors = Partial<Record<"fullName" | "adultAttested" | "privacyMediaAccepted", string>>;

export function validateProfileDraft(draft: HunterProfileDraft): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!draft.fullName.trim()) errors.fullName = "Enter your name.";
  if (!draft.adultAttested) {
    errors.adultAttested = "An adult participant must accept the eligibility statement.";
  }
  if (!draft.privacyMediaAccepted) {
    errors.privacyMediaAccepted = "Read and accept the current Privacy Policy & Media Notice.";
  }
  return errors;
}

export function buildProfilePayload(draft: HunterProfileDraft): Record<string, unknown> {
  return {
    fullName: draft.fullName.trim(),
    townArea: draft.townArea.trim() || null,
    interests: draft.interests.slice(0, 10),
    discoverySource: draft.discoverySource.trim() || null,
    adultAttested: draft.adultAttested,
    privacyMediaAccepted: draft.privacyMediaAccepted,
    privacyMediaVersion: "2026.1",
    consents: {
      huntEmail: draft.huntEmail,
      marketing: draft.marketing,
    },
  };
}

const unavailableConfig = (): PublicConfig => ({
  hunterPublishableKey: null,
});

let hunterClerk: Clerk | null = null;
let signInAttempt: SignInResource | null = null;
let signUpAttempt: SignUpResource | null = null;

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
    };
  } catch {
    return unavailableConfig();
  }
}

async function initializeManagedAuth(config: PublicConfig): Promise<HunterAuthHook | null> {
  if (!config.hunterPublishableKey) return null;
  try {
    const { Clerk } = await import("@clerk/clerk-js");
    hunterClerk = new Clerk(config.hunterPublishableKey);
    await hunterClerk.load();
    const auth: HunterAuthHook = {
      getToken: async () => hunterClerk?.session?.getToken() ?? null,
    };
    (window as unknown as { timLostAuth?: HunterAuthHook }).timLostAuth = auth;
    return auth;
  } catch {
    return null;
  }
}

function message(kind: "info" | "error" | "success", copy: string): void {
  const element = document.querySelector<HTMLElement>("[data-dashboard-message]");
  if (!element) return;
  element.dataset.kind = kind;
  element.textContent = copy;
  element.hidden = false;
}

function showSignedOut(reason: "signed-out" | "unavailable"): void {
  const gate = document.querySelector<HTMLElement>("[data-dashboard-state]");
  const content = document.querySelector<HTMLElement>("[data-dashboard-content]");
  if (gate) {
    gate.hidden = false;
    gate.dataset.dashboardState = reason;
  }
  if (content) content.hidden = true;

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
  setValue("townArea", profile.townArea);
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
  for (const name of ["huntEmail", "marketing"] as const) {
    const input = profileInput<HTMLInputElement>(form, `input[name="${name}"]`);
    if (input) input.checked = consents[name] === true;
  }
  const adult = profileInput<HTMLInputElement>(form, 'input[name="adultAttested"]');
  if (adult) adult.checked = Boolean(profile.adultAttestedAt);
  const privacy = profileInput<HTMLInputElement>(form, 'input[name="privacyMediaAccepted"]');
  if (privacy) privacy.checked = true;
}

function readProfileDraft(form: HTMLFormElement): HunterProfileDraft {
  const value = (name: string): string =>
    profileInput<HTMLInputElement | HTMLSelectElement>(form, `[name="${name}"]`)?.value ?? "";
  const checked = (name: string): boolean =>
    profileInput<HTMLInputElement>(form, `input[name="${name}"]`)?.checked ?? false;
  return {
    fullName: value("fullName"),
    townArea: value("townArea"),
    interests: [...form.querySelectorAll<HTMLInputElement>('input[name="interests"]:checked')].map(
      (input) => input.value,
    ),
    discoverySource: value("discoverySource"),
    adultAttested: checked("adultAttested"),
    privacyMediaAccepted: checked("privacyMediaAccepted"),
    huntEmail: checked("huntEmail"),
    marketing: checked("marketing"),
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
  profile: unknown,
): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("[data-profile-form]");
  const submit = document.querySelector<HTMLButtonElement>("[data-profile-submit]");
  if (!form || !submit) return;
  fillProfileForm(form, profile);

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
      setProfileResult("Profile saved. Exact directions remain locked until the approved waiver is published and accepted.", "success");
    } catch (error) {
      setProfileResult(error instanceof Error ? error.message : "Your profile could not be saved.", "error");
    } finally {
      submit.disabled = false;
    }
  });
}

function authMessage(copy: string, kind: "info" | "error" | "success" = "info"): void {
  const element = document.querySelector<HTMLElement>("[data-auth-message]");
  if (!element) return;
  element.dataset.kind = kind;
  element.textContent = copy;
}

function identityError(error: unknown, fallback: string): string {
  if (!isRecord(error)) return fallback;
  const errors = Array.isArray(error.errors) ? error.errors : [];
  const first = errors.find(isRecord);
  const candidate = first && (first.longMessage ?? first.message);
  return typeof candidate === "string" && candidate.trim() ? candidate : fallback;
}

function showAuthForm(id: string): void {
  for (const form of document.querySelectorAll<HTMLFormElement>(".auth-form")) {
    form.hidden = form.id !== id;
  }
}

async function activateSession(sessionId: string | null | undefined): Promise<boolean> {
  if (!hunterClerk || !sessionId) return false;
  await hunterClerk.setActive({ session: sessionId });
  return true;
}

async function bootstrapPlayer(auth: HunterAuthHook): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers = await authHeaders(auth);
    headers.set("Content-Type", "application/json");
    const response = await fetch("/api/v1/me/bootstrap", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: "{}",
    });
    if (response.ok) return;
    if (response.status !== 409 || attempt === 3) {
      throw new Error("Your verified player account could not be prepared.");
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
  }
}

async function loadSignedInDashboard(auth: HunterAuthHook): Promise<void> {
  await bootstrapPlayer(auth);
  const response = await fetchDashboard(auth);
  if (!response.ok) throw new Error("Your dashboard could not be loaded.");
  const envelope: unknown = await response.json();
  if (!isRecord(envelope) || !isRecord(envelope.data)) throw new Error("Your dashboard could not be loaded.");
  renderDashboard(envelope.data);
  await initializeProfileForm(auth, envelope.data.profile);
}

function setupAccountForms(auth: HunterAuthHook): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-show-auth]")) {
    button.addEventListener("click", () => showAuthForm(button.dataset.showAuth ?? "hunter-sign-in-form"));
  }

  const signIn = document.querySelector<HTMLFormElement>("#hunter-sign-in-form");
  signIn?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(signIn);
    const identifier = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!hunterClerk?.client || !identifier || password.length < 12) {
      authMessage("Enter your email and a password of at least 12 characters.", "error");
      return;
    }
    try {
      signInAttempt = await hunterClerk.client.signIn.create({ strategy: "password", identifier, password });
      if (signInAttempt.status !== "complete" || !await activateSession(signInAttempt.createdSessionId)) {
        throw new Error("Additional account verification is required.");
      }
      await loadSignedInDashboard(auth);
    } catch (error) {
      authMessage(identityError(error, "Sign-in failed. Check your email and password."), "error");
    }
  });

  const signUp = document.querySelector<HTMLFormElement>("#hunter-sign-up-form");
  signUp?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(signUp);
    const emailAddress = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!hunterClerk?.client || !emailAddress || password.length < 12) {
      authMessage("Enter a valid email and a password of at least 12 characters.", "error");
      return;
    }
    try {
      signUpAttempt = await hunterClerk.client.signUp.create({ emailAddress, password });
      await signUpAttempt.prepareEmailAddressVerification({ strategy: "email_code" });
      showAuthForm("hunter-verify-form");
      authMessage("Check your email for the verification code.", "success");
    } catch (error) {
      authMessage(identityError(error, "Your account could not be created."), "error");
    }
  });

  const verify = document.querySelector<HTMLFormElement>("#hunter-verify-form");
  verify?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = String(new FormData(verify).get("code") ?? "").trim();
    if (!signUpAttempt || !code) return authMessage("Enter the code from your email.", "error");
    try {
      signUpAttempt = await signUpAttempt.attemptEmailAddressVerification({ code });
      if (signUpAttempt.status !== "complete" || !await activateSession(signUpAttempt.createdSessionId)) {
        throw new Error("Email verification is not complete.");
      }
      await loadSignedInDashboard(auth);
    } catch (error) {
      authMessage(identityError(error, "The verification code could not be accepted."), "error");
    }
  });

  const recovery = document.querySelector<HTMLFormElement>("#hunter-recovery-form");
  recovery?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const identifier = String(new FormData(recovery).get("email") ?? "").trim().toLowerCase();
    if (!hunterClerk?.client || !identifier) return authMessage("Enter your account email.", "error");
    try {
      signInAttempt = await hunterClerk.client.signIn.create({ strategy: "reset_password_email_code", identifier });
      const factor = signInAttempt.supportedFirstFactors?.find((item) => item.strategy === "reset_password_email_code");
      if (!factor || factor.strategy !== "reset_password_email_code") throw new Error("Email recovery is unavailable.");
      signInAttempt = await signInAttempt.prepareFirstFactor({ strategy: "reset_password_email_code", emailAddressId: factor.emailAddressId });
      showAuthForm("hunter-reset-form");
      authMessage("If that account exists, a recovery code has been emailed.", "success");
    } catch (error) {
      authMessage(identityError(error, "Password recovery could not be started."), "error");
    }
  });

  const reset = document.querySelector<HTMLFormElement>("#hunter-reset-form");
  reset?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(reset);
    const code = String(form.get("code") ?? "").trim();
    const password = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmPassword") ?? "");
    if (!signInAttempt || !code || password.length < 12 || password !== confirmation) {
      authMessage("Enter the emailed code and matching passwords of at least 12 characters.", "error");
      return;
    }
    try {
      signInAttempt = await signInAttempt.attemptFirstFactor({ strategy: "reset_password_email_code", code });
      if (signInAttempt.status === "needs_new_password") {
        signInAttempt = await signInAttempt.resetPassword({ password, signOutOfOtherSessions: true });
      }
      if (signInAttempt.status !== "complete" || !await activateSession(signInAttempt.createdSessionId)) {
        throw new Error("Password recovery is not complete.");
      }
      await loadSignedInDashboard(auth);
    } catch (error) {
      authMessage(identityError(error, "Password recovery failed."), "error");
    }
  });

  const changePassword = document.querySelector<HTMLFormElement>("#hunter-change-password-form");
  changePassword?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(changePassword);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmPassword") ?? "");
    const result = document.querySelector<HTMLElement>("[data-password-result]");
    if (!hunterClerk?.user || currentPassword.length < 12 || newPassword.length < 12 || newPassword !== confirmation) {
      if (result) result.textContent = "Enter your current password and matching new passwords of at least 12 characters.";
      return;
    }
    try {
      await hunterClerk.user.updatePassword({ currentPassword, newPassword, signOutOfOtherSessions: true });
      changePassword.reset();
      if (result) result.textContent = "Password changed. Other sessions have been revoked.";
    } catch (error) {
      if (result) result.textContent = identityError(error, "Your password could not be changed.");
    }
  });

  document.querySelector("[data-hunter-sign-out]")?.addEventListener("click", async () => {
    await hunterClerk?.signOut();
    window.location.reload();
  });
}

async function initializeDashboard(): Promise<void> {
  const config = await loadPublicConfig();
  const auth = await initializeManagedAuth(config);
  if (!auth || !hunterClerk) {
    showSignedOut("unavailable");
    authMessage("Hunter identity is not configured in this build. No password is accepted locally.", "error");
    return;
  }
  setupAccountForms(auth);
  if (!hunterClerk.user) {
    showSignedOut("signed-out");
    authMessage("Secure account access is ready.");
    return;
  }
  try {
    await loadSignedInDashboard(auth);
  } catch {
    showSignedOut("unavailable");
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
import type { Clerk } from "@clerk/clerk-js";
import type { SignInResource, SignUpResource } from "@clerk/shared/types";
