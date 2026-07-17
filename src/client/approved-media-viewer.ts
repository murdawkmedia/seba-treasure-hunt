export interface ApprovedMediaItem {
  href: string;
  src: string;
  alt: string;
  caption: string;
  trigger: HTMLAnchorElement;
}

export interface ApprovedMediaMarkupInput {
  href: string;
  src: string;
  alt: string;
  caption: string;
}

const escapeMediaHtml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

export function cycleApprovedMediaIndex(current: number, delta: -1 | 1, length: number): number {
  if (!Number.isInteger(current) || !Number.isInteger(length) || length <= 1) return 0;
  return (current + delta + length) % length;
}

export function swipePhotoDelta(startX: number | null, endX: number, threshold = 48): -1 | 0 | 1 {
  if (startX === null || !Number.isFinite(endX)) return 0;
  const distance = endX - startX;
  if (Math.abs(distance) < threshold) return 0;
  return distance < 0 ? 1 : -1;
}

export function renderApprovedMedia(input: ApprovedMediaMarkupInput): string {
  const href = escapeMediaHtml(input.href);
  const src = escapeMediaHtml(input.src);
  const alt = escapeMediaHtml(input.alt);
  const caption = escapeMediaHtml(input.caption);
  return `<a class="approved-media-trigger" href="${href}" target="_blank" rel="noopener" referrerpolicy="no-referrer" data-approved-media data-media-caption="${caption}" aria-label="Open full image: ${alt}"><img src="${src}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></a>`;
}

const initializedDocuments = new WeakSet<Document>();

function ensureViewer(documentRoot: Document): HTMLDialogElement {
  const existing = documentRoot.querySelector<HTMLDialogElement>("[data-approved-media-viewer]");
  if (existing) return existing;
  const dialog = documentRoot.createElement("dialog");
  dialog.className = "route-lightbox approved-media-viewer";
  dialog.setAttribute("data-approved-media-viewer", "");
  dialog.setAttribute("aria-labelledby", "approved-media-viewer-title");
  dialog.innerHTML = `<div class="route-lightbox__panel">
    <header class="route-lightbox__header">
      <div><p class="route-lightbox__eyebrow">Approved case-file image</p><p class="route-lightbox__counter" data-approved-media-counter aria-live="polite"></p><h2 id="approved-media-viewer-title" data-approved-media-title>Approved image</h2></div>
      <button class="route-lightbox__close" type="button" data-approved-media-close>Close</button>
    </header>
    <div class="route-lightbox__stage">
      <button class="route-lightbox__nav route-lightbox__nav--previous" type="button" data-approved-media-previous aria-label="Previous image">Previous</button>
      <img class="route-lightbox__image" data-approved-media-image src="" alt="" />
      <button class="route-lightbox__nav route-lightbox__nav--next" type="button" data-approved-media-next aria-label="Next image">Next</button>
    </div>
    <div class="route-lightbox__footer"><p class="route-lightbox__caption" data-approved-media-caption></p><a class="route-lightbox__original" data-approved-media-original href="#" target="_blank" rel="noopener" referrerpolicy="no-referrer">Open original image</a></div>
  </div>`;
  documentRoot.body.append(dialog);
  return dialog;
}

function mediaFromTrigger(trigger: HTMLAnchorElement): ApprovedMediaItem | null {
  const image = trigger.querySelector<HTMLImageElement>("img");
  const href = trigger.getAttribute("href")?.trim() ?? "";
  const src = image?.getAttribute("src")?.trim() ?? "";
  const alt = image?.getAttribute("alt")?.trim() ?? "";
  const caption = trigger.dataset.mediaCaption?.trim()
    || trigger.closest("figure")?.querySelector("figcaption")?.textContent?.trim()
    || alt;
  if (!image || !href || !src || !alt) return null;
  return { href, src, alt, caption, trigger };
}

function galleryFor(trigger: HTMLAnchorElement): { title: string; items: ApprovedMediaItem[]; index: number } | null {
  const gallery = trigger.closest<HTMLElement>("[data-media-gallery]");
  if (!gallery) return null;
  const items = [...gallery.querySelectorAll<HTMLAnchorElement>("a[data-approved-media]")]
    .filter((candidate) => candidate.closest("[data-media-gallery]") === gallery)
    .map(mediaFromTrigger)
    .filter((item): item is ApprovedMediaItem => item !== null);
  const index = items.findIndex((item) => item.trigger === trigger);
  if (index < 0) return null;
  return {
    title: gallery.dataset.mediaGalleryTitle?.trim()
      || gallery.getAttribute("aria-label")?.trim()
      || "Approved image",
    items,
    index,
  };
}

export function initializeApprovedMediaViewer(documentRoot: Document = document): void {
  if (initializedDocuments.has(documentRoot)) return;
  const dialog = ensureViewer(documentRoot);
  if (typeof dialog.showModal !== "function") return;
  const title = dialog.querySelector<HTMLElement>("[data-approved-media-title]");
  const image = dialog.querySelector<HTMLImageElement>("[data-approved-media-image]");
  const caption = dialog.querySelector<HTMLElement>("[data-approved-media-caption]");
  const counter = dialog.querySelector<HTMLElement>("[data-approved-media-counter]");
  const previous = dialog.querySelector<HTMLButtonElement>("[data-approved-media-previous]");
  const next = dialog.querySelector<HTMLButtonElement>("[data-approved-media-next]");
  const close = dialog.querySelector<HTMLButtonElement>("[data-approved-media-close]");
  const original = dialog.querySelector<HTMLAnchorElement>("[data-approved-media-original]");
  if (!title || !image || !caption || !counter || !previous || !next || !close || !original) return;

  let items: ApprovedMediaItem[] = [];
  let index = 0;
  let trigger: HTMLAnchorElement | null = null;
  let galleryTitle = "Approved image";
  let pointerStartX: number | null = null;
  let pointerStartY: number | null = null;
  let pointerId: number | null = null;

  const clearPointer = (): void => {
    pointerStartX = null;
    pointerStartY = null;
    pointerId = null;
  };
  const render = (): void => {
    const item = items[index];
    if (!item) return;
    title.textContent = galleryTitle;
    counter.textContent = `Image ${index + 1} of ${items.length}`;
    image.src = item.href;
    image.alt = item.alt;
    caption.textContent = item.caption;
    original.href = item.href;
    const singleton = items.length <= 1;
    previous.hidden = singleton;
    previous.disabled = singleton;
    next.hidden = singleton;
    next.disabled = singleton;
  };
  const navigate = (delta: -1 | 1): void => {
    index = cycleApprovedMediaIndex(index, delta, items.length);
    render();
  };
  const open = (selected: ReturnType<typeof galleryFor>, selectedTrigger: HTMLAnchorElement): void => {
    if (!selected) return;
    items = selected.items;
    index = selected.index;
    galleryTitle = selected.title;
    trigger = selectedTrigger;
    clearPointer();
    render();
    dialog.showModal();
    close.focus();
  };

  documentRoot.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-approved-media]")
      : null;
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const selected = galleryFor(anchor);
    if (!selected) return;
    event.preventDefault();
    open(selected, anchor);
  });
  documentRoot.addEventListener("keydown", (event) => {
    if ((event.key !== " " && event.key !== "Spacebar") || event.repeat) return;
    const anchor = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-approved-media]")
      : null;
    if (!anchor || documentRoot.activeElement !== anchor) return;
    const selected = galleryFor(anchor);
    if (!selected) return;
    event.preventDefault();
    open(selected, anchor);
  });
  previous.addEventListener("click", () => navigate(-1));
  next.addEventListener("click", () => navigate(1));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
    else if (event.key === "Escape") { event.preventDefault(); dialog.close(); }
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    const restore = trigger?.isConnected ? trigger : null;
    trigger = null;
    clearPointer();
    restore?.focus();
  });
  image.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerId = event.pointerId;
    image.setPointerCapture?.(event.pointerId);
  });
  image.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId || pointerStartX === null || pointerStartY === null) return;
    const startX = pointerStartX;
    const horizontal = event.clientX - pointerStartX;
    const vertical = event.clientY - pointerStartY;
    clearPointer();
    if (Math.abs(horizontal) < Math.abs(vertical) * 1.2) return;
    const delta = swipePhotoDelta(startX, event.clientX);
    if (delta) navigate(delta);
  });
  image.addEventListener("pointercancel", clearPointer);
  image.addEventListener("lostpointercapture", clearPointer);
  image.addEventListener("dragstart", (event) => event.preventDefault());
  initializedDocuments.add(documentRoot);
}
