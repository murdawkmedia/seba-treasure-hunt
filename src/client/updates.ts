interface OfficialUpdate {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  publisherName: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function normalizeUpdates(value: unknown): { items: OfficialUpdate[]; nextCursor: string | null } {
  if (!isRecord(value)) return { items: [], nextCursor: null };
  const candidates = Array.isArray(value.data)
    ? value.data
    : isRecord(value.data) && Array.isArray(value.data.items)
      ? value.data.items
      : [];
  const items = candidates.flatMap((item): OfficialUpdate[] => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.body !== "string" ||
      typeof item.publishedAt !== "string" ||
      typeof item.publisherName !== "string"
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        title: item.title,
        body: item.body,
        publishedAt: item.publishedAt,
        publisherName: item.publisherName,
      },
    ];
  });
  const nextCursor =
    isRecord(value.page) && typeof value.page.nextCursor === "string"
      ? value.page.nextCursor
      : null;
  return { items, nextCursor };
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function appendUpdates(items: OfficialUpdate[]): void {
  const list = document.querySelector<HTMLOListElement>("[data-updates-list]");
  if (!list) return;
  for (const update of items) {
    const item = document.createElement("li");
    const time = document.createElement("time");
    const copy = document.createElement("div");
    const heading = document.createElement("h2");
    const provenance = document.createElement("p");
    const body = document.createElement("p");
    item.className = "official-note";
    time.dateTime = update.publishedAt;
    time.textContent = formatPublishedAt(update.publishedAt);
    heading.textContent = update.title;
    provenance.className = "provenance";
    provenance.textContent = `Published by ${update.publisherName}`;
    body.textContent = update.body;
    copy.appendChild(heading);
    copy.appendChild(provenance);
    copy.appendChild(body);
    item.appendChild(time);
    item.appendChild(copy);
    list.appendChild(item);
  }
}

let cursor: string | null = null;

async function loadUpdates(next: string | null = null): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-updates-state]");
  const more = document.querySelector<HTMLButtonElement>("[data-updates-more]");
  if (more) more.disabled = true;
  try {
    const url = new URL("/api/v1/updates", window.location.origin);
    url.searchParams.set("limit", "20");
    if (next) url.searchParams.set("cursor", next);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("updates unavailable");
    const page = normalizeUpdates(await response.json());
    if (page.items.length === 0 && !next) {
      if (state) {
        state.dataset.kind = "info";
        state.textContent = "No official case updates have been published yet.";
      }
    } else {
      appendUpdates(page.items);
      if (state) state.hidden = true;
    }
    cursor = page.nextCursor;
    if (more) {
      more.hidden = cursor === null;
      more.disabled = false;
    }
  } catch {
    if (state) {
      state.hidden = false;
      state.dataset.kind = "error";
      state.textContent =
        "The official update feed cannot be verified right now. Do not treat an older screenshot or community post as current.";
    }
    if (more) more.hidden = true;
  }
}

function initializeUpdates(): void {
  const more = document.querySelector<HTMLButtonElement>("[data-updates-more]");
  more?.addEventListener("click", () => {
    if (cursor) void loadUpdates(cursor);
  });
  void loadUpdates();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeUpdates, { once: true });
  } else {
    initializeUpdates();
  }
}
