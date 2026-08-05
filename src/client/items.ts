import { initializeApprovedMediaViewer } from "./approved-media-viewer";

type CaseItemStatus = "out_there" | "found" | "paused";

interface PublicCaseItemMedia {
  id: string;
  url: string;
  alt: string;
}

export interface PublicCaseItem {
  slug: string;
  owner: "tim" | "casey";
  title: string;
  description: string;
  finderKeeps: boolean;
  status: CaseItemStatus;
  media: PublicCaseItemMedia[];
  audience: "public" | "hunter_only";
  showOnBoard: boolean;
  teaserOrder: 1 | 2 | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const normalizeItem = (value: unknown): PublicCaseItem | null => {
  if (!isRecord(value)) return null;
  const slug = text(value.slug);
  const owner = value.owner;
  const status = value.status;
  const title = text(value.title);
  const description = text(value.description);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      (owner !== "tim" && owner !== "casey") ||
      (status !== "out_there" && status !== "found" && status !== "paused") ||
      !title || !description) return null;
  const media = Array.isArray(value.media) ? value.media.flatMap((entry): PublicCaseItemMedia[] => {
    if (!isRecord(entry)) return [];
    const id = text(entry.id);
    const url = text(entry.url);
    const alt = text(entry.alt);
    return id && /^\/api\/v1\/media\/[A-Za-z0-9_-]+$/.test(url) && alt
      ? [{ id, url, alt }]
      : [];
  }).slice(0, 3) : [];
  const audience = value.audience === "hunter_only" ? "hunter_only" : "public";
  const teaserOrder = value.teaserOrder === 1 || value.teaserOrder === 2 ? value.teaserOrder : null;
  return {
    slug,
    owner,
    title,
    description,
    finderKeeps: value.finderKeeps === true,
    status,
    media,
    audience,
    showOnBoard: value.showOnBoard !== false,
    teaserOrder,
  };
};

export const publicFreshDropTeaser = (items: PublicCaseItem[]): PublicCaseItem[] =>
  items
    .filter((item) => item.audience === "public" && item.media.length > 0 &&
      (item.teaserOrder === 1 || item.teaserOrder === 2))
    .sort((left, right) => Number(left.teaserOrder) - Number(right.teaserOrder))
    .slice(0, 2);

const statusLabel = (item: PublicCaseItem): string => {
  if (item.status === "found") return "Found";
  if (item.status === "paused") return "Paused";
  return item.finderKeeps ? "Finder keeps it" : "Out there";
};

const addFoundStamp = (card: HTMLElement): void => {
  if (card.querySelector(".evidence-stamp")) return;
  const photo = card.querySelector<HTMLElement>(".evidence-card__photo");
  if (!photo) return;
  const stamp = document.createElement("span");
  stamp.className = "evidence-stamp";
  stamp.setAttribute("aria-label", "Status: found");
  stamp.textContent = "FOUND";
  photo.appendChild(stamp);
};

const replaceMedia = (card: HTMLElement, item: PublicCaseItem): void => {
  if (item.media.length === 0) return;
  const first = item.media[0];
  if (!first) return;
  const existing = card.querySelector<HTMLElement>(".evidence-card__photo");
  const figure = document.createElement("figure");
  figure.className = "evidence-card__photo";
  if (item.slug === "coop-escape-artist") figure.classList.add("evidence-card__photo--document");
  const trigger = document.createElement("a");
  trigger.className = "approved-media-trigger";
  trigger.href = first.url;
  trigger.target = "_blank";
  trigger.rel = "noopener";
  trigger.referrerPolicy = "no-referrer";
  trigger.setAttribute("data-approved-media", "");
  trigger.dataset.mediaCaption = item.title;
  trigger.setAttribute("aria-label", `Open full image: ${first.alt}`);
  const image = document.createElement("img");
  image.src = first.url;
  image.alt = first.alt;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  trigger.appendChild(image);
  figure.appendChild(trigger);
  if (existing) existing.replaceWith(figure);
  else card.prepend(figure);
};

const updateCard = (card: HTMLElement, item: PublicCaseItem): void => {
  card.dataset.caseItemStatus = item.status;
  card.classList.toggle("evidence-card--found", item.status === "found");
  const body = card.querySelector<HTMLElement>(":scope > div") ?? card;
  const heading = body.querySelector("h2") ?? document.createElement("h2");
  const meta = body.querySelector<HTMLElement>(".evidence-card__meta") ?? document.createElement("p");
  const description = [...body.querySelectorAll("p")].find((paragraph) => !paragraph.classList.contains("evidence-card__meta")) ?? document.createElement("p");
  meta.className = "evidence-card__meta";
  meta.textContent = `${item.owner === "tim" ? "Tim" : "Casey"} · ${statusLabel(item)}`;
  heading.textContent = item.title;
  description.textContent = item.description;
  if (!meta.isConnected) body.prepend(meta);
  if (!heading.isConnected) body.appendChild(heading);
  if (!description.isConnected) body.appendChild(description);
  replaceMedia(card, item);
  if (item.status === "found") addFoundStamp(card);
  else card.querySelector(".evidence-stamp")?.remove();
};

const createCard = (item: PublicCaseItem): HTMLLIElement => {
  const card = document.createElement("li");
  card.className = "evidence-card";
  card.dataset.caseItem = item.slug;
  const body = document.createElement("div");
  card.appendChild(body);
  updateCard(card, item);
  return card;
};

export const renderPublicCaseItems = (root: HTMLElement, value: unknown): number => {
  const items = Array.isArray(value)
    ? value.map(normalizeItem).filter((item): item is PublicCaseItem => item !== null && item.showOnBoard)
    : [];
  if (items.length === 0) return 0;
  const visible = new Set(items.map((item) => item.slug));
  for (const card of root.querySelectorAll<HTMLElement>("[data-case-item]")) {
    if (!visible.has(card.dataset.caseItem ?? "")) card.remove();
  }
  for (const item of items) {
    const selector = `[data-case-item="${CSS.escape(item.slug)}"]`;
    const card = root.querySelector<HTMLElement>(selector) ?? createCard(item);
    if (!card.isConnected) root.appendChild(card);
    updateCard(card, item);
  }
  return items.length;
};

const createTeaserCard = (item: PublicCaseItem): HTMLLIElement => {
  const card = document.createElement("li");
  card.className = "fresh-drops-teaser__item";
  card.dataset.freshDropTeaser = item.slug;
  if (item.media[0]) {
    const image = document.createElement("img");
    image.src = item.media[0].url;
    image.alt = item.media[0].alt;
    image.loading = "lazy";
    image.decoding = "async";
    card.append(image);
  }
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  const description = document.createElement("span");
  heading.textContent = item.title;
  description.textContent = item.description;
  copy.append(heading, description);
  card.append(copy);
  return card;
};

export const renderPublicFreshDropTeaser = (root: HTMLElement, value: unknown): number => {
  const items = Array.isArray(value)
    ? value.map(normalizeItem).filter((item): item is PublicCaseItem => item !== null)
    : [];
  const teaser = publicFreshDropTeaser(items);
  root.replaceChildren(...teaser.map(createTeaserCard));
  return teaser.length;
};

const initializeItems = async (): Promise<void> => {
  const board = document.querySelector<HTMLElement>("[data-case-item-board]");
  const list = board?.querySelector<HTMLElement>(".evidence-wall__items");
  const state = board?.querySelector<HTMLElement>("[data-case-items-state]");
  const teaserList = document.querySelector<HTMLOListElement>("[data-fresh-drops-teaser-items]");
  if (!board || !list) return;
  list.setAttribute("data-media-gallery", "");
  list.dataset.mediaGalleryTitle = "Current case evidence";
  initializeApprovedMediaViewer(document);
  try {
    const response = await fetch("/api/v1/items", { credentials: "same-origin", headers: { Accept: "application/json" } });
    const payload: unknown = await response.json().catch(() => null);
    const items = isRecord(payload)
      ? (Array.isArray(payload.data) ? payload.data : isRecord(payload.data) ? payload.data.items : null)
      : null;
    const count = response.ok ? renderPublicCaseItems(list, items) : 0;
    if (count < 1) throw new Error("No current items were returned.");
    if (teaserList) renderPublicFreshDropTeaser(teaserList, items);
    if (state) state.textContent = `${count} verified item records loaded.`;
  } catch {
    if (state) state.textContent = "Live item status could not be refreshed. Showing the last verified list.";
  }
};

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { void initializeItems(); }, { once: true });
  else void initializeItems();
}
