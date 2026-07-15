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
  waypointId: string;
  body: string;
  authorHandle: string;
  createdAt: string;
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
const maxImages = 3;
const maxImageBytes = 10 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
let turnstileSiteKey: string | null = null;
let turnstileApi: TurnstileApi | null = null;
let noteTurnstileToken = "";
let noteTurnstileWidget: string | undefined;
let flagTurnstileToken = "";
let flagTurnstileWidget: string | undefined;
const replyTurnstileTokens = new Map<string, string>();
const replyTurnstileWidgets = new Map<string, string>();

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
  const match = String(value ?? "").match(/(?:^|[^0-9])0?(1[0-2]|[1-9])$/);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function waypointLabel(value: unknown): string {
  const number = waypointNumber(value);
  return number === null ? "Waypoint not specified" : `Waypoint ${String(number).padStart(2, "0")}`;
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
  return {
    id,
    waypointId,
    body,
    authorHandle,
    createdAt,
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
  if (waypointNumber(waypointId) === null) errors.push("Choose one of the 12 waypoints.");
  const note = body.trim();
  if (!note) errors.push("Describe what you observed.");
  if (note.length > 1200) errors.push("Field Notes must be 1,200 characters or fewer.");
  if (files.length > maxImages) errors.push("Choose no more than 3 images.");
  for (const file of files) {
    if (!allowedImageTypes.has(file.type)) errors.push(`${file.name} is not a JPEG, PNG or WebP image.`);
    if (file.size > maxImageBytes) errors.push(`${file.name} is larger than 10 MiB.`);
  }
  return errors;
}

function renderMedia(media: CommunityMedia[], handle: string): string {
  if (media.length === 0) return "";
  return `<div class="field-note__media">${media
    .map((item) => `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || `Field Note image shared by ${handle}`)}" loading="lazy" decoding="async" />`)
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
  return `<article class="field-note" data-note-id="${escapeHtml(note.id)}">
    <header class="field-note__head">
      <div><p class="field-note__waypoint">${escapeHtml(waypointLabel(note.waypointId))}</p><p class="field-note__author"><strong>${escapeHtml(note.authorHandle)}</strong></p></div>
      <time datetime="${escapeHtml(note.createdAt)}">${escapeHtml(formatBoardTime(note.createdAt))}</time>
    </header>
    <div class="field-note__body">${escapeHtml(note.body)}</div>
    ${renderMedia(note.media, note.authorHandle)}
    <p class="field-note__notice">${communityDisclaimer}</p>
    <div class="field-note__actions"><button class="note-action" type="button" data-flag-kind="note" data-flag-id="${escapeHtml(note.id)}" aria-label="Report Field Note by ${escapeHtml(note.authorHandle)} for review">Report Field Note for review</button></div>
    ${renderReplies(note, canReply)}
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
    return `<div class="board-state board-state--empty"><h3>No approved Field Notes here yet</h3><p>Try another waypoint or return after moderators have reviewed new observations.</p></div>`;
  }
  return state.notes.map((note) => renderNote(note, state.canReply)).join("");
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : payload;
  return asString(error.message) || fallback;
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
  if (!feed || !status || !filter || !more || !noteForm || !authPrompt || !flagDialog || !flagForm) return;

  let notes: CommunityNote[] = [];
  let cursor: string | null = null;
  let signedIn = false;
  let pendingFlag: { kind: string; id: string; button: HTMLButtonElement } | null = null;

  const disableNoteHumanCheck = (message: string): void => {
    const state = noteForm.querySelector<HTMLElement>("[data-note-turnstile-state]");
    const submit = noteForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (state) state.textContent = message;
    if (submit) submit.disabled = true;
    noteTurnstileToken = "";
  };

  const initialiseNoteTurnstile = (): void => {
    const container = noteForm.querySelector<HTMLElement>("[data-note-turnstile]");
    const state = noteForm.querySelector<HTMLElement>("[data-note-turnstile-state]");
    const submit = noteForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!container || !turnstileApi || !turnstileSiteKey) {
      disableNoteHumanCheck("Human check unavailable. Field Notes cannot be submitted until it is restored.");
      return;
    }
    state?.remove();
    noteTurnstileWidget = turnstileApi.render(container, {
      sitekey: turnstileSiteKey,
      action: "field_note",
      callback: (token) => {
        noteTurnstileToken = token;
        if (submit) submit.disabled = false;
      },
      "expired-callback": () => disableNoteHumanCheck("Human check expired. Complete it again before submitting."),
      "error-callback": () => disableNoteHumanCheck("Human check unavailable. Field Notes cannot be submitted until it is restored."),
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
      if (submit) submit.disabled = true;
      return;
    }
    state?.remove();
    flagTurnstileWidget = turnstileApi.render(container, {
      sitekey: turnstileSiteKey,
      action: "flag",
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
    const waypoint = /^(?:all|[1-9]|1[0-2])$/.test(filter.value) ? filter.value : "all";
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
    body.addEventListener("input", () => { characterCount.value = String(body.value.length); });
  }

  const imageInput = noteForm.elements.namedItem("images");
  const fileList = document.querySelector<HTMLElement>("#note-file-list");
  if (imageInput instanceof HTMLInputElement && fileList) {
    imageInput.addEventListener("change", () => {
      const files = [...(imageInput.files ?? [])];
      fileList.innerHTML = files.length === 0
        ? ""
        : files.map((file) => `<li>${escapeHtml(file.name)} &middot; ${(file.size / 1024 / 1024).toFixed(1)} MiB</li>`).join("");
    });
  }

  noteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = noteForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    const summary = document.querySelector<HTMLElement>("#note-error-summary");
    const result = document.querySelector<HTMLElement>("#note-form-result");
    const formData = new FormData(noteForm);
    const files = imageInput instanceof HTMLInputElement ? [...(imageInput.files ?? [])] : [];
    const errors = validateFieldNote(asString(formData.get("waypointId")), asString(formData.get("body")), files);
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
    if (submit) submit.disabled = true;
    if (result) result.textContent = "Sending your Field Note for review...";
    try {
      const headers = await authHeaders(humanToken ? { "CF-Turnstile-Response": humanToken } : undefined);
      const { response, payload } = await requestJson("/api/v1/board/notes", { method: "POST", body: formData, headers });
      if (!response.ok) throw new Error(errorMessage(payload, "Your Field Note could not be sent."));
      noteForm.reset();
      if (characterCount) characterCount.value = "0";
      if (fileList) fileList.innerHTML = "";
      if (result) result.textContent = "Received. Your note and images stay private until a moderator approves them.";
    } catch (error) {
      if (result) result.textContent = error instanceof Error ? error.message : "Your Field Note could not be sent.";
    } finally {
      noteTurnstileToken = "";
      if (submit) submit.disabled = true;
      if (turnstileApi && noteTurnstileWidget) turnstileApi.reset(noteTurnstileWidget);
    }
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
      if (!response.ok) throw new Error(errorMessage(payload, "Your reply could not be posted."));
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
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void initialiseBoard(), { once: true });
  else void initialiseBoard();
}
