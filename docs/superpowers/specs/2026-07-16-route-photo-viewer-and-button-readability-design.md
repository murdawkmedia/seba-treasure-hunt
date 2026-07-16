# Route Photo Viewer and Button Readability Design

**Date:** July 16, 2026  
**Status:** Approved design  
**Target:** Validation first; production requires separate approval

## Purpose

Polish the documentary release candidate where validation review exposed three issues:

1. secondary action buttons are difficult to read and visually inconsistent;
2. a disposable validation-only approved report appears as the homepage's latest update;
3. route photographs open as raw files instead of a focused, mobile-friendly viewer.

The refinement must preserve the documentary case-file design, all route content, Hunter route gating, legal flows, reporting, moderation, Ops, and production data.

## Button System

The homepage's four primary case actions use one solid-gold treatment with dark text, consistent borders, spacing, shadows, hover states, and focus states. “Read official updates” and “Rules and safety” receive the same readable treatment as “Start here” and “Report something.”

The safe-participation actions also use readable filled treatments. No cream text may appear on a cream or pale-gold background.

The refinement will audit every public button and button-like link against these rules:

- normal text contrast meets WCAG 2.1 AA at 4.5:1 or better;
- control boundaries and focus indicators meet 3:1 or better;
- solid, secondary, and dark-surface variants have explicit foreground and background colours rather than inheriting ambiguous context;
- hover, active, disabled, and keyboard-focus states remain legible;
- button labels wrap cleanly on narrow screens without clipping or horizontal overflow;
- visually equal actions use equal styling and sizing.

The private Ops console is outside the visual-restyling scope unless a shared change creates a regression.

## Validation Data Cleanup

Remove only the identified validation test publication whose visible title and body are “test,” together with its linked validation-only public media relationship. The cleanup must target the validation D1 database and must not touch production.

Before mutation, record the opaque update identifier and verify the environment sentinel. After mutation, confirm:

- the test item no longer appears in `/api/v1/updates`, the homepage, or `/updates`;
- unrelated validation reports, users, legal acceptances, Case Notes, and official updates remain unchanged;
- no production database command was issued.

If the test publication originated from a private report, retain the private report for audit unless its existing workflow provides a safe, deliberate validation-only withdrawal. Public media objects that become unreferenced may be removed only through the project's established cleanup path.

## Waypoint Photo Viewer

### Interaction model

Each existing route-photo link remains a functional progressive fallback. When JavaScript is available, activating a photo opens a single shared native `<dialog>` lightbox instead of navigating away.

The viewer is scoped to the selected waypoint. Previous and Next move only through that waypoint's photographs. It never carries the visitor into another waypoint's gallery.

The viewer contains:

- the selected image using its existing descriptive alternative text;
- the existing photo caption;
- a visible “Photo X of Y” counter;
- Previous, Next, and Close controls;
- an “Open original image” link for the unscaled source;
- the waypoint name as contextual heading text.

Previous and Next are disabled or omitted when a waypoint has only one photograph. Navigation wraps within a multi-image waypoint so repeated browsing remains predictable.

### Desktop presentation

The dialog appears as a centred case-file panel above a dark translucent backdrop. The image is contained within the available viewport and never cropped. The caption and controls remain visible without forcing the image beyond the viewport.

### Mobile presentation

On narrow or short screens, the dialog uses nearly the full viewport with safe-area-aware padding. The image remains `object-fit: contain`; controls have at least 44-by-44-pixel touch targets; captions scroll independently when necessary. Horizontal swipe gestures move between photos inside the current waypoint, while vertical page scrolling is suppressed only while the dialog is open.

### Keyboard and assistive technology

- Enter or Space on a focused thumbnail opens the viewer through the native link interaction.
- Escape closes the dialog.
- Left and Right Arrow move within the current waypoint.
- Focus moves to the Close control on open and returns to the activating thumbnail on close.
- Tab focus stays within the native modal dialog.
- The dialog has an accessible name and description tied to the waypoint, counter, and caption.
- Backdrop activation closes the dialog without making the image or content area an accidental close target.
- Reduced-motion preferences disable nonessential transitions.
- With JavaScript unavailable, the existing original-image links continue to work.

## Architecture

Add one small route-photo-viewer client module and one shared dialog in `route.html`. The module discovers galleries from the existing `.stop[data-waypoint-id]` and `.stop-gallery` structure, so no waypoint identifiers, photo URLs, captions, or route ordering need to change.

The viewer state contains only:

- the active waypoint gallery;
- the active photo index;
- the element that opened the dialog;
- the starting touch coordinate for a bounded swipe gesture.

It performs no API calls, creates no database records, reads no authentication data, and does not modify route gating. The build allowlist will publish the new client bundle using the project's existing TypeScript/esbuild pipeline.

## Error Handling and Fallbacks

- If `<dialog>` or the route module cannot initialize, photo links retain their existing new-tab behaviour.
- If an image fails to load inside the dialog, the caption, close control, and original-image link remain available.
- Rapid Previous/Next actions update one authoritative viewer state and cannot create multiple dialogs.
- A malformed gallery item is skipped rather than breaking every route gallery.
- Closing and reopening resets swipe state and restores focus safely.

## Testing and Acceptance

Implementation follows test-driven development. Automated checks will cover:

- the four homepage actions and safe-participation actions use approved readable variants;
- computed foreground/background contrast for every public button state meets the defined thresholds;
- all 61 route photos retain their source URLs and alternative text;
- every route gallery initializes independently and navigation never crosses waypoint boundaries;
- single-photo waypoints expose no misleading navigation;
- Escape, arrow keys, focus return, backdrop close, and original-link fallback;
- mobile dimensions, touch targets, swipe threshold, safe-area layout, and reduced motion;
- JavaScript failure leaves usable original-image links;
- validation cleanup removes only the identified test publication.

The validation deployment will receive desktop and mobile visual review, keyboard review, 200% zoom checks, browser-console inspection, broken-link scanning, and the existing unified-shell, privacy, waiver, sponsor, route-gating, and public-output suites. Production remains unchanged until Murphy explicitly approves promotion.

## Out of Scope

- changing route stories, waypoint identifiers, coordinates, or gated Google Maps links;
- adding comments, likes, downloads, or cross-waypoint slideshows;
- editing authoritative Privacy Policy, Media Notice, or Waiver language;
- wiping validation accounts or submissions beyond the identified test publication;
- deploying the refinement to production.
