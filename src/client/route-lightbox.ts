export function cyclePhotoIndex(current: number, delta: -1 | 1, length: number): number {
  if (!Number.isInteger(current) || !Number.isInteger(length) || length <= 1) return 0;
  return (current + delta + length) % length;
}

export function swipePhotoDelta(startX: number | null, endX: number, threshold = 48): -1 | 0 | 1 {
  if (startX === null || !Number.isFinite(endX)) return 0;
  const distance = endX - startX;
  if (Math.abs(distance) < threshold) return 0;
  return distance < 0 ? 1 : -1;
}

export interface RoutePhoto {
  readonly href: string;
  readonly src: string;
  readonly alt: string;
  readonly caption: string;
  readonly trigger: HTMLAnchorElement;
}

export interface ViewerState {
  gallery: readonly RoutePhoto[];
  waypointName: string;
  index: number;
  trigger: HTMLAnchorElement | null;
  touchStartX: number | null;
}

interface RouteGallery {
  readonly photos: readonly RoutePhoto[];
  readonly waypointName: string;
}

const initializedDialogs = new WeakSet<HTMLDialogElement>();

function collectRouteGalleries(): RouteGallery[] {
  const galleries: RouteGallery[] = [];

  for (const stop of document.querySelectorAll<HTMLElement>(".stop[data-waypoint-id]")) {
    const waypointName = stop.querySelector<HTMLElement>(".stop-name")?.textContent?.trim() ?? "";
    if (!waypointName) continue;

    const photos: RoutePhoto[] = [];
    for (const trigger of stop.querySelectorAll<HTMLAnchorElement>(".stop-gallery .photo > a")) {
      const image = trigger.querySelector<HTMLImageElement>("img");
      const caption = trigger.closest<HTMLElement>(".photo")?.querySelector<HTMLElement>("figcaption");
      const href = trigger.getAttribute("href")?.trim() ?? "";
      const src = image?.getAttribute("src")?.trim() ?? "";
      const alt = image?.getAttribute("alt")?.trim() ?? "";
      const captionText = caption?.textContent?.trim() ?? "";
      if (!image || !href || !src || !alt || !caption || !captionText) continue;
      photos.push({ href, src, alt, caption: captionText, trigger });
    }

    if (photos.length > 0) galleries.push({ photos, waypointName });
  }

  return galleries;
}

export function initializeRouteLightbox(): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-route-lightbox]");
  if (!dialog || initializedDialogs.has(dialog) || typeof dialog.showModal !== "function") return;

  const title = dialog.querySelector<HTMLElement>("#route-lightbox-title");
  const image = dialog.querySelector<HTMLImageElement>("[data-route-lightbox-image]");
  const caption = dialog.querySelector<HTMLElement>("[data-route-lightbox-caption]");
  const counter = dialog.querySelector<HTMLElement>("[data-route-lightbox-counter]");
  const previous = dialog.querySelector<HTMLButtonElement>("[data-route-lightbox-previous]");
  const next = dialog.querySelector<HTMLButtonElement>("[data-route-lightbox-next]");
  const close = dialog.querySelector<HTMLButtonElement>("[data-route-lightbox-close]");
  const original = dialog.querySelector<HTMLAnchorElement>("[data-route-lightbox-original]");
  if (!title || !image || !caption || !counter || !previous || !next || !close || !original) return;

  const galleries = collectRouteGalleries();
  if (galleries.length === 0) return;

  const state: ViewerState = {
    gallery: [],
    waypointName: "",
    index: 0,
    trigger: null,
    touchStartX: null,
  };
  let gestureStartY: number | null = null;
  let activePointerId: number | null = null;

  const clearGesture = (): void => {
    state.touchStartX = null;
    gestureStartY = null;
    activePointerId = null;
  };

  const render = (): void => {
    const photo = state.gallery[state.index];
    if (!photo) return;
    title.textContent = state.waypointName;
    counter.textContent = `Photo ${state.index + 1} of ${state.gallery.length}`;
    image.src = photo.src;
    image.alt = photo.alt;
    caption.textContent = photo.caption;
    original.href = photo.href;
    const singleton = state.gallery.length <= 1;
    previous.hidden = singleton;
    previous.disabled = singleton;
    next.hidden = singleton;
    next.disabled = singleton;
  };

  const navigate = (delta: -1 | 1): void => {
    if (state.gallery.length <= 1) return;
    state.index = cyclePhotoIndex(state.index, delta, state.gallery.length);
    render();
  };

  const open = (gallery: RouteGallery, index: number, trigger: HTMLAnchorElement): void => {
    state.gallery = gallery.photos;
    state.waypointName = gallery.waypointName;
    state.index = index;
    state.trigger = trigger;
    clearGesture();
    render();
    dialog.showModal();
    close.focus();
  };

  for (const gallery of galleries) {
    gallery.photos.forEach((photo, index) => {
      photo.trigger.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        open(gallery, index, photo.trigger);
      });
      photo.trigger.addEventListener("keydown", (event) => {
        if ((event.key !== " " && event.key !== "Spacebar") || event.repeat || document.activeElement !== photo.trigger) return;
        event.preventDefault();
        open(gallery, index, photo.trigger);
      });
    });
  }

  previous.addEventListener("click", () => navigate(-1));
  next.addEventListener("click", () => navigate(1));
  close.addEventListener("click", () => dialog.close());

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigate(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigate(1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    const trigger = state.trigger;
    clearGesture();
    state.trigger = null;
    trigger?.focus();
  });

  image.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    state.touchStartX = event.clientX;
    gestureStartY = event.clientY;
    activePointerId = event.pointerId;
    image.setPointerCapture?.(event.pointerId);
  });
  image.addEventListener("pointerup", (event) => {
    if (activePointerId !== event.pointerId || state.touchStartX === null || gestureStartY === null) return;
    const horizontalDistance = event.clientX - state.touchStartX;
    const verticalDistance = event.clientY - gestureStartY;
    const startX = state.touchStartX;
    clearGesture();
    if (Math.abs(horizontalDistance) < Math.abs(verticalDistance) * 1.2) return;
    const delta = swipePhotoDelta(startX, event.clientX);
    if (delta !== 0) navigate(delta);
  });
  image.addEventListener("pointercancel", clearGesture);
  image.addEventListener("lostpointercapture", clearGesture);
  image.addEventListener("dragstart", (event) => event.preventDefault());

  initializedDialogs.add(dialog);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeRouteLightbox, { once: true });
  } else {
    initializeRouteLightbox();
  }
}
