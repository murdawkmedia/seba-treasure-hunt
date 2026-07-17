import { routeOrder, stopLabel, waypointId as parseWaypointId } from "../shared/waypoints";
import { initializeApprovedMediaViewer, renderApprovedMedia } from "./approved-media-viewer";
import {
  prepareReportImages,
  ReportImagePreparationError,
  type PreparedReportImage,
} from "./report-image-preparation";
import {
  REPORT_IMAGE_DIRECT_BYTES,
  REPORT_IMAGE_MAX_COUNT,
  reportImageMegabytes,
} from "../shared/report-image-limits";
import { createTurnstileLifecycle } from "./turnstile-lifecycle";

export interface CommunityMedia {
  id: string;
  url: string;
  alt?: string;
}

export interface CommunityReply {
  id: string;
  body: string;
  authorHandle: string;
  createdAt: string;
}

export interface CommunityNote {
  id: string;
  noteKind: "community" | "operator_reviewed";
  waypointId: string;
  waypointRouteOrder: number | null;
  waypointName: string | null;
  body: string;
  authorHandle: string;
  createdAt: string;
  latitude: number | null;
  longitude: number | null;
  media: CommunityMedia[];
  replies: CommunityReply[];
}

export type BoardViewState =
  | { kind: "loading" }
  | { kind: "unavailable"; detail: string }
  | { kind: "ready"; notes: CommunityNote[]; canReply: boolean };

interface TimLostAuthHook {
  getToken(): Promise<string | null>;
}

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: "field_note" | "reply" | "flag";
    appearance: "interaction-only";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }): string;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    timLostAuth?: TimLostAuthHook;
  }
}

const communityDisclaimer = "Community observation&mdash;not an official clue.";
let turnstileSiteKey: string | null = null;
let turnstileApi: TurnstileApi | null = null;
let noteTurnstileToken = "";
let noteTurnstileWidget: string | undefined;
let flagTurnstileToken = "";
let flagTurnstileWidget: string | undefined;
const replyTurnstileTokens = new Map<string, string>();
const replyTurnstileWidgets = new Map<string, string>();
const boardTurnstileLifecycle = createTurnstileLifecycle();
let pendingNoteIdempotencyKey: string | undefined;

export function caseNoteReceipt(reference: string): string {
  return `Received for moderation. Reference ${reference}. Nothing is public until an operator approves it.`;
}

export function buildCaseNoteRequestHeaders(idempotencyKey: string, humanToken: string): Headers {
  return new Headers({
    "Idempotency-Key": idempotencyKey,
    "CF-Turnstile-Response": humanToken
  });
}

export function failCaseNoteAttempt(idempotencyKey: string | undefined): {
  idempotencyKey: string | undefined;
  turnstileToken: "";
} {
  return { idempotencyKey, turnstileToken: "" };
}

export function buildCaseNoteFormData(
  form: HTMLFormElement,
  prepared: readonly PreparedReportImage[],
): FormData {
  const data = new FormData(form);
  data.delete("images");
  for (const item of prepared) data.append("images", item.upload, item.upload.name);
  return data;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function waypointNumber(value: unknown): number | null {
  const match = String(value ?? "").match(/(?:^|[^0-9])0?(1[0-3]|[1-9])$/);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function waypointLabel(note: Pick<CommunityNote, "waypointId" | "waypointRouteOrder" | "waypointName">): string {
  if (note.waypointRouteOrder !== null && note.waypointName) {
    return stopLabel(note.waypointRouteOrder, note.waypointName);
  }
  return waypointNumber(note.waypointId) === null ? "Stop not specified" : "Stop details unavailable";
}

function coordinate(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function safeMediaUrl(value: unknown): string | null {
  const url = asString(value);
  if (/^\/api\/v1\/media\/[A-Za-z0-9_-]+(?:\?.*)?$/.test(url)) return url;
  if (/^\/assets\/community\/[A-Za-z0-9_./-]+$/.test(url) && !url.includes("..")) return url;
  return null;
}

function normalizeReply(value: unknown): CommunityReply | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const body = asString(value.body);
  const authorHandle = asString(value.authorHandle);
  const createdAt = asString(value.createdAt);
  if (!id || !body || !authorHandle || !createdAt) return null;
  return { id, body, authorHandle, createdAt };
}

function normalizeMedia(value: unknown): CommunityMedia | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const url = safeMediaUrl(value.url);
  if (!id || !url) return null;
  const alt = asString(value.alt);
  return alt ? { id, url, alt } : { id, url };
}

function normalizeNote(value: unknown): CommunityNote | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const waypointId = typeof value.waypointId === "number" ? String(value.waypointId) : asString(value.waypointId);
  const body = asString(value.body);
  const authorHandle = asString(value.authorHandle);
  const createdAt = asString(value.createdAt);
  if (!id || waypointNumber(waypointId) === null || !body || !authorHandle || !createdAt) return null;
  const order = routeOrder(value.waypointRouteOrder);
  const name = asString(value.waypointName).trim();
  return {
    id,
    noteKind: value.noteKind === "operator_reviewed" ? "operator_reviewed" : "community",
    waypointId,
    waypointRouteOrder: order !== null && name ? order : null,
    waypointName: order !== null && name ? name : null,
    body,
    authorHandle,
    createdAt,
    latitude: coordinate(value.latitude, -90, 90),
    longitude: coordinate(value.longitude, -180, 180),
    media: asArray(value.media).map(normalizeMedia).filter((item): item is CommunityMedia => item !== null),
    replies: asArray(value.replies).map(normalizeReply).filter((item): item is CommunityReply => item !== null),
  };
}

export function normalizeBoardPayload(payload: unknown): CommunityNote[] {
  const envelopeData = isRecord(payload) && "data" in payload ? payload.data : payload;
  const records = Array.isArray(envelopeData)
    ? envelopeData
    : isRecord(envelopeData)
      ? asArray(envelopeData.items ?? envelopeData.notes)
      : [];
  return records.map(normalizeNote).filter((item): item is CommunityNote => item !== null);
}

export function normalizeBoardWaypointFilter(value: unknown): string {
  const candidate = asString(value).trim();
  return candidate === "all" || /^(?:[1-9]|1[0-3])$/.test(candidate) ? candidate : "all";
}

export function formatBoardTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Edmonton",
  }).format(date);
}

export function validateReply(body: string): string | null {
  const value = body.trim();
  if (!value) return "Write a reply before sending it.";
  if (value.length > 500) return "Replies must be 500 characters or fewer.";
  if (/<[^>]+>|\[[^\]]+\]\([^)]+\)/.test(value)) return "Replies must be plain text.";
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(value)) return "Links are not allowed in replies.";
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return "Contact details are not allowed in replies.";
  if (/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(value)) return "Contact details are not allowed in replies.";
  if (/-?\d{2,3}\.\d{4,}\s*[,/]\s*-?\d{2,3}\.\d{4,}/.test(value)) return "Exact coordinates are not allowed in replies.";
  return null;
}

export function validateFieldNote(waypointId: string, body: string, files: readonly File[]): string[] {
  const errors: string[] = [];
  if (parseWaypointId(waypointId) === null) errors.push("Choose one of the 13 waypoints.");
  const note = body.trim();
  if (!note) errors.push("Describe what you observed.");
  if (note.length > 1200) errors.push("Case Notes must be 1,200 characters or fewer.");
  if (files.length > REPORT_IMAGE_MAX_COUNT) errors.push("Choose no more than 3 images.");
  return errors;
}

function renderMedia(media: CommunityMedia[], handle: string): string {
  if (media.length === 0) return "";
  return `<div class="field-note__media" data-media-gallery data-media-gallery-title="Case Note images shared by ${escapeHtml(handle)}">${media
    .map((item) => {
      const alt = item.alt || `Case Note image shared by ${handle}`;
      return renderApprovedMedia({ href: item.url, src: item.url, alt, caption: alt });
    })
    .join("")}</div>`;
}

function renderReplies(note: CommunityNote, canReply: boolean): string {
  const replies = note.replies
    .map((reply) => `<article class="field-reply" data-reply-id="${escapeHtml(reply.id)}">
      <div class="field-reply__meta"><strong>${escapeHtml(reply.authorHandle)}</strong><time datetime="${escapeHtml(reply.createdAt)}">${escapeHtml(formatBoardTime(reply.createdAt))}</time></div>
      <p>${escapeHtml(reply.body)}</p>
      <button class="note-action" type="button" data-flag-kind="reply" data-flag-id="${escapeHtml(reply.id)}" aria-label="Report reply by ${escapeHtml(reply.authorHandle)} for review">Report reply for review</button>
    </article>`)
    .join("");
  const replyForm = canReply
    ? `<form class="reply-form" data-note-id="${escapeHtml(note.id)}" novalidate>
        <label for="reply-${escapeHtml(note.id)}">Add a short, plain-text reply</label>
        <textarea id="reply-${escapeHtml(note.id)}" name="body" maxlength="500" rows="2" required></textarea>
        <div class="turnstile-slot" data-reply-turnstile data-note-id="${escapeHtml(note.id)}" aria-label="Human verification"><span>Preparing the human check&hellip;</span></div>
        <button class="note-action" type="submit" disabled>Post reply</button>
        <p class="form-result" role="status" aria-live="polite"></p>
      </form>`
    : "";
  if (!replies && !replyForm) return "";
  return `<div class="field-note__replies">${replies}${replyForm}</div>`;
}

function renderNote(note: CommunityNote, canReply: boolean): string {
  const operatorReviewed = note.noteKind === "operator_reviewed";
  const location = operatorReviewed && note.latitude !== null && note.longitude !== null
    ? `<p class="field-note__location"><strong>Approved GPS:</strong> ${escapeHtml(note.latitude)}, ${escapeHtml(note.longitude)}</p>`
    : "";
  const notice = operatorReviewed
    ? "Operator-reviewed Case Note&mdash;not an official clue."
    : communityDisclaimer;
  return `<article class="field-note" data-note-id="${escapeHtml(note.id)}">
    <header class="field-note__head">
      <div><p class="field-note__waypoint">${escapeHtml(waypointLabel(note))}</p><p class="field-note__author"><strong>${escapeHtml(note.authorHandle)}</strong></p></div>
      <time datetime="${escapeHtml(note.createdAt)}">${escapeHtml(formatBoardTime(note.createdAt))}</time>
    </header>
    <div class="field-note__body">${escapeHtml(note.body)}</div>
    ${location}
    ${renderMedia(note.media, note.authorHandle)}
    <p class="field-note__notice">${notice}</p>
    <div class="field-note__actions"><button class="note-action" type="button" data-flag-kind="note" data-flag-id="${escapeHtml(note.id)}" aria-label="Report Case Note by ${escapeHtml(note.authorHandle)} for review">Report Case Note for review</button></div>
    ${renderReplies(note, canReply && !operatorReviewed)}
  </article>`;
}

export function renderBoardFeed(state: BoardViewState): string {
  if (state.kind === "loading") {
    return `<div class="board-state board-state--loading"><span class="board-state__spinner" aria-hidden="true"></span><h3>Opening the field ledger</h3><p>Checking for moderator-approved observations.</p></div>`;
  }
  if (state.kind === "unavailable") {
    return `<div class="board-state board-state--unavailable"><h3>Board unavailable</h3><p>${escapeHtml(state.detail)}</p><p>Your private report can still be sent from the report page.</p></div>`;
  }
  if (state.notes.length === 0) {
    return `<div class="board-state board-state--empty"><h3>No approved Case Notes here yet</h3><p>Try another waypoint or return after moderators have reviewed new observations.</p></div>`;
  }
  return state.notes.map((note) => renderNote(note, state.canReply)).join("");
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : payload;
  return asString(error.message) || fallback;
}

export function replyFailureMessage(response: Response, payload: unknown): string {
  if (response.status !== 429) return errorMessage(payload, "Your reply could not be posted.");
  const retryAfter = Number(response.headers.get("retry-after"));
  const boundedSeconds = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter, 600)
    : 600;
  const minutes = Math.max(1, Math.ceil(boundedSeconds / 60));
  return `You've reached the reply limit. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

async function authHeaders(base?: HeadersInit): Promise<Headers> {
  const headers = new Headers(base);
  const token = await window.timLostAuth?.getToken().catch(() => null);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function requestJson(url: string, init: RequestInit = {}): Promise<{ response: Response; payload: unknown }> {
  const headers = await authHeaders(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const payload: unknown = await response.json().catch(() => null);
  return { response, payload };
}

async function bootstrapRuntime(): Promise<void> {
  try {
    const response = await fetch("/api/v1/config", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const payload: unknown = await response.json();
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    if (!isRecord(data)) return;
    turnstileSiteKey = asString(data.turnstileSiteKey) || null;
    const publishableKey = asString(data.hunterPublishableKey);
    if (!publishableKey || window.timLostAuth) return;
    const { Clerk } = await import("@clerk/clerk-js");
    const clerk = new Clerk(publishableKey);
    await clerk.load();
    window.timLostAuth = {
      getToken: async () => clerk.session?.getToken() ?? null,
    };
  } catch {
    // Reading is public. Authentication and human-checked writes fail closed below.
  }
}

async function waitForTurnstile(): Promise<TurnstileApi | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const available = (window as Window & { turnstile?: TurnstileApi }).turnstile;
    if (available) return available;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  return null;
}

function nextCursor(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.page)) return null;
  const value = payload.page.nextCursor;
  return typeof value === "string" && value ? value : null;
}

export async function initialiseBoard(): Promise<void> {
  const feed = document.querySelector<HTMLElement>("#board-feed");
  const status = document.querySelector<HTMLElement>("#board-status");
  const filter = document.querySelector<HTMLSelectElement>("#waypoint-filter");
  const more = document.querySelector<HTMLButtonElement>("#board-more");
  const noteForm = document.querySelector<HTMLFormElement>("#field-note-form");
  const authPrompt = document.querySelector<HTMLElement>("#board-auth-prompt");
  const flagDialog = document.querySelector<HTMLDialogElement>("#board-flag-dialog");
  const flagForm = document.querySelector<HTMLFormElement>("#board-flag-form");
  const noteReceipt = document.querySelector<HTMLElement>("[data-note-receipt]");
  const noteReference = noteReceipt?.querySelector<HTMLElement>("[data-note-reference]");
  const anotherNote = noteReceipt?.querySelector<HTMLButtonElement>("[data-note-another]");
  if (!feed || !status || !filter || !more || !noteForm || !authPrompt || !flagDialog || !flagForm) return;

  let notes: CommunityNote[] = [];
  let cursor: string | null = null;
  let signedIn = false;
  let pendingFlag: { kind: string; id: string; button: HTMLButtonElement } | null = null;
  let preparedNoteImages: PreparedReportImage[] = [];
  let notePreparationController: AbortController | null = null;
  let notePreparationPromise: Promise<void> | null = null;
  let notePreparationError: string | undefined;

  const updateNoteSubmitState = (): void => {
    const submit = noteForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = !noteTurnstileToken || notePreparationPromise !== null || Boolean(notePreparationError);
  };

  const disableNoteHumanCheck = (message: string): void => {
    const state = noteForm.querySelector<HTMLElement>("[data-note-turnstile-state]");
    if (state) state.textContent = message;
    noteTurnstileToken = "";
    updateNoteSubmitState();
  };

  const initialiseNoteTurnstile = (): void => {
    const container = noteForm.querySelector<HTMLElement>("[data-note-turnstile]");
    const state = noteForm.querySelector<HTMLElement>("[data-note-turnstile-state]");
    if (!container || !turnstileApi || !turnstileSiteKey) {
      disableNoteHumanCheck("Human check unavailable. Case Notes cannot be submitted until it is restored.");
      return;
    }
    if (!boardTurnstileLifecycle.beginRender("field_note")) return;
    state?.remove();
    noteTurnstileWidget = turnstileApi.render(container, {
      sitekey: turnstileSiteKey,
      action: "field_note",
      appearance: "interaction-only",
      callback: (token) => {
        noteTurnstileToken = token;
        updateNoteSubmitState();
      },
      "expired-callback": () => {
        boardTurnstileLifecycle.recordReset("field_note", "expired");
        disableNoteHumanCheck("Human check expired. Complete it again before submitting.");
      },
      "error-callback": () => disableNoteHumanCheck("Human check unavailable. Case Notes cannot be submitted until it is restored."),
    });
  };

  const hydrateReplyTurnstiles = (): void => {
    replyTurnstileTokens.clear();
    replyTurnstileWidgets.clear();
    for (const container of feed.querySelectorAll<HTMLElement>("[data-reply-turnstile]")) {
      const noteId = container.dataset.noteId ?? "";
      const form = container.closest<HTMLFormElement>(".reply-form");
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!noteId || !form || !submit) continue;
      if (!turnstileApi || !turnstileSiteKey) {
        container.textContent = "Human check unavailable. Replies are temporarily disabled.";
        submit.disabled = true;
        continue;
      }
      container.textContent = "";
      const widgetId = turnstileApi.render(container, {
        sitekey: turnstileSiteKey,
        action: "reply",
        appearance: "interaction-only",
        callback: (token) => {
          replyTurnstileTokens.set(noteId, token);
          submit.disabled = false;
        },
        "expired-callback": () => {
          replyTurnstileTokens.delete(noteId);
          submit.disabled = true;
        },
        "error-callback": () => {
          replyTurnstileTokens.delete(noteId);
          submit.disabled = true;
          container.textContent = "Human check unavailable. Replies are temporarily disabled.";
        },
      });
      replyTurnstileWidgets.set(noteId, widgetId);
    }
  };

  const ensureFlagTurnstile = (): void => {
    const container = flagForm.querySelector<HTMLElement>("[data-flag-turnstile]");
    const state = flagForm.querySelector<HTMLElement>("[data-flag-turnstile-state]");
    const submit = flagForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    flagTurnstileToken = "";
    if (!container || !turnstileApi || !turnstileSiteKey) {
      if (state) state.textContent = "Human check unavailable. This item cannot be reported until it is restored.";
      if (submit) submit.disabled = true;
      return;
    }
    if (flagTurnstileWidget) {
      turnstileApi.reset(flagTurnstileWidget);
      boardTurnstileLifecycle.recordReset("flag", "new_form");
      if (submit) submit.disabled = true;
      return;
    }
    if (!boardTurnstileLifecycle.beginRender("flag")) return;
    state?.remove();
    flagTurnstileWidget = turnstileApi.render(container, {
      sitekey: turnstileSiteKey,
      action: "flag",
      appearance: "interaction-only",
      callback: (token) => {
        flagTurnstileToken = token;
        if (submit) submit.disabled = false;
      },
      "expired-callback": () => {
        flagTurnstileToken = "";
        if (submit) submit.disabled = true;
      },
      "error-callback": () => {
        flagTurnstileToken = "";
        if (submit) submit.disabled = true;
        container.textContent = "Human check unavailable. This item cannot be reported until it is restored.";
      },
    });
  };

  const render = (state: BoardViewState): void => {
    feed.innerHTML = renderBoardFeed(state);
    feed.setAttribute("aria-busy", state.kind === "loading" ? "true" : "false");
  };

  const load = async (append = false): Promise<void> => {
    if (!append) {
      render({ kind: "loading" });
      status.textContent = "Loading the public ledger...";
    }
    const waypoint = normalizeBoardWaypointFilter(filter.value);
    const cursorQuery = append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    try {
      const { response, payload } = await requestJson(`/api/v1/board?waypoint=${encodeURIComponent(waypoint)}${cursorQuery}`);
      if (!response.ok) throw new Error(errorMessage(payload, "The public ledger could not be opened."));
      const incoming = normalizeBoardPayload(payload);
      notes = append ? [...notes, ...incoming] : incoming;
      cursor = nextCursor(payload);
      more.hidden = cursor === null;
      render({ kind: "ready", notes, canReply: signedIn });
      if (signedIn) hydrateReplyTurnstiles();
      status.textContent = `${notes.length} approved ${notes.length === 1 ? "note" : "notes"}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The public ledger could not be opened.";
      render({ kind: "unavailable", detail });
      status.textContent = "Board unavailable";
      more.hidden = true;
    }
  };

  await bootstrapRuntime();

  try {
    const session = await requestJson("/api/v1/me/dashboard");
    signedIn = session.response.ok;
    noteForm.hidden = !signedIn;
    authPrompt.hidden = signedIn;
  } catch {
    signedIn = false;
    noteForm.hidden = true;
    authPrompt.hidden = false;
  }

  if (signedIn) {
    turnstileApi = await waitForTurnstile();
    initialiseNoteTurnstile();
  }

  await load();

  filter.addEventListener("change", () => void load());
  more.addEventListener("click", () => void load(true));

  const body = noteForm.elements.namedItem("body");
  const characterCount = document.querySelector<HTMLOutputElement>("#note-character-count");
  if (body instanceof HTMLTextAreaElement && characterCount) {
    body.addEventListener("input", () => {
      characterCount.value = String(body.value.length);
      pendingNoteIdempotencyKey = undefined;
    });
  }

  const imageInput = noteForm.elements.namedItem("images");
  const fileList = document.querySelector<HTMLElement>("#note-file-list");
  const imageStatus = document.querySelector<HTMLElement>("#note-image-status");
  const renderNoteImageMessages = (
    messages: readonly string[],
    kind: "normal" | "error" = "normal",
    statusMessage = "",
  ): void => {
    if (fileList) {
      fileList.innerHTML = messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("");
      if (kind === "error") fileList.dataset.kind = "error";
      else delete fileList.dataset.kind;
    }
    if (imageStatus) imageStatus.textContent = statusMessage || (kind === "error" ? messages[0] ?? "" : "");
  };

  const resetNoteImagePreparation = (clearInput = false): void => {
    notePreparationController?.abort();
    notePreparationController = null;
    notePreparationPromise = null;
    notePreparationError = undefined;
    preparedNoteImages = [];
    if (clearInput && imageInput instanceof HTMLInputElement) imageInput.value = "";
    if (imageInput instanceof HTMLInputElement) imageInput.removeAttribute("aria-invalid");
    renderNoteImageMessages([]);
    updateNoteSubmitState();
  };

  if (imageInput instanceof HTMLInputElement && fileList) {
    imageInput.addEventListener("change", () => {
      notePreparationController?.abort();
      pendingNoteIdempotencyKey = undefined;
      const files = [...(imageInput.files ?? [])];
      preparedNoteImages = [];
      notePreparationError = undefined;
      imageInput.removeAttribute("aria-invalid");
      if (files.length === 0) {
        notePreparationController = null;
        notePreparationPromise = null;
        renderNoteImageMessages([]);
        updateNoteSubmitState();
        return;
      }

      const controller = new AbortController();
      notePreparationController = controller;
      renderNoteImageMessages(
        files.map((file) => file.size > REPORT_IMAGE_DIRECT_BYTES
          ? `Optimizing ${file.name} (${reportImageMegabytes(file.size)})…`
          : `Checking ${file.name} (${reportImageMegabytes(file.size)})…`),
        "normal",
        "Preparing selected photos. Keep this page open until they are ready.",
      );
      const current = prepareReportImages(files, { signal: controller.signal })
        .then((prepared) => {
          if (controller.signal.aborted || notePreparationController !== controller) return;
          preparedNoteImages = prepared;
          renderNoteImageMessages(prepared.map((item) => item.optimized
            ? `${item.source.name}: ready — reduced from ${reportImageMegabytes(item.source.size)} to ${reportImageMegabytes(item.upload.size)}.`
            : `${item.source.name}: ready at ${reportImageMegabytes(item.upload.size)}.`), "normal", "Selected photos are ready to send.");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
          preparedNoteImages = [];
          notePreparationError = error instanceof ReportImagePreparationError
            ? error.message
            : "The selected photos could not be prepared. Choose JPEG, PNG, or WebP copies and try again.";
          renderNoteImageMessages([notePreparationError], "error");
          imageInput.setAttribute("aria-invalid", "true");
        })
        .finally(() => {
          if (notePreparationController !== controller) return;
          notePreparationController = null;
          notePreparationPromise = null;
          updateNoteSubmitState();
        });
      notePreparationPromise = current;
      updateNoteSubmitState();
    });
  }

  const waypointField = noteForm.elements.namedItem("waypointId");
  if (waypointField && "addEventListener" in waypointField && typeof waypointField.addEventListener === "function") {
    waypointField.addEventListener("change", () => {
      pendingNoteIdempotencyKey = undefined;
    });
  }

  noteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = noteForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    const summary = document.querySelector<HTMLElement>("#note-error-summary");
    const result = document.querySelector<HTMLElement>("#note-form-result");
    while (notePreparationPromise) await notePreparationPromise;
    const formData = buildCaseNoteFormData(noteForm, preparedNoteImages);
    const files = imageInput instanceof HTMLInputElement ? [...(imageInput.files ?? [])] : [];
    const errors = validateFieldNote(asString(formData.get("waypointId")), asString(formData.get("body")), files);
    if (notePreparationError) errors.push(notePreparationError);
    if (summary) {
      summary.hidden = errors.length === 0;
      summary.innerHTML = errors.length ? `<strong>Please fix this:</strong><ul>${errors.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>` : "";
    }
    if (errors.length) {
      summary?.focus();
      return;
    }
    const humanToken = noteTurnstileToken;
    if (!humanToken) {
      if (result) result.textContent = "Complete the human check before submitting.";
      return;
    }
    formData.set("cfTurnstileResponse", humanToken);
    pendingNoteIdempotencyKey ??= crypto.randomUUID();
    const attemptIdempotencyKey = pendingNoteIdempotencyKey;
    if (submit) submit.disabled = true;
    if (result) result.textContent = "Sending your Case Note for review...";
    let submitted = false;
    try {
      const headers = await authHeaders(buildCaseNoteRequestHeaders(attemptIdempotencyKey, humanToken));
      const { response, payload } = await requestJson("/api/v1/board/notes", { method: "POST", body: formData, headers });
      if (!response.ok) throw new Error(errorMessage(payload, "Your Case Note could not be sent."));
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const reference = data && asString(data.id).trim() ? asString(data.id).trim() : "recorded";
      pendingNoteIdempotencyKey = undefined;
      noteForm.reset();
      if (characterCount) characterCount.value = "0";
      resetNoteImagePreparation();
      if (noteReference) noteReference.textContent = reference;
      noteForm.hidden = true;
      if (noteReceipt) {
        noteReceipt.hidden = false;
        noteReceipt.focus();
      }
      if (result) result.textContent = caseNoteReceipt(reference);
      submitted = true;
    } catch (error) {
      const failure = failCaseNoteAttempt(attemptIdempotencyKey);
      pendingNoteIdempotencyKey = failure.idempotencyKey;
      noteTurnstileToken = failure.turnstileToken;
      if (result) result.textContent = error instanceof Error ? error.message : "Your Case Note could not be sent.";
    } finally {
      noteTurnstileToken = "";
      if (submit) submit.disabled = true;
      if (turnstileApi && noteTurnstileWidget) {
        turnstileApi.reset(noteTurnstileWidget);
        boardTurnstileLifecycle.recordReset("field_note", submitted ? "submitted" : "submission_failed");
      }
    }
  });

  anotherNote?.addEventListener("click", () => {
    noteForm.reset();
    noteForm.hidden = false;
    if (noteReceipt) noteReceipt.hidden = true;
    if (noteReference) noteReference.textContent = "";
    if (characterCount) characterCount.value = "0";
    resetNoteImagePreparation();
    pendingNoteIdempotencyKey = undefined;
    noteTurnstileToken = "";
    if (turnstileApi && noteTurnstileWidget) {
      turnstileApi.reset(noteTurnstileWidget);
      boardTurnstileLifecycle.recordReset("field_note", "new_form");
    }
    noteForm.querySelector<HTMLSelectElement>("[name=waypointId]")?.focus();
  });

  feed.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches(".reply-form")) return;
    event.preventDefault();
    const noteId = form.dataset.noteId ?? "";
    const field = form.elements.namedItem("body");
    const result = form.querySelector<HTMLElement>(".form-result");
    if (!(field instanceof HTMLTextAreaElement) || !noteId) return;
    const validation = validateReply(field.value);
    if (validation) {
      if (result) result.textContent = validation;
      field.focus();
      return;
    }
    const humanToken = replyTurnstileTokens.get(noteId) ?? "";
    if (!humanToken) {
      if (result) result.textContent = "Complete the human check before posting.";
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const headers = await authHeaders({ "Content-Type": "application/json" });
      if (humanToken) headers.set("CF-Turnstile-Response", humanToken);
      const { response, payload } = await requestJson(`/api/v1/board/notes/${encodeURIComponent(noteId)}/replies`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: field.value.trim(), cfTurnstileResponse: humanToken || undefined }),
      });
      if (!response.ok) throw new Error(replyFailureMessage(response, payload));
      if (result) result.textContent = "Reply posted.";
      await load();
    } catch (error) {
      if (result) result.textContent = error instanceof Error ? error.message : "Your reply could not be posted.";
    } finally {
      replyTurnstileTokens.delete(noteId);
      if (submit) submit.disabled = true;
      const widget = replyTurnstileWidgets.get(noteId);
      if (turnstileApi && widget) turnstileApi.reset(widget);
    }
  });

  feed.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.flagKind || !target.dataset.flagId) return;
    if (!signedIn) {
      window.location.assign("/dashboard#sign-in");
      return;
    }
    pendingFlag = { kind: target.dataset.flagKind, id: target.dataset.flagId, button: target };
    const result = flagForm.querySelector<HTMLElement>("[data-flag-result]");
    if (result) result.textContent = "";
    flagDialog.showModal();
    ensureFlagTurnstile();
  });

  document.querySelector("[data-close-flag]")?.addEventListener("click", () => {
    pendingFlag = null;
    flagDialog.close();
  });

  flagDialog.addEventListener("close", () => {
    pendingFlag = null;
    flagTurnstileToken = "";
  });

  flagForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = flagForm.querySelector<HTMLElement>("[data-flag-result]");
    const submit = flagForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!pendingFlag || !flagTurnstileToken) {
      if (result) result.textContent = "Complete the human check before sending this report.";
      return;
    }
    const target = pendingFlag;
    const humanToken = flagTurnstileToken;
    if (submit) submit.disabled = true;
    try {
      const headers = await authHeaders({ "Content-Type": "application/json" });
      headers.set("CF-Turnstile-Response", humanToken);
      const { response, payload } = await requestJson(`/api/v1/board/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.id)}/flags`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: "community_concern", cfTurnstileResponse: humanToken }),
      });
      if (!response.ok) throw new Error(errorMessage(payload, "The report could not be sent."));
      target.button.textContent = "Sent for review";
      target.button.disabled = true;
      flagDialog.close();
    } catch (error) {
      if (result) result.textContent = error instanceof Error ? error.message : "The report could not be sent.";
    } finally {
      flagTurnstileToken = "";
      if (submit) submit.disabled = true;
      if (turnstileApi && flagTurnstileWidget && flagDialog.open) turnstileApi.reset(flagTurnstileWidget);
    }
  });
}

if (typeof document !== "undefined") {
  initializeApprovedMediaViewer(document);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void initialiseBoard(), { once: true });
  else void initialiseBoard();
}
