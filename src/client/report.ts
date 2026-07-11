export type ReportType = "find" | "tip" | "safety";

export interface ReportDraft {
  type: ReportType;
  name: string;
  email: string;
  phone: string;
  waypointId: string;
  locationDescription: string;
  details: string;
  photo: File | null;
  additionalPhotos?: readonly File[];
  turnstileToken: string;
  coordinates: null | { latitude: number; longitude: number };
  accuracy: boolean;
}

export type ReportErrors = Partial<
  Record<
    | "type"
    | "name"
    | "email"
    | "phone"
    | "locationDescription"
    | "details"
    | "photo"
    | "turnstileToken"
    | "accuracy",
    string
  >
>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedTypes = new Set<ReportType>(["find", "tip", "safety"]);
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 10 * 1024 * 1024;

export function validateReportDraft(draft: ReportDraft): ReportErrors {
  const errors: ReportErrors = {};
  if (!allowedTypes.has(draft.type)) errors.type = "Choose a report type.";
  if (!draft.name.trim()) errors.name = "Enter your name.";
  if (!emailPattern.test(draft.email.trim())) errors.email = "Enter a valid email address.";
  if (!draft.locationDescription.trim()) {
    errors.locationDescription = "Describe where this happened.";
  }
  if (!draft.details.trim()) errors.details = "Tell the review team what happened.";
  if (draft.type === "find" && draft.photo === null) {
    errors.photo = "Add a clear photo for a find claim.";
  }
  if (!draft.turnstileToken) {
    errors.turnstileToken = "Complete the human check.";
  }
  if (!draft.accuracy) {
    errors.accuracy = "Confirm that you believe the report is accurate.";
  }
  return errors;
}

function allPhotos(draft: ReportDraft): File[] {
  return [draft.photo, ...(draft.additionalPhotos ?? [])].filter(
    (file): file is File => file !== null,
  );
}

function validatePhotos(draft: ReportDraft): string | undefined {
  const photos = allPhotos(draft);
  if (photos.length > 3) return "Choose no more than three images.";
  for (const photo of photos) {
    if (!allowedImageTypes.has(photo.type)) {
      return "Images must be JPEG, PNG, or WebP files.";
    }
    if (photo.size > maxImageBytes) {
      return "Each image must be 10 MiB or smaller.";
    }
  }
  return undefined;
}

export function buildReportPayload(draft: ReportDraft): Record<string, string | number> {
  const payload: Record<string, string | number> = {
    type: draft.type,
    name: draft.name.trim(),
    email: draft.email.trim(),
    locationDescription: draft.locationDescription.trim(),
    details: draft.details.trim(),
    cfTurnstileResponse: draft.turnstileToken,
  };
  if (draft.phone.trim()) payload.phone = draft.phone.trim();
  if (draft.waypointId) payload.waypointId = draft.waypointId;
  if (draft.coordinates) {
    payload.latitude = draft.coordinates.latitude;
    payload.longitude = draft.coordinates.longitude;
  }
  return payload;
}

export function buildReportFormData(draft: ReportDraft): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(buildReportPayload(draft))) {
    formData.set(key, String(value));
  }
  for (const photo of allPhotos(draft)) formData.append("images", photo, photo.name);
  return formData;
}

interface PublicConfig {
  turnstileSiteKey: string | null;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let turnstileToken = "";
let turnstileWidgetId: string | undefined;
let pendingIdempotencyKey: string | undefined;

async function loadPublicConfig(): Promise<PublicConfig> {
  const response = await fetch("/api/v1/config", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return { turnstileSiteKey: null };
  const envelope: unknown = await response.json();
  if (!isRecord(envelope) || !isRecord(envelope.data)) return { turnstileSiteKey: null };
  return {
    turnstileSiteKey:
      typeof envelope.data.turnstileSiteKey === "string" && envelope.data.turnstileSiteKey
        ? envelope.data.turnstileSiteKey
        : null,
  };
}

async function waitForTurnstile(): Promise<TurnstileApi | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (window.turnstile) return window.turnstile;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  return null;
}

async function initializeTurnstile(): Promise<void> {
  const shell = document.querySelector<HTMLElement>("[data-turnstile]");
  const state = document.querySelector<HTMLElement>("[data-turnstile-state]");
  if (!shell || !state) return;
  try {
    const [config, turnstile] = await Promise.all([loadPublicConfig(), waitForTurnstile()]);
    if (!config.turnstileSiteKey || !turnstile) throw new Error("human check unavailable");
    state.remove();
    turnstileWidgetId = turnstile.render(shell, {
      sitekey: config.turnstileSiteKey,
      action: "report",
      callback: (token) => {
        turnstileToken = token;
        clearFieldError("turnstileToken");
      },
      "expired-callback": () => {
        turnstileToken = "";
      },
      "error-callback": () => {
        turnstileToken = "";
        stateError("The human check could not load. Refresh the page before submitting.");
      },
    });
  } catch {
    state.textContent = "Human check unavailable. Reports cannot be submitted until it is restored.";
    const submit = document.querySelector<HTMLButtonElement>("[data-report-submit]");
    if (submit) submit.disabled = true;
  }
}

function stateError(copy: string): void {
  const result = document.querySelector<HTMLElement>("[data-report-result]");
  if (!result) return;
  result.hidden = false;
  result.dataset.kind = "error";
  result.textContent = copy;
}

function clearFieldError(key: string): void {
  const error = document.querySelector<HTMLElement>(`[data-error-for="${key}"]`);
  if (error) error.textContent = "";
  const fieldName = key === "photo" ? "images" : key;
  const field = document.querySelector<HTMLElement>(`[name="${fieldName}"]`);
  field?.removeAttribute("aria-invalid");
}

function showErrors(errors: ReportErrors): void {
  const summary = document.querySelector<HTMLElement>("[data-report-errors]");
  for (const key of [
    "type",
    "name",
    "email",
    "phone",
    "locationDescription",
    "details",
    "photo",
    "turnstileToken",
    "accuracy",
  ] as const) {
    const copy = errors[key] ?? "";
    const error = document.querySelector<HTMLElement>(`[data-error-for="${key}"]`);
    if (error) error.textContent = copy;
    const fieldName = key === "photo" ? "images" : key;
    const field = document.querySelector<HTMLElement>(`[name="${fieldName}"]`);
    if (copy) field?.setAttribute("aria-invalid", "true");
    else field?.removeAttribute("aria-invalid");
  }
  const messages = Object.values(errors);
  if (!summary) return;
  if (messages.length === 0) {
    summary.hidden = true;
    summary.textContent = "";
    return;
  }
  summary.hidden = false;
  summary.dataset.kind = "error";
  summary.textContent = `Fix ${messages.length} ${messages.length === 1 ? "problem" : "problems"}: ${messages.join(" ")}`;
  const firstInvalid = document.querySelector<HTMLElement>("[aria-invalid=true]");
  firstInvalid?.focus();
}

function readDraft(form: HTMLFormElement): ReportDraft {
  const data = new FormData(form);
  const files = Array.from(form.querySelector<HTMLInputElement>("[name=images]")?.files ?? []);
  const latitude = Number(data.get("latitude"));
  const longitude = Number(data.get("longitude"));
  const hasCoordinates =
    data.get("latitude") !== "" &&
    data.get("longitude") !== "" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);
  const firstPhoto = files[0] ?? null;
  return {
    type: String(data.get("type") ?? "") as ReportType,
    name: String(data.get("name") ?? ""),
    email: String(data.get("email") ?? ""),
    phone: String(data.get("phone") ?? ""),
    waypointId: String(data.get("waypointId") ?? ""),
    locationDescription: String(data.get("locationDescription") ?? ""),
    details: String(data.get("details") ?? ""),
    photo: firstPhoto,
    additionalPhotos: files.slice(1),
    turnstileToken,
    coordinates: hasCoordinates ? { latitude, longitude } : null,
    accuracy: data.get("accuracy") === "on",
  };
}

async function loadWaypointOptions(): Promise<void> {
  const select = document.querySelector("[name=waypointId]") as HTMLSelectElement | null;
  const state = document.querySelector<HTMLElement>("[data-waypoint-load-state]");
  if (!select || !state) return;
  try {
    const response = await fetch("/api/v1/waypoints", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("waypoints unavailable");
    const envelope: unknown = await response.json();
    if (!isRecord(envelope)) throw new Error("waypoints unavailable");
    const items = Array.isArray(envelope.data)
      ? envelope.data
      : isRecord(envelope.data) && Array.isArray(envelope.data.items)
        ? envelope.data.items
        : [];
    for (const item of items) {
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") continue;
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    }
    state.textContent = items.length > 0 ? `${items.length} public waypoints available.` : "No waypoint list is currently available.";
  } catch {
    state.textContent = "Waypoint list unavailable; describe the location instead.";
  }
}

function initializeLocationCapture(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-report-use-location]");
  const state = document.querySelector<HTMLElement>("[data-report-location-state]");
  const latitude = document.querySelector<HTMLInputElement>("[data-report-latitude]");
  const longitude = document.querySelector<HTMLInputElement>("[data-report-longitude]");
  if (!button || !state || !latitude || !longitude) return;
  button.addEventListener("click", () => {
    if (!navigator.geolocation) {
      state.textContent = "This browser cannot share a location. Describe it in words instead.";
      return;
    }
    button.disabled = true;
    state.textContent = "Requesting your location…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        latitude.value = String(position.coords.latitude);
        longitude.value = String(position.coords.longitude);
        state.textContent = `Location captured with approximately ${Math.round(position.coords.accuracy)} metre accuracy. It will remain private.`;
        button.textContent = "Update my current location";
        button.disabled = false;
        pendingIdempotencyKey = undefined;
      },
      () => {
        latitude.value = "";
        longitude.value = "";
        state.textContent = "Location was not shared. Describe it in words instead.";
        button.disabled = false;
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  });
}

function initializeTypeBehavior(): void {
  const type = document.querySelector("[name=type]") as HTMLSelectElement | null;
  const photo = document.querySelector<HTMLInputElement>("[name=images]");
  const copy = document.querySelector<HTMLElement>("[data-photo-required-copy]");
  if (!type || !photo || !copy) return;
  const update = (): void => {
    const required = type.value === "find";
    photo.required = required;
    copy.textContent = required ? "(required for a find)" : "(optional)";
  };
  type.addEventListener("change", update);
  update();
}

function errorCopy(responseStatus: number, code: string | undefined): string {
  if (responseStatus === 503 && code === "uploads_unavailable") {
    return "Photo storage is unavailable, so this find report was not captured. Keep your evidence and try again later.";
  }
  if (responseStatus === 429) return "Too many reports were sent from this browser. Wait a few minutes and try again.";
  if (responseStatus === 400) return "The report could not be accepted. Review the highlighted information and try again.";
  return "The report could not be confirmed as received. Keep your evidence and try again; do not assume it was captured.";
}

async function submitReport(form: HTMLFormElement): Promise<void> {
  const submit = document.querySelector<HTMLButtonElement>("[data-report-submit]");
  const result = document.querySelector<HTMLElement>("[data-report-result]");
  const draft = readDraft(form);
  const errors = validateReportDraft(draft);
  const photoError = validatePhotos(draft);
  if (photoError) errors.photo = photoError;
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  if (submit) {
    submit.disabled = true;
    submit.textContent = "Sending private report…";
  }
  if (result) result.hidden = true;
  pendingIdempotencyKey ??= crypto.randomUUID();

  try {
    const photos = allPhotos(draft);
    const headers = new Headers({
      Accept: "application/json",
      "Idempotency-Key": pendingIdempotencyKey,
    });
    let body: BodyInit;
    if (photos.length > 0) {
      body = buildReportFormData(draft);
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(buildReportPayload(draft));
    }
    const response = await fetch("/api/v1/reports", {
      method: "POST",
      headers,
      body,
      credentials: "same-origin",
      signal: AbortSignal.timeout(30_000),
    });
    const envelope: unknown = await response.json().catch(() => null);
    const errorCode =
      isRecord(envelope) && isRecord(envelope.error) && typeof envelope.error.code === "string"
        ? envelope.error.code
        : undefined;
    if (!response.ok || !isRecord(envelope) || !isRecord(envelope.data)) {
      throw new Error(errorCopy(response.status, errorCode));
    }
    const reportId = typeof envelope.data.id === "string" ? envelope.data.id : "recorded";
    form.reset();
    pendingIdempotencyKey = undefined;
    turnstileToken = "";
    if (window.turnstile && turnstileWidgetId) window.turnstile.reset(turnstileWidgetId);
    if (result) {
      result.hidden = false;
      result.dataset.kind = "success";
      result.textContent = `Report ${reportId} was received privately. Keep that reference for follow-up.`;
      result.focus();
    }
    showErrors({});
  } catch (error) {
    stateError(error instanceof Error ? error.message : errorCopy(0, undefined));
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Send private report";
    }
  }
}

function initializeReport(): void {
  const form = document.querySelector<HTMLFormElement>("[data-report-form]");
  initializeLocationCapture();
  initializeTypeBehavior();
  void initializeTurnstile();
  void loadWaypointOptions();
  form?.addEventListener("input", () => {
    pendingIdempotencyKey = undefined;
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReport(form);
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeReport, { once: true });
  } else {
    initializeReport();
  }
}
