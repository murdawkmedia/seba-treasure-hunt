import { routeOrder, waypointId } from "../shared/waypoints";

interface UpdateBase {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  publisherName: string;
}

interface OrdinaryUpdate extends UpdateBase {
  kind: "official";
}

interface ApprovedReportMedia {
  id: string;
  url: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

interface ApprovedReportUpdate extends UpdateBase {
  kind: "approved_report";
  waypointId: number | null;
  waypointRouteOrder: number | null;
  waypointName: string | null;
  latitude: number | null;
  longitude: number | null;
  media: ApprovedReportMedia[];
}

type OfficialUpdate = OrdinaryUpdate | ApprovedReportUpdate;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mediaIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const updateIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const safeImageTypes = new Set<ApprovedReportMedia["contentType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validCoordinates = (latitude: unknown, longitude: unknown): latitude is number =>
  typeof latitude === "number" &&
  Number.isFinite(latitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  typeof longitude === "number" &&
  Number.isFinite(longitude) &&
  longitude >= -180 &&
  longitude <= 180;

function normalizeMedia(value: unknown): ApprovedReportMedia[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate): ApprovedReportMedia[] => {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.id) || !mediaIdPattern.test(candidate.id)) return [];
    if (seen.has(candidate.id)) return [];
    const canonicalUrl = `/api/v1/media/${candidate.id}`;
    if (candidate.url !== canonicalUrl || !safeImageTypes.has(candidate.contentType as ApprovedReportMedia["contentType"])) {
      return [];
    }
    seen.add(candidate.id);
    return [{
      id: candidate.id,
      url: canonicalUrl,
      contentType: candidate.contentType as ApprovedReportMedia["contentType"],
    }];
  });
}

export function normalizeUpdates(value: unknown): { items: OfficialUpdate[]; nextCursor: string | null } {
  if (!isRecord(value)) return { items: [], nextCursor: null };
  const candidates = Array.isArray(value.data)
    ? value.data
    : isRecord(value.data) && Array.isArray(value.data.items)
      ? value.data.items
      : [];
  const items = candidates.flatMap((item): OfficialUpdate[] => {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.id) ||
      !updateIdPattern.test(item.id) ||
      !isNonEmptyString(item.title) ||
      typeof item.body !== "string" ||
      !isNonEmptyString(item.publishedAt) ||
      Number.isNaN(new Date(item.publishedAt).getTime()) ||
      !isNonEmptyString(item.publisherName)
    ) {
      return [];
    }
    if (item.kind === "approved_report") {
      const coordinatesAreValid = validCoordinates(item.latitude, item.longitude);
      const stableWaypointId = waypointId(item.waypointId);
      const publicRouteOrder = routeOrder(item.waypointRouteOrder);
      const waypointName = isNonEmptyString(item.waypointName) ? item.waypointName.trim() : null;
      const hasPublicWaypointMetadata = stableWaypointId !== null && publicRouteOrder !== null && waypointName !== null;
      return [{
        id: item.id,
        kind: "approved_report",
        title: item.title,
        body: item.body,
        publishedAt: item.publishedAt,
        publisherName: item.publisherName,
        waypointId: stableWaypointId,
        waypointRouteOrder: hasPublicWaypointMetadata ? publicRouteOrder : null,
        waypointName: hasPublicWaypointMetadata ? waypointName : null,
        latitude: coordinatesAreValid ? Number(item.latitude) : null,
        longitude: coordinatesAreValid ? Number(item.longitude) : null,
        media: normalizeMedia(item.media),
      }];
    }
    return [
      {
        id: item.id,
        kind: "official",
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

export function approvedReportWaypointLabel(
  update: Pick<ApprovedReportUpdate, "waypointRouteOrder" | "waypointName">,
): string | null {
  return update.waypointRouteOrder !== null && update.waypointName
    ? `Waypoint ${update.waypointRouteOrder} — ${update.waypointName}`
    : null;
}

export function googleMapsUrl(latitude: number, longitude: number): string | null {
  if (!validCoordinates(latitude, longitude)) return null;
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${latitude},${longitude}`);
  return url.toString();
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
    provenance.textContent = update.kind === "approved_report"
      ? `Shared by ${update.publisherName}`
      : `Published by ${update.publisherName}`;
    body.textContent = update.body;
    copy.appendChild(heading);
    copy.appendChild(provenance);
    copy.appendChild(body);
    if (update.kind === "approved_report") {
      item.classList.add("official-note--report");
      const eyebrow = document.createElement("p");
      eyebrow.className = "report-eyebrow";
      eyebrow.textContent = "Approved hunter report";
      copy.insertBefore(eyebrow, heading);

      const waypointLabel = approvedReportWaypointLabel(update);
      if (waypointLabel) {
        const waypoint = document.createElement("p");
        waypoint.className = "report-waypoint";
        waypoint.textContent = waypointLabel;
        copy.appendChild(waypoint);
      }

      const mapUrl = update.latitude === null || update.longitude === null
        ? null
        : googleMapsUrl(update.latitude, update.longitude);
      if (mapUrl) {
        const coordinates = document.createElement("p");
        const label = document.createElement("span");
        const link = document.createElement("a");
        coordinates.className = "report-coordinates";
        label.textContent = `Public GPS: ${update.latitude}, ${update.longitude}`;
        link.href = mapUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.referrerPolicy = "no-referrer";
        link.textContent = "Open in Google Maps";
        coordinates.append(label, link);
        copy.appendChild(coordinates);
      }

      if (update.media.length > 0) {
        const gallery = document.createElement("div");
        gallery.className = "report-evidence-gallery";
        gallery.setAttribute("aria-label", `Approved images for ${update.title}`);
        update.media.forEach((media, index) => {
          const image = document.createElement("img");
          image.src = media.url;
          image.alt = `Approved image ${index + 1} for ${update.title}`;
          image.loading = "lazy";
          image.decoding = "async";
          image.referrerPolicy = "no-referrer";
          gallery.appendChild(image);
        });
        copy.appendChild(gallery);
      }
    }
    item.appendChild(time);
    item.appendChild(copy);
    list.appendChild(item);
  }
}

let cursor: string | null = null;

function feedOptions(): { limit: number; paginate: boolean } {
  const feed = document.querySelector<HTMLElement>("[data-updates-feed]");
  const requested = Number.parseInt(feed?.dataset.updatesLimit ?? "20", 10);
  const limit = Number.isFinite(requested) ? Math.min(20, Math.max(1, requested)) : 20;
  return { limit, paginate: feed?.dataset.updatesPaginate !== "false" };
}

async function loadUpdates(next: string | null = null): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-updates-state]");
  const more = document.querySelector<HTMLButtonElement>("[data-updates-more]");
  const options = feedOptions();
  if (more) more.disabled = true;
  try {
    const url = new URL("/api/v1/updates", window.location.origin);
    url.searchParams.set("limit", String(options.limit));
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
    cursor = options.paginate ? page.nextCursor : null;
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
