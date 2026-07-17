import { campaignHunterSession } from "./account";
import {
  prepareReportImages,
  ReportImagePreparationError,
  type PreparedReportImage,
} from "./report-image-preparation";
import {
  REPORT_IMAGE_DIRECT_BYTES,
  REPORT_IMAGE_MAX_COUNT,
  REPORT_IMAGE_TOTAL_BYTES,
  REPORT_IMAGE_TYPES,
  reportImageMegabytes,
} from "../shared/report-image-limits";
import { routeOrder, stopLabel, waypointId } from "../shared/waypoints";
import { createTurnstileLifecycle, type TurnstileResetReason } from "./turnstile-lifecycle";
import {
  isRequestedPublicAttributionKind,
  type RequestedPublicAttributionKind,
} from "../shared/publication";

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
  publicAttributionKind: RequestedPublicAttributionKind | "";
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
    | "accuracy"
    | "publicAttributionKind",
    string
  >
>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedTypes = new Set<ReportType>(["find", "tip", "safety"]);

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
  if (!isRequestedPublicAttributionKind(draft.publicAttributionKind)) {
    errors.publicAttributionKind = "Choose how this report may be credited if an operator publishes it.";
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
  if (photos.length > REPORT_IMAGE_MAX_COUNT) return "Choose no more than three images.";
  let total = 0;
  for (const photo of photos) {
    if (!REPORT_IMAGE_TYPES.has(photo.type)) {
      return "Images must be JPEG, PNG, or WebP files.";
    }
    if (photo.size > REPORT_IMAGE_DIRECT_BYTES) {
      return "Each prepared image must be 20 MB or smaller.";
    }
    total += photo.size;
  }
  if (total > REPORT_IMAGE_TOTAL_BYTES) return "Prepared images may total no more than 30 MB.";
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
    publicAttributionKind: draft.publicAttributionKind,
  };
  if (draft.phone.trim()) payload.phone = draft.phone.trim();
  const stableWaypointId = waypointId(draft.waypointId);
  if (stableWaypointId !== null) {
    payload.waypointId = String(stableWaypointId);
  }
  if (draft.coordinates) {
    payload.latitude = draft.coordinates.latitude;
    payload.longitude = draft.coordinates.longitude;
  }
  return payload;
}

export function buildReportFormData(
  draft: ReportDraft,
  photos: readonly File[] = allPhotos(draft),
): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(buildReportPayload(draft))) {
    formData.set(key, String(value));
  }
  for (const photo of photos) formData.append("images", photo, photo.name);
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
      appearance: "interaction-only";
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

export interface ReportWaypoint {
  id: string;
  routeOrder: number;
  name: string;
}

export interface ReportProfilePrefill {
  name: string;
  email: string;
}

export interface ReportSuccessModel {
  reference: string;
  heading: "Report received privately";
  message: "This report stays private unless an operator deliberately approves a public version.";
}

export interface ReportAttemptFailureState {
  idempotencyKey: string | undefined;
  turnstileToken: "";
}

export interface ReportLocationResetModel {
  buttonText: "Use my current location";
  stateText: "Location sharing is optional and starts only when you press the button.";
}

export function normalizeReportWaypoints(payload: unknown): ReportWaypoint[] {
  const data = isRecord(payload) && Object.hasOwn(payload, "data") ? payload.data : payload;
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : [];
  const byId = new Map<number, ReportWaypoint>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = waypointId(row.id);
    const order = routeOrder(row.routeOrder);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id === null || order === null || !name || byId.has(id)) continue;
    byId.set(id, { id: String(id), routeOrder: order, name });
  }
  return [...byId.values()].sort(
    (left, right) => left.routeOrder - right.routeOrder || Number(left.id) - Number(right.id),
  );
}

export function reportWaypointLabel(waypoint: ReportWaypoint): string {
  return stopLabel(waypoint.routeOrder, waypoint.name);
}

export function mergeReportWaypointChoices(
  currentChoices: readonly ReportWaypoint[],
  payload: unknown,
): ReportWaypoint[] {
  const merged = new Map<number, ReportWaypoint>();
  for (const choice of normalizeReportWaypoints(currentChoices)) {
    merged.set(Number(choice.id), choice);
  }
  for (const choice of normalizeReportWaypoints(payload)) {
    merged.set(Number(choice.id), choice);
  }
  return [...merged.values()].sort(
    (left, right) => left.routeOrder - right.routeOrder || Number(left.id) - Number(right.id),
  );
}

export function reportProfilePrefill(payload: unknown): ReportProfilePrefill {
  const profile = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  return {
    name: isRecord(profile) && typeof profile.fullName === "string" ? profile.fullName.trim() : "",
    email: isRecord(profile) && typeof profile.email === "string" ? profile.email.trim() : "",
  };
}

export function applyPrefill(currentValue: string, profileValue: string): string {
  return currentValue.length > 0 ? currentValue : profileValue;
}

export function reportSuccessModel(payload: unknown): ReportSuccessModel {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  return {
    reference: isRecord(data) && typeof data.id === "string" && data.id.trim() ? data.id.trim() : "recorded",
    heading: "Report received privately",
    message: "This report stays private unless an operator deliberately approves a public version.",
  };
}

export function buildReportRequestHeaders(idempotencyKey: string, hunterToken: string | null): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Idempotency-Key": idempotencyKey,
  });
  if (hunterToken) headers.set("Authorization", `Bearer ${hunterToken}`);
  return headers;
}

export async function waitForReportToken(
  getToken: () => Promise<string | null>,
  delay: (milliseconds: number) => Promise<void> = async (milliseconds) =>
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)),
  maxAttempts = 4,
): Promise<string | null> {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = await getToken().catch(() => null);
    if (typeof token === "string" && token.trim()) return token.trim();
    if (attempt + 1 < attempts) await delay(150);
  }
  return null;
}

export function failReportAttempt(
  idempotencyKey: string | undefined,
  resetTurnstile: () => void,
): ReportAttemptFailureState {
  try {
    resetTurnstile();
  } catch {
    // The retry remains fail-closed even when the provider widget cannot reset itself.
  }
  return { idempotencyKey, turnstileToken: "" };
}

export function reportLocationResetModel(): ReportLocationResetModel {
  return {
    buttonText: "Use my current location",
    stateText: "Location sharing is optional and starts only when you press the button.",
  };
}

export function reportErrorSelector(key: string): string {
  if (key === "turnstileToken") return "[data-turnstile]";
  if (key === "photo") return '[name="images"]';
  return `[name="${key}"]`;
}

let turnstileToken = "";
let turnstileWidgetId: string | undefined;
const reportTurnstileLifecycle = createTurnstileLifecycle();
let pendingIdempotencyKey: string | undefined;
let preparedReportPhotos: PreparedReportImage[] = [];
let photoPreparationController: AbortController | null = null;
let photoPreparationPromise: Promise<void> | null = null;
let photoPreparationError: string | undefined;

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
    if (!reportTurnstileLifecycle.beginRender("report")) return;
    state.textContent = "Human check ready.";
    turnstileWidgetId = turnstile.render(shell, {
      sitekey: config.turnstileSiteKey,
      action: "report",
      appearance: "interaction-only",
      callback: (token) => {
        turnstileToken = token;
        clearFieldError("turnstileToken");
      },
      "expired-callback": () => {
        turnstileToken = "";
        reportTurnstileLifecycle.recordReset("report", "expired");
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
  const field = document.querySelector<HTMLElement>(reportErrorSelector(key));
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
    const field = document.querySelector<HTMLElement>(reportErrorSelector(key));
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

function readDraft(
  form: HTMLFormElement,
  preparedPhotos: readonly File[] = preparedReportPhotos.map((item) => item.upload),
): ReportDraft {
  const data = new FormData(form);
  const files = [...preparedPhotos];
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
    publicAttributionKind: String(data.get("publicAttributionKind") ?? "") as ReportDraft["publicAttributionKind"],
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
    const existingChoices = Array.from(
      select.querySelectorAll<HTMLOptionElement>("option[data-report-waypoint]"),
      (option) => ({
        id: option.value,
        routeOrder: Number(option.dataset.routeOrder),
        name: option.textContent ?? "",
      }),
    );
    const refreshed = normalizeReportWaypoints(envelope);
    const waypoints = mergeReportWaypointChoices(existingChoices, envelope);
    for (const existing of select.querySelectorAll<HTMLOptionElement>("option[data-report-waypoint]")) {
      existing.remove();
    }
    const differentLocation = select.querySelector<HTMLOptionElement>('option[value="different_location"]');
    for (const item of waypoints) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = reportWaypointLabel(item);
      option.dataset.reportWaypoint = "";
      option.dataset.routeOrder = String(item.routeOrder);
      select.insertBefore(option, differentLocation);
    }
    state.textContent = refreshed.length > 0
      ? `${waypoints.length} waypoint choices available; ${refreshed.length} labels refreshed.`
      : `${waypoints.length} numbered waypoint choices remain available.`;
  } catch {
    state.textContent = "Waypoint list unavailable; describe the location instead.";
  }
}

let cachedProfilePrefill: ReportProfilePrefill | null = null;

function applyProfilePrefill(prefill: ReportProfilePrefill): void {
  const name = document.querySelector<HTMLInputElement>('[name="name"]');
  const email = document.querySelector<HTMLInputElement>('[name="email"]');
  if (name) name.value = applyPrefill(name.value, prefill.name);
  if (email) email.value = applyPrefill(email.value, prefill.email);
}

async function signedInReportToken(): Promise<string | null> {
  const session = await campaignHunterSession();
  if (!session?.clerk.user) return null;
  const token = await waitForReportToken(session.getToken);
  if (!token) throw new Error("Your Hunter sign-in is still starting. Complete the human check again and retry.");
  return token;
}

async function prefillSignedInReporter(): Promise<void> {
  try {
    const token = await signedInReportToken();
    if (!token) return;
    const response = await fetch("/api/v1/me/profile", {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return;
    cachedProfilePrefill = reportProfilePrefill(await response.json());
    applyProfilePrefill(cachedProfilePrefill);
  } catch {
    // Public reporting and Turnstile remain available when a Hunter session cannot be loaded.
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
        state.textContent = `Location captured with approximately ${Math.round(position.coords.accuracy)} metre accuracy. It stays private unless an operator later approves this report for a public update.`;
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

function renderPhotoStatuses(messages: readonly string[], kind: "normal" | "error" = "normal"): void {
  const list = document.querySelector<HTMLUListElement>("[data-report-photo-status]");
  if (!list) return;
  list.replaceChildren();
  if (kind === "error") list.dataset.kind = "error";
  else delete list.dataset.kind;
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
}

function resetPhotoPreparation(input?: HTMLInputElement | null): void {
  photoPreparationController?.abort();
  photoPreparationController = null;
  photoPreparationPromise = null;
  photoPreparationError = undefined;
  preparedReportPhotos = [];
  if (input) input.value = "";
  renderPhotoStatuses([]);
  const clear = document.querySelector<HTMLButtonElement>("[data-report-photo-clear]");
  if (clear) clear.hidden = true;
  clearFieldError("photo");
}

function initializePhotoPreparation(): void {
  const input = document.querySelector<HTMLInputElement>("[name=images]");
  const clear = document.querySelector<HTMLButtonElement>("[data-report-photo-clear]");
  const submit = document.querySelector<HTMLButtonElement>("[data-report-submit]");
  if (!input || !clear) return;

  input.addEventListener("change", () => {
    photoPreparationController?.abort();
    preparedReportPhotos = [];
    photoPreparationError = undefined;
    pendingIdempotencyKey = undefined;
    const files = Array.from(input.files ?? []);
    clear.hidden = files.length === 0;
    if (files.length === 0) {
      renderPhotoStatuses([]);
      return;
    }

    const controller = new AbortController();
    photoPreparationController = controller;
    if (submit) submit.disabled = true;
    renderPhotoStatuses(
      files.map((file) =>
        file.size > REPORT_IMAGE_DIRECT_BYTES
          ? `Optimizing ${file.name} (${reportImageMegabytes(file.size)})…`
          : `Checking ${file.name} (${reportImageMegabytes(file.size)})…`,
      ),
    );

    const current = prepareReportImages(files, { signal: controller.signal })
      .then((prepared) => {
        if (controller.signal.aborted || photoPreparationController !== controller) return;
        preparedReportPhotos = prepared;
        renderPhotoStatuses(
          prepared.map((item) =>
            item.optimized
              ? `${item.source.name}: ready — reduced from ${reportImageMegabytes(item.source.size)} to ${reportImageMegabytes(item.upload.size)}.`
              : `${item.source.name}: ready at ${reportImageMegabytes(item.upload.size)}.`,
          ),
        );
        clearFieldError("photo");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
        preparedReportPhotos = [];
        photoPreparationError = error instanceof ReportImagePreparationError
          ? error.message
          : "The selected photos could not be prepared. Choose JPEG, PNG, or WebP copies and try again.";
        renderPhotoStatuses([photoPreparationError], "error");
        const fieldError = document.querySelector<HTMLElement>('[data-error-for="photo"]');
        if (fieldError) fieldError.textContent = photoPreparationError;
        input.setAttribute("aria-invalid", "true");
      })
      .finally(() => {
        if (photoPreparationController !== controller) return;
        photoPreparationController = null;
        photoPreparationPromise = null;
        if (submit) submit.disabled = false;
      });
    photoPreparationPromise = current;
  });

  clear.addEventListener("click", () => {
    resetPhotoPreparation(input);
    pendingIdempotencyKey = undefined;
    input.focus();
  });
}

function errorCopy(responseStatus: number, code: string | undefined): string {
  if (responseStatus === 503 && code === "uploads_unavailable") {
    return "Photo storage is unavailable, so this find report was not captured. Keep your evidence and try again later.";
  }
  if (responseStatus === 429) return "Too many reports were sent from this browser. Wait a few minutes and try again.";
  if (responseStatus === 400) return "The report could not be accepted. Review the highlighted information and try again.";
  return "The report could not be confirmed as received. Keep your evidence and try again; do not assume it was captured.";
}

function resetReportTurnstile(reason: TurnstileResetReason = "submission_failed"): void {
  turnstileToken = "";
  try {
    if (window.turnstile && turnstileWidgetId) {
      window.turnstile.reset(turnstileWidgetId);
      reportTurnstileLifecycle.recordReset("report", reason);
    }
  } catch {
    stateError("The human check could not reset. Reload the page before submitting another report.");
  }
}

async function submitReport(form: HTMLFormElement): Promise<void> {
  const submit = document.querySelector<HTMLButtonElement>("[data-report-submit]");
  const result = document.querySelector<HTMLElement>("[data-report-result]");
  if (photoPreparationPromise) await photoPreparationPromise;
  const preparedFiles = preparedReportPhotos.map((item) => item.upload);
  const draft = readDraft(form, preparedFiles);
  const errors = validateReportDraft(draft);
  const photoError = validatePhotos(draft);
  if (photoError) errors.photo = photoError;
  if (photoPreparationError) errors.photo = photoPreparationError;
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  if (submit) {
    submit.disabled = true;
    submit.textContent = "Sending private report…";
  }
  if (result) result.hidden = true;
  pendingIdempotencyKey ??= crypto.randomUUID();
  const attemptIdempotencyKey = pendingIdempotencyKey;

  try {
    const photos = preparedFiles;
    const hunterToken = await signedInReportToken();
    const headers = buildReportRequestHeaders(attemptIdempotencyKey, hunterToken);
    let body: BodyInit;
    if (photos.length > 0) {
      body = buildReportFormData(draft, photos);
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(buildReportPayload(draft));
    }
    const response = await fetch("/api/v1/reports", {
      method: "POST",
      headers,
      body,
      credentials: "same-origin",
      signal: AbortSignal.timeout(120_000),
    });
    const envelope: unknown = await response.json().catch(() => null);
    const errorCode =
      isRecord(envelope) && isRecord(envelope.error) && typeof envelope.error.code === "string"
        ? envelope.error.code
        : undefined;
    if (!response.ok || !isRecord(envelope) || !isRecord(envelope.data)) {
      console.error("Private report submission rejected.", { status: response.status, errorCode });
      throw new Error(errorCopy(response.status, errorCode));
    }
    const receiptModel = reportSuccessModel(envelope);
    pendingIdempotencyKey = undefined;
    turnstileToken = "";
    const panel = document.querySelector<HTMLElement>("[data-report-form-panel]");
    const receipt = document.querySelector<HTMLElement>("[data-report-receipt]");
    const heading = receipt?.querySelector<HTMLElement>("#report-receipt-title");
    const reference = receipt?.querySelector<HTMLElement>("[data-report-reference]");
    const message = receipt?.querySelector<HTMLElement>("[data-report-receipt-message]");
    form.hidden = true;
    if (panel) panel.hidden = true;
    if (heading) heading.textContent = receiptModel.heading;
    if (reference) reference.textContent = receiptModel.reference;
    if (message) message.textContent = receiptModel.message;
    if (receipt) {
      receipt.hidden = false;
      receipt.focus();
    }
    showErrors({});
  } catch (error) {
    const failure = failReportAttempt(attemptIdempotencyKey, resetReportTurnstile);
    pendingIdempotencyKey = failure.idempotencyKey;
    turnstileToken = failure.turnstileToken;
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
  const panel = document.querySelector<HTMLElement>("[data-report-form-panel]");
  const receipt = document.querySelector<HTMLElement>("[data-report-receipt]");
  const another = document.querySelector<HTMLButtonElement>("[data-report-another]");
  initializeLocationCapture();
  initializeTypeBehavior();
  initializePhotoPreparation();
  void initializeTurnstile();
  void loadWaypointOptions();
  void prefillSignedInReporter();
  form?.addEventListener("input", () => {
    pendingIdempotencyKey = undefined;
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReport(form);
  });
  another?.addEventListener("click", () => {
    if (!form) return;
    form.reset();
    resetPhotoPreparation(form.querySelector<HTMLInputElement>("[name=images]"));
    form.hidden = false;
    if (panel) panel.hidden = false;
    if (receipt) receipt.hidden = true;
    const reference = receipt?.querySelector<HTMLElement>("[data-report-reference]");
    if (reference) reference.textContent = "";
    pendingIdempotencyKey = undefined;
    resetReportTurnstile("new_form");
    const locationReset = reportLocationResetModel();
    const locationButton = form.querySelector<HTMLButtonElement>("[data-report-use-location]");
    const locationState = form.querySelector<HTMLElement>("[data-report-location-state]");
    if (locationButton) {
      locationButton.textContent = locationReset.buttonText;
      locationButton.disabled = false;
    }
    if (locationState) locationState.textContent = locationReset.stateText;
    form.querySelector<HTMLSelectElement>('[name="type"]')?.dispatchEvent(new Event("change"));
    if (cachedProfilePrefill) applyProfilePrefill(cachedProfilePrefill);
    form.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeReport, { once: true });
  } else {
    initializeReport();
  }
}
