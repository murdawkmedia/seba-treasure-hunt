import {
  cycleApprovedMediaIndex,
  initializeApprovedMediaViewer,
  swipePhotoDelta,
} from "./approved-media-viewer";

export const cyclePhotoIndex = cycleApprovedMediaIndex;
export { swipePhotoDelta };

export function initializeRouteLightbox(): void {
  for (const stop of document.querySelectorAll<HTMLElement>(".stop[data-waypoint-id]")) {
    const gallery = stop.querySelector<HTMLElement>(".stop-gallery");
    const waypointName = stop.querySelector<HTMLElement>(".stop-name")?.textContent?.trim() ?? "Waypoint photos";
    if (!gallery) continue;
    gallery.setAttribute("data-media-gallery", "");
    gallery.dataset.mediaGalleryTitle = waypointName;
    for (const trigger of gallery.querySelectorAll<HTMLAnchorElement>(".photo > a")) {
      const caption = trigger.closest("figure")?.querySelector("figcaption")?.textContent?.trim() ?? "";
      trigger.setAttribute("data-approved-media", "");
      if (caption) trigger.dataset.mediaCaption = caption;
    }
  }

  const dialog = document.querySelector<HTMLDialogElement>("[data-route-lightbox]");
  if (dialog) {
    dialog.setAttribute("data-approved-media-viewer", "");
    dialog.querySelector("#route-lightbox-title")?.setAttribute("data-approved-media-title", "");
    dialog.querySelector("[data-route-lightbox-image]")?.setAttribute("data-approved-media-image", "");
    dialog.querySelector("[data-route-lightbox-caption]")?.setAttribute("data-approved-media-caption", "");
    dialog.querySelector("[data-route-lightbox-counter]")?.setAttribute("data-approved-media-counter", "");
    dialog.querySelector("[data-route-lightbox-previous]")?.setAttribute("data-approved-media-previous", "");
    dialog.querySelector("[data-route-lightbox-next]")?.setAttribute("data-approved-media-next", "");
    dialog.querySelector("[data-route-lightbox-close]")?.setAttribute("data-approved-media-close", "");
    dialog.querySelector("[data-route-lightbox-original]")?.setAttribute("data-approved-media-original", "");
  }
  initializeApprovedMediaViewer(document);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeRouteLightbox, { once: true });
  } else {
    initializeRouteLightbox();
  }
}
