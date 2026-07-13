export type SponsorSupportType = "community" | "lead" | "prize_in_kind" | "other";
export type SponsorContributionRange =
  | ""
  | "not_sure"
  | "under_1000"
  | "1000_2499"
  | "2500_4999"
  | "5000_plus"
  | "prefer_to_discuss";

export interface SponsorDraft {
  contactName: string;
  organization: string;
  email: string;
  phone: string;
  supportType: SponsorSupportType;
  contributionRange: SponsorContributionRange;
  desiredOutcome: string;
  acknowledgementAccepted: boolean;
  acknowledgementVersion: string;
  turnstileToken: string;
}

type SponsorErrorKey =
  | "contactName"
  | "organization"
  | "email"
  | "phone"
  | "supportType"
  | "contributionRange"
  | "desiredOutcome"
  | "acknowledgementAccepted"
  | "acknowledgementVersion"
  | "turnstileToken";

export type SponsorErrors = Partial<Record<SponsorErrorKey, string>>;

interface SponsorPayload {
  contactName: string;
  organization: string;
  email: string;
  phone?: string;
  supportType: SponsorSupportType;
  contributionRange?: Exclude<SponsorContributionRange, "">;
  desiredOutcome: string;
  acknowledgementAccepted: true;
  acknowledgementVersion: string;
  cfTurnstileResponse: string;
}

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const activeAcknowledgementVersion = "2026.1";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const supportTypes = new Set<SponsorSupportType>([
  "community",
  "lead",
  "prize_in_kind",
  "other",
]);
const contributionRanges = new Set<SponsorContributionRange>([
  "",
  "not_sure",
  "under_1000",
  "1000_2499",
  "2500_4999",
  "5000_plus",
  "prefer_to_discuss",
]);
const errorKeys: readonly SponsorErrorKey[] = [
  "contactName",
  "organization",
  "email",
  "phone",
  "supportType",
  "contributionRange",
  "desiredOutcome",
  "acknowledgementAccepted",
  "acknowledgementVersion",
  "turnstileToken",
];
const fieldSelectors: Record<SponsorErrorKey, string> = {
  contactName: '[name="contactName"]',
  organization: '[name="organization"]',
  email: '[name="email"]',
  phone: '[name="phone"]',
  supportType: '[name="supportType"]',
  contributionRange: '[name="contributionRange"]',
  desiredOutcome: '[name="desiredOutcome"]',
  acknowledgementAccepted: '[name="acknowledgementAccepted"]',
  acknowledgementVersion: '[name="acknowledgementAccepted"]',
  turnstileToken: "[data-sponsor-turnstile]",
};
const errorSelectors: Record<SponsorErrorKey, string> = {
  contactName: '[data-error-for="contactName"]',
  organization: '[data-error-for="organization"]',
  email: '[data-error-for="email"]',
  phone: '[data-error-for="phone"]',
  supportType: '[data-error-for="supportType"]',
  contributionRange: '[data-error-for="contributionRange"]',
  desiredOutcome: '[data-error-for="desiredOutcome"]',
  acknowledgementAccepted: '[data-error-for="acknowledgementAccepted"]',
  acknowledgementVersion: '[data-error-for="acknowledgementVersion"]',
  turnstileToken: '[data-error-for="turnstileToken"]',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function validateSponsorDraft(draft: SponsorDraft): SponsorErrors {
  const errors: SponsorErrors = {};
  const contactName = draft.contactName.trim();
  const organization = draft.organization.trim();
  const normalizedEmail = draft.email.trim();
  const phone = draft.phone.trim();
  const desiredOutcome = draft.desiredOutcome.trim();

  if (contactName.length < 1 || contactName.length > 100) {
    errors.contactName = "Enter a contact name of no more than 100 characters.";
  }
  if (organization.length < 1 || organization.length > 160) {
    errors.organization = "Enter an organization of no more than 160 characters.";
  }
  if (normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (phone.length > 40) {
    errors.phone = "Enter a phone number of no more than 40 characters.";
  }
  if (!supportTypes.has(draft.supportType)) {
    errors.supportType = "Choose a support type.";
  }
  if (!contributionRanges.has(draft.contributionRange)) {
    errors.contributionRange = "Choose a valid contribution range.";
  }
  if (desiredOutcome.length < 10 || desiredOutcome.length > 3_000) {
    errors.desiredOutcome = "Describe the desired outcome in 10 to 3000 characters.";
  }
  if (!draft.acknowledgementAccepted) {
    errors.acknowledgementAccepted = "Read and accept the privacy acknowledgement.";
  }
  if (draft.acknowledgementVersion !== activeAcknowledgementVersion) {
    errors.acknowledgementVersion = "Reload this page to review the current privacy acknowledgement.";
  }
  if (!draft.turnstileToken.trim()) {
    errors.turnstileToken = "Complete the human check.";
  }
  return errors;
}

export function buildSponsorPayload(draft: SponsorDraft): SponsorPayload {
  const payload: SponsorPayload = {
    contactName: draft.contactName.trim(),
    organization: draft.organization.trim(),
    email: draft.email.trim().toLowerCase(),
    supportType: draft.supportType,
    desiredOutcome: draft.desiredOutcome.trim(),
    acknowledgementAccepted: true,
    acknowledgementVersion: activeAcknowledgementVersion,
    cfTurnstileResponse: draft.turnstileToken.trim(),
  };
  const phone = draft.phone.trim();
  if (phone) payload.phone = phone;
  if (draft.contributionRange) payload.contributionRange = draft.contributionRange;
  return payload;
}

export function parseSponsorReceipt(envelope: unknown): { referenceCode: string } | null {
  if (!isRecord(envelope) || !isRecord(envelope.data)) return null;
  const referenceCode = envelope.data.referenceCode;
  if (envelope.data.state !== "received" || typeof referenceCode !== "string") return null;
  if (!/^SP-[A-Z0-9]{8}$/.test(referenceCode)) return null;
  return { referenceCode };
}

export function sponsorErrorCopy(status: number, code?: string): string {
  if (status === 409 && code === "privacy_version_outdated") {
    return "The privacy acknowledgement changed. Review the current Privacy page, reload, and try again.";
  }
  if (status === 413) return "This form is too large. Shorten your message and try again.";
  if (status === 415) return "This request format is unsupported. Reload the page and try again.";
  if (status === 422) return "Review the highlighted fields and try again.";
  if (status === 429) return "Too many inquiries were attempted. Wait a few minutes and retry.";
  if (status === 503) return "Sponsor inquiries are temporarily unavailable. Keep your details and try again later.";
  return "Your inquiry was not confirmed as received. Retry with the same details; do not assume it was captured.";
}

interface PublicConfig {
  turnstileSiteKey: string | null;
}

let turnstileToken = "";
let turnstileWidgetId: string | undefined;
let pendingIdempotencyKey: string | undefined;
let turnstileUnavailable = false;

async function loadPublicConfig(): Promise<PublicConfig> {
  try {
    const response = await fetch("/api/v1/config", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { turnstileSiteKey: null };
    const envelope: unknown = await response.json().catch(() => null);
    if (!isRecord(envelope) || !isRecord(envelope.data)) return { turnstileSiteKey: null };
    const siteKey = envelope.data.turnstileSiteKey;
    return {
      turnstileSiteKey:
        typeof siteKey === "string" && siteKey.trim().length > 0 ? siteKey.trim() : null,
    };
  } catch {
    return { turnstileSiteKey: null };
  }
}

async function waitForTurnstile(): Promise<TurnstileApi | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (window.turnstile) return window.turnstile;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  return null;
}

function resultState(copy: string, kind: "error" | "success"): void {
  const result = document.querySelector<HTMLElement>("[data-sponsor-result]");
  if (!result) return;
  result.hidden = false;
  result.dataset.kind = kind;
  result.setAttribute("role", kind === "success" ? "status" : "alert");
  result.textContent = copy;
  if (kind === "success") {
    if (!result.hasAttribute("tabindex")) result.tabIndex = -1;
    result.focus();
  }
}

function fieldFor(key: SponsorErrorKey): HTMLElement | null {
  return document.querySelector<HTMLElement>(fieldSelectors[key]);
}

function clearFieldError(key: SponsorErrorKey): void {
  const error = document.querySelector<HTMLElement>(errorSelectors[key]);
  if (error) error.textContent = "";
  fieldFor(key)?.removeAttribute("aria-invalid");
}

function setTurnstileError(copy: string): void {
  const shell = fieldFor("turnstileToken");
  const error = document.querySelector<HTMLElement>(errorSelectors.turnstileToken);
  if (error) error.textContent = copy;
  if (shell) {
    shell.setAttribute("aria-invalid", "true");
    if (!shell.hasAttribute("tabindex")) shell.tabIndex = -1;
  }
}

function showErrors(errors: SponsorErrors): void {
  let firstInvalid: HTMLElement | null = null;
  for (const key of errorKeys) {
    const copy = errors[key] ?? "";
    const error = document.querySelector<HTMLElement>(errorSelectors[key]);
    if (error) error.textContent = copy;
    const field = fieldFor(key);
    if (copy) {
      field?.setAttribute("aria-invalid", "true");
      firstInvalid ??= field;
    } else if (
      !(key === "acknowledgementAccepted" && errors.acknowledgementVersion) &&
      !(key === "acknowledgementVersion" && errors.acknowledgementAccepted)
    ) {
      field?.removeAttribute("aria-invalid");
    }
  }

  const messages = errorKeys.flatMap((key) => errors[key] ? [errors[key]] : []);
  const summary = document.querySelector<HTMLElement>("[data-sponsor-errors]");
  if (summary) {
    summary.setAttribute("role", "alert");
    summary.hidden = messages.length === 0;
    summary.textContent = messages.length === 0
      ? ""
      : `Fix ${messages.length} ${messages.length === 1 ? "problem" : "problems"}: ${messages.join(" ")}`;
  }
  firstInvalid?.focus();
}

function readDraft(form: HTMLFormElement): SponsorDraft {
  const data = new FormData(form);
  return {
    contactName: String(data.get("contactName") ?? ""),
    organization: String(data.get("organization") ?? ""),
    email: String(data.get("email") ?? ""),
    phone: String(data.get("phone") ?? ""),
    supportType: String(data.get("supportType") ?? "") as SponsorSupportType,
    contributionRange: String(data.get("contributionRange") ?? "") as SponsorContributionRange,
    desiredOutcome: String(data.get("desiredOutcome") ?? ""),
    acknowledgementAccepted: data.get("acknowledgementAccepted") !== null,
    acknowledgementVersion: String(data.get("acknowledgementVersion") ?? ""),
    turnstileToken,
  };
}

function responseErrorCode(envelope: unknown): string | undefined {
  if (!isRecord(envelope) || !isRecord(envelope.error)) return undefined;
  return typeof envelope.error.code === "string" ? envelope.error.code : undefined;
}

function resetTurnstile(): void {
  turnstileToken = "";
  if (window.turnstile && turnstileWidgetId) window.turnstile.reset(turnstileWidgetId);
}

function disableSponsorSubmission(copy: string): void {
  turnstileUnavailable = true;
  const submit = document.querySelector<HTMLButtonElement>("[data-sponsor-submit]");
  if (submit) submit.disabled = true;
  const shell = document.querySelector<HTMLElement>("[data-sponsor-turnstile]");
  if (shell) {
    shell.textContent = copy;
    shell.setAttribute("aria-invalid", "true");
  }
  setTurnstileError(copy);
}

async function initializeTurnstile(): Promise<void> {
  const shell = document.querySelector<HTMLElement>("[data-sponsor-turnstile]");
  if (!shell) return;
  try {
    const [config, turnstile] = await Promise.all([loadPublicConfig(), waitForTurnstile()]);
    if (!config.turnstileSiteKey || !turnstile) throw new Error("human verification unavailable");

    turnstileWidgetId = turnstile.render(shell, {
      sitekey: config.turnstileSiteKey,
      action: "sponsor_inquiry",
      callback: (token) => {
        turnstileToken = token;
        turnstileUnavailable = false;
        const submit = document.querySelector<HTMLButtonElement>("[data-sponsor-submit]");
        if (submit) submit.disabled = false;
        clearFieldError("turnstileToken");
      },
      "expired-callback": () => {
        turnstileToken = "";
        setTurnstileError("The human check expired. Complete it again.");
      },
      "error-callback": () => {
        turnstileToken = "";
        disableSponsorSubmission(
          "Human verification is unavailable. Reload the page before submitting an inquiry.",
        );
      },
    });
  } catch {
    disableSponsorSubmission(
      "Human verification is unavailable. Sponsor inquiries cannot be submitted until it is restored.",
    );
  }
}

async function submitSponsor(form: HTMLFormElement): Promise<void> {
  const submit = document.querySelector<HTMLButtonElement>("[data-sponsor-submit]");
  const originalLabel = submit?.textContent ?? "";
  const draft = readDraft(form);
  const errors = validateSponsorDraft(draft);
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  pendingIdempotencyKey ??= crypto.randomUUID();
  const requestKey = pendingIdempotencyKey;
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Sending private inquiry…";
  }
  const result = document.querySelector<HTMLElement>("[data-sponsor-result]");
  if (result) result.hidden = true;

  try {
    const response = await fetch("/api/v1/sponsors/inquiries", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": requestKey,
      },
      body: JSON.stringify(buildSponsorPayload(draft)),
      credentials: "same-origin",
      signal: AbortSignal.timeout(20_000),
    });
    const envelope: unknown = await response.json().catch(() => null);
    const receipt = response.ok ? parseSponsorReceipt(envelope) : null;
    if (!receipt) {
      resultState(sponsorErrorCopy(response.status, responseErrorCode(envelope)), "error");
      return;
    }

    form.reset();
    pendingIdempotencyKey = undefined;
    showErrors({});
    resultState(
      `Inquiry ${receipt.referenceCode} was received privately. Submission does not create a sponsorship agreement.`,
      "success",
    );
  } catch {
    resultState(sponsorErrorCopy(0), "error");
  } finally {
    resetTurnstile();
    if (submit) {
      submit.disabled = turnstileUnavailable;
      submit.textContent = originalLabel;
    }
  }
}

function initializeSponsor(): void {
  const form = document.querySelector<HTMLFormElement>("[data-sponsor-form]");
  if (!form) return;

  void initializeTurnstile();
  form.addEventListener("input", () => {
    if (pendingIdempotencyKey) pendingIdempotencyKey = undefined;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitSponsor(form);
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeSponsor, { once: true });
  } else {
    initializeSponsor();
  }
}
