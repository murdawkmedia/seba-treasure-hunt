export type CaseState = "open" | "paused" | "found";

export interface LiveCaseStatus {
  state: CaseState;
  hours: {
    opens: string;
    closes: string;
    timezone: "America/Edmonton";
  };
  updatedAt: string;
  nextClue: null | {
    title: string;
    releasesAt: string;
  };
  version: number;
}

export interface UnavailableCaseStatus {
  state: "unavailable";
}

export type CaseStatus = LiveCaseStatus | UnavailableCaseStatus;

const unavailableStatus = (): UnavailableCaseStatus => ({ state: "unavailable" });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCaseState = (value: unknown): value is CaseState =>
  value === "open" || value === "paused" || value === "found";

export function normalizeStatusEnvelope(value: unknown): CaseStatus {
  if (!isRecord(value) || !isRecord(value.data)) return unavailableStatus();
  const data = value.data;
  if (!isCaseState(data.state) || !isRecord(data.hours)) return unavailableStatus();

  const { opens, closes, timezone } = data.hours;
  if (
    typeof opens !== "string" ||
    typeof closes !== "string" ||
    timezone !== "America/Edmonton" ||
    typeof data.updatedAt !== "string" ||
    !Number.isInteger(data.version)
  ) {
    return unavailableStatus();
  }

  let nextClue: LiveCaseStatus["nextClue"] = null;
  if (data.nextClue !== null) {
    if (
      !isRecord(data.nextClue) ||
      typeof data.nextClue.title !== "string" ||
      typeof data.nextClue.releasesAt !== "string"
    ) {
      return unavailableStatus();
    }
    nextClue = {
      title: data.nextClue.title,
      releasesAt: data.nextClue.releasesAt,
    };
  }

  const updatedAt = new Date(data.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return unavailableStatus();

  return {
    state: data.state,
    hours: { opens, closes, timezone },
    updatedAt: data.updatedAt,
    nextClue,
    version: data.version as number,
  };
}

function relativeAge(then: Date, now: Date): string {
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  const future = seconds < 0;
  const absoluteSeconds = Math.abs(seconds);

  if (absoluteSeconds < 45) return future ? "in moments" : "just now";
  let amount: number;
  let unit: string;
  if (absoluteSeconds < 90 * 60) {
    amount = Math.max(1, Math.round(absoluteSeconds / 60));
    unit = "minute";
  } else if (absoluteSeconds < 36 * 60 * 60) {
    amount = Math.max(1, Math.round(absoluteSeconds / 3_600));
    unit = "hour";
  } else {
    amount = Math.max(1, Math.round(absoluteSeconds / 86_400));
    unit = "day";
  }
  const phrase = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
  return future ? `in ${phrase}` : `${phrase} ago`;
}

export function formatStatusUpdated(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Update time unavailable";
  const absolute = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return `${absolute} · ${relativeAge(date, now)}`;
}

function formatClueRelease(clue: NonNullable<LiveCaseStatus["nextClue"]>): string {
  const date = new Date(clue.releasesAt);
  if (Number.isNaN(date.getTime())) return `Next clue: ${clue.title}`;
  const release = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return `Next clue: ${clue.title} · ${release}`;
}

const statusPresentation: Record<CaseState, { label: string; mark: string }> = {
  open: { label: "Case open", mark: "◆" },
  paused: { label: "Hunt paused", mark: "Ⅱ" },
  found: { label: "Case found", mark: "✓" },
};

export function renderCaseStatus(status: CaseStatus, root: ParentNode = document): void {
  const strips = root.querySelectorAll<HTMLElement>("[data-case-status]");
  for (const strip of strips) {
    const label = strip.querySelector<HTMLElement>("[data-status-label]");
    const detail = strip.querySelector<HTMLElement>("[data-status-detail]");
    const mark = strip.querySelector<HTMLElement>("[data-status-mark]");
    const next = strip.querySelector<HTMLElement>("[data-status-next]");

    if (status.state === "unavailable") {
      strip.dataset.status = "unavailable";
      if (label) label.textContent = "Status unavailable";
      if (mark) mark.textContent = "?";
      if (detail) {
        detail.textContent =
          "Live status could not be confirmed. Exact directions stay locked; reporting remains available.";
      }
      if (next) {
        next.textContent = "";
        next.hidden = true;
      }
      continue;
    }

    const presentation = statusPresentation[status.state];
    strip.dataset.status = status.state;
    if (label) label.textContent = presentation.label;
    if (mark) mark.textContent = presentation.mark;
    if (detail) {
      detail.textContent = `${status.hours.opens}–${status.hours.closes} MT · Updated ${formatStatusUpdated(status.updatedAt)}`;
    }
    if (next) {
      next.hidden = status.nextClue === null;
      next.textContent = status.nextClue ? formatClueRelease(status.nextClue) : "";
    }
  }
}

let statusRequest: Promise<CaseStatus> | undefined;

export function fetchCaseStatus(): Promise<CaseStatus> {
  statusRequest ??= fetch("/api/v1/status", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(8_000),
  })
    .then(async (response) => {
      if (!response.ok) return unavailableStatus();
      return normalizeStatusEnvelope(await response.json());
    })
    .catch(() => unavailableStatus());
  return statusRequest;
}

export async function loadAndRenderStatus(): Promise<CaseStatus> {
  const status = await fetchCaseStatus();
  if (typeof document !== "undefined") renderCaseStatus(status);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("timlost:status", { detail: status }));
  }
  return status;
}

interface CurrentRules {
  id: string;
  version: string;
  title: string;
  body: string;
  lastUpdatedAt: string;
}

function normalizeRules(value: unknown): CurrentRules | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  if (
    typeof data.id !== "string" ||
    typeof data.version !== "string" ||
    typeof data.title !== "string" ||
    typeof data.body !== "string" ||
    typeof data.lastUpdatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: data.id,
    version: data.version,
    title: data.title,
    body: data.body,
    lastUpdatedAt: data.lastUpdatedAt,
  };
}

async function hydrateCurrentRules(): Promise<void> {
  const container = document.querySelector<HTMLElement>("[data-rules-current]");
  if (!container) return;
  const state = container.querySelector<HTMLElement>("[data-rules-state]");
  try {
    const response = await fetch("/api/v1/rules/current", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("rules unavailable");
    const rules = normalizeRules(await response.json());
    if (!rules) throw new Error("rules unavailable");

    const title = container.querySelector<HTMLElement>("[data-rules-title]");
    const version = container.querySelector<HTMLElement>("[data-rules-version]");
    const body = container.querySelector<HTMLElement>("[data-rules-body]");
    if (title) title.textContent = rules.title;
    if (version) {
      version.textContent = `Version ${rules.version} · Updated ${formatStatusUpdated(rules.lastUpdatedAt)}`;
    }
    if (body) body.textContent = rules.body;
    if (state) state.hidden = true;
  } catch {
    if (state) {
      state.dataset.kind = "error";
      state.textContent =
        "The current rules version cannot be verified right now. Use the safety summary conservatively and check back before searching.";
    }
  }
}

if (typeof document !== "undefined") {
  const initialize = (): void => {
    void loadAndRenderStatus();
    void hydrateCurrentRules();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}
