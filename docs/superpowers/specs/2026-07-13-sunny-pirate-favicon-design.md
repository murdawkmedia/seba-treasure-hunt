# Sunny Pirate Mystery Chest Favicon Design

**Date:** July 13, 2026  
**Status:** Approved design direction  
**Approved by:** Project owner

## Purpose

Replace the existing money-bag emoji favicon with a distinctive campaign mark for **Tim Lost Something?** The favicon should connect visually to the “Always Sunny in Seba” badge while making the treasure-hunt theme playful and immediately recognizable.

## Approved Mark

The favicon is a simplified **Sunny Pirate Mystery Chest** badge with these elements:

- the rounded-top, pointed-base silhouette used by the “Always Sunny in Seba” badge family;
- a cream outer field, forest-green centre, dark-green keyline and warm-gold accent line;
- a gold sun at the top, dressed as a friendly pirate with a dark pirate hat, one visible eye, one oval eyepatch with a single curved strap, and a simple grin;
- two complete cream question marks in the open left and right side pockets;
- the question marks tilted outward by 22 degrees so their curves, stems and dots remain fully visible inside the shield;
- a simplified gold-and-brown treasure chest at the bottom; and
- open visual space between the sun, question marks and chest so none of the symbols overlap.

The icon contains no words, letters, initials, skulls, weapons or fine decorative texture. Those details would reduce clarity at browser-tab size.

## Visual Hierarchy

The mark reads in this order:

1. Seba-style shield silhouette;
2. gold pirate sun;
3. paired question marks;
4. treasure chest.

At 16 pixels, the shield, gold sun and chest colour blocks may dominate, while the paired question marks must remain visibly separate cream marks. At 32 pixels and above, the pirate hat and eyepatch should become recognizable.

## Palette

Use the existing site palette:

- Forest green: `#174637`
- Deep green: `#123b30`
- Near-black green: `#102a22`
- Warm gold: `#f2ad25`
- Gold accent: `#e7a72a`
- Chest orange: `#d88622`
- Chest brown: `#ae5d1d`
- Cream: `#fff1d2`

Minor antialiasing shades may be introduced during rasterization, but the source artwork should remain flat, high-contrast and free of gradients except for a subtle chest fill if it remains legible at small sizes.

## Asset Architecture

Create one deterministic vector source and derive all raster assets from it:

- `assets/favicon.svg` — canonical source and modern browser favicon;
- `assets/favicon-32x32.png` — standard raster fallback;
- `assets/apple-touch-icon.png` — 180×180 touch icon;
- `assets/favicon-192x192.png` — installable-site icon;
- `assets/favicon-512x512.png` — high-resolution installable-site icon; and
- `favicon.ico` — multi-resolution legacy favicon containing 16×16, 32×32 and 48×48 images.

The SVG should use a square `viewBox` with transparent corners outside the shield. Preserve generous edge padding so the outer border is not clipped by circular or rounded browser masks.

## Website Integration

Every public and authenticated HTML page should reference the same icon set. Remove the current money-bag emoji data-URI favicon from pages that contain it and add the shared favicon references to pages that currently have no favicon.

Add or update a small web app manifest only if the site already uses, or will directly consume, installable-site metadata. Do not introduce unrelated progressive-web-app behaviour.

This change does not alter the visible “Always Sunny in Seba” badge, its links, campaign copy, authentication, hunt tools or Cloudflare configuration.

## Accessibility and Compatibility

- Keep the favicon decorative; no page content or meaning may depend on it.
- Use valid SVG with no external font, script, remote image or embedded tracking dependency.
- Preserve sufficient light/dark contrast in browsers with light and dark tab bars.
- Ensure transparent corners and no clipped border at each generated size.
- Keep the icon recognizable when favicons are disabled or unsupported by retaining meaningful page titles.

## Verification

Before completion:

1. validate that the SVG parses and renders without external dependencies;
2. confirm the PNG and ICO dimensions and colour modes;
3. inspect the mark at 16, 32, 48, 64, 180, 192 and 512 pixels;
4. confirm both question marks are complete and do not touch the sun, hat or chest;
5. confirm the eyepatch reads as one oval patch and one curved strap, not crossed lines or a letter;
6. confirm every HTML page resolves the shared favicon assets without a 404;
7. verify the previous money-bag data URI is absent; and
8. run the existing automated test, typecheck and production build suites.

## Approved Scope

This specification covers the favicon and its required browser/touch variants only. A larger campaign logo, merchandise mark, animated favicon or redesign of the existing Seba badge is outside this change.
