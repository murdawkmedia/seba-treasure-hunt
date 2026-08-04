import { initializeApprovedMediaViewer, renderApprovedMedia } from "./approved-media-viewer";

export interface FreshDropItem {
  id: string;
  slug: string;
  owner: "tim" | "casey";
  category: string;
  title: string;
  description: string;
  status: "out_there" | "found" | "paused";
  reportable: boolean;
  collectionOrder: number;
  media: Array<{ id: string; url: string; alt: string; caption: string }>;
}

export interface FreshDropsDependencies {
  request: (path: string) => Promise<Response>;
  requestImage: (path: string) => Promise<Response>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const safeId = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
const safeText = (value: unknown, maximum: number): string =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

export const freshDropReportHref = (id: string): string =>
  /^[A-Za-z0-9_-]{1,128}$/.test(id)
    ? `/report?item=${encodeURIComponent(id)}&source=fresh-drops`
    : "/report";

export function normalizeFreshDrops(value: unknown): FreshDropItem[] {
  if (!Array.isArray(value)) return [];
  const owners = new Set(["tim", "casey"]);
  const statuses = new Set(["out_there", "found", "paused"]);
  const seen = new Set<string>();
  return value.flatMap((candidate): FreshDropItem[] => {
    if (!isRecord(candidate)) return [];
    const id = safeId(candidate.id);
    const slug = safeId(candidate.slug);
    const owner = safeText(candidate.owner, 16);
    const status = safeText(candidate.status, 24);
    const collectionOrder = candidate.collectionOrder;
    if (!id || !slug || seen.has(id) || !owners.has(owner) || !statuses.has(status)) return [];
    if (!Number.isInteger(collectionOrder) || Number(collectionOrder) < 0 || Number(collectionOrder) > 999) return [];
    const title = safeText(candidate.title, 160);
    const description = safeText(candidate.description, 1200);
    if (!title || !description) return [];
    const media = Array.isArray(candidate.media)
      ? candidate.media.flatMap((entry): FreshDropItem["media"] => {
          if (!isRecord(entry)) return [];
          const mediaId = safeId(entry.id);
          const alt = safeText(entry.alt, 300);
          if (!mediaId || !alt) return [];
          return [{
            id: mediaId,
            url: `/api/v1/me/fresh-drops/media/${encodeURIComponent(mediaId)}`,
            alt,
            caption: safeText(entry.caption, 500),
          }];
        })
      : [];
    seen.add(id);
    return [{
      id,
      slug,
      owner: owner as FreshDropItem["owner"],
      category: safeText(candidate.category, 80),
      title,
      description,
      status: status as FreshDropItem["status"],
      reportable: candidate.reportable === true,
      collectionOrder: Number(collectionOrder),
      media,
    }];
  }).sort((left, right) => left.collectionOrder - right.collectionOrder || left.id.localeCompare(right.id));
}

const statusLabel = (status: FreshDropItem["status"]): string => ({
  out_there: "Out there",
  found: "Found",
  paused: "Paused",
})[status];

let disposeActiveFreshDrops = (): void => {};

export function clearFreshDrops(): void {
  disposeActiveFreshDrops();
  disposeActiveFreshDrops = (): void => {};
}

export function showFreshDropsLocked(target: "#profile" | "#waiver" = "#waiver"): void {
  clearFreshDrops();
  const root = document.querySelector<HTMLElement>("[data-fresh-drops]");
  const state = root?.querySelector<HTMLElement>("[data-fresh-drops-state]");
  const story = root?.querySelector<HTMLElement>("[data-fresh-drops-story]");
  const list = root?.querySelector<HTMLOListElement>("[data-fresh-drops-items]");
  const retry = root?.querySelector<HTMLButtonElement>("[data-fresh-drops-retry]");
  if (!state || !story || !list || !retry) return;
  state.textContent = "Finish registration to open Fresh Drops.";
  list.replaceChildren();
  retry.hidden = true;
  const action = document.createElement("a");
  action.className = "hunter-button hunter-button--quiet";
  action.href = target;
  action.textContent = target === "#profile" ? "Finish my profile" : "Review and accept the waiver";
  story.replaceChildren(action);
}

function appendItemCopy(container: HTMLElement, item: FreshDropItem): void {
  const heading = document.createElement("h3");
  const description = document.createElement("p");
  const status = document.createElement("p");
  heading.textContent = item.title;
  description.textContent = item.description;
  status.className = "fresh-drops__status";
  status.textContent = statusLabel(item.status);
  container.append(status, heading, description);
}

function appendUnavailableMedia(gallery: HTMLElement, message = "Image temporarily unavailable"): void {
  const fallback = document.createElement("p");
  fallback.className = "fresh-drops__image-unavailable";
  fallback.textContent = message;
  gallery.append(fallback);
}

export function initializeFreshDrops(dependencies: FreshDropsDependencies): void {
  clearFreshDrops();
  const root = document.querySelector<HTMLElement>("[data-fresh-drops]");
  if (!root) return;
  const state = root.querySelector<HTMLElement>("[data-fresh-drops-state]");
  const story = root.querySelector<HTMLElement>("[data-fresh-drops-story]");
  const list = root.querySelector<HTMLOListElement>("[data-fresh-drops-items]");
  const retry = root.querySelector<HTMLButtonElement>("[data-fresh-drops-retry]");
  if (!state || !story || !list || !retry) return;

  const objectUrls = new Set<string>();
  let loading = false;
  let disposed = false;

  const revokeObjectUrls = (): void => {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    revokeObjectUrls();
  };
  disposeActiveFreshDrops = dispose;

  const renderMedia = async (container: HTMLElement, item: FreshDropItem): Promise<void> => {
    const gallery = document.createElement("div");
    gallery.className = "fresh-drops__media";
    gallery.dataset.mediaGallery = "";
    gallery.dataset.mediaGalleryTitle = item.title;
    gallery.setAttribute("aria-label", `${item.title} photographs`);
    container.append(gallery);
    if (item.media.length === 0) {
      appendUnavailableMedia(gallery, "No photo released");
      return;
    }
    for (const media of item.media) {
      try {
        const response = await dependencies.requestImage(media.url);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!response.ok || !contentType.startsWith("image/")) throw new Error("Image unavailable");
        const objectUrl = URL.createObjectURL(await response.blob());
        if (disposed) {
          URL.revokeObjectURL(objectUrl);
          continue;
        }
        objectUrls.add(objectUrl);
        const template = document.createElement("template");
        template.innerHTML = renderApprovedMedia({
          href: objectUrl,
          src: objectUrl,
          alt: media.alt,
          caption: media.caption || media.alt,
        });
        gallery.append(template.content);
      } catch {
        appendUnavailableMedia(gallery);
      }
    }
  };

  const load = async (): Promise<void> => {
    if (loading || disposed) return;
    loading = true;
    retry.hidden = true;
    state.textContent = "Loading the latest item file…";
    revokeObjectUrls();
    story.replaceChildren();
    list.replaceChildren();
    try {
      const response = await dependencies.request("/api/v1/me/fresh-drops");
      if (!response.ok) throw new Error("Fresh Drops unavailable");
      const envelope: unknown = await response.json();
      const responseData = isRecord(envelope) ? envelope.data : null;
      const items = normalizeFreshDrops(
        Array.isArray(responseData)
          ? responseData
          : isRecord(responseData)
            ? responseData.items
            : null,
      );
      if (items.length === 0) throw new Error("Fresh Drops unavailable");
      const storyItem = items.find((item) => item.category === "story_evidence" && !item.reportable);
      if (storyItem) {
        story.className = "fresh-drops__story";
        appendItemCopy(story, storyItem);
        await renderMedia(story, storyItem);
      }
      const reportableItems = items.filter((item) => item !== storyItem);
      for (const item of reportableItems) {
        const row = document.createElement("li");
        row.className = "fresh-drops__item";
        appendItemCopy(row, item);
        await renderMedia(row, item);
        if (item.reportable) {
          const link = document.createElement("a");
          link.className = "fresh-drops__report";
          link.href = freshDropReportHref(item.id);
          link.textContent = "I found this";
          link.setAttribute("aria-label", `I found this: ${item.title}`);
          row.append(link);
        }
        list.append(row);
      }
      state.textContent = `${reportableItems.length} items are currently in the signed-in case file.`;
      initializeApprovedMediaViewer();
    } catch {
      state.textContent = "Fresh Drops could not be loaded. Try again.";
      retry.hidden = false;
    } finally {
      loading = false;
    }
  };

  retry.addEventListener("click", () => { void load(); });
  window.addEventListener("pagehide", dispose, { once: true });
  void load();
}
