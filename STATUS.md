# STATUS — The Great Seba Beach Treasure Hunt

_Last updated: 2026-07-07_

## What this is
A fun, cheesy, pirate-themed treasure-hunt website for Seba Beach, AB. Premise: **"Captain Tim lost his wallet in the woods"** → the wallet is buried treasure, and the hunt threads through four real SebaHub-ecosystem spots on Wabamun Lake. Static site, GitHub Pages, `murdawkmedia`, public.

## Current state (shipped v1)
- Single-page static site: `index.html` + `css/style.css` + `js/site.js`. No build step.
- Interactive **satellite treasure map** (Leaflet, **vendored locally** in `js/vendor/leaflet/` — no CDN dependency; Esri World Imagery tiles, no API key).
- Four property "islands" as map pins + cards, plus three real bonus landmark markers. Map pins and cards share one `SPOTS` data source in `js/site.js`.
- Pictures/videos are **styled placeholder tiles** ("coming soon"), per the brief.
- Palette + hero badge lifted from the existing "Always Sunny in Seba" badge (`assets/seba-badge.png`).
- Verified locally in the Claude preview: 4 cards, 6 gallery tiles, 7 map markers, fonts/theme applied, no console errors.

## The four spots (nicknames + verified-ish coords)
| # | Spot | Nickname | Coord (lat,lng) | Confidence | Link |
|---|------|----------|-----------------|-----------|------|
| 1 | SebaHub | Skull Rock HQ | 53.559, -114.7362 | low (est., village core / old school) | sebahub.com |
| 2 | SebaStays | Cozy Cove | 53.5626, -114.7393 | med (Forest Lodge, pin nudged) | sebastays.com |
| 3 | Village Vows | Lovers' Lagoon | 53.56201, -114.73865 | med (Forest Lodge, 53117 Hwy 31) | villagevows.com |
| 4 | Kokanee Springs RV | Wheelhouse Wharf | 53.5645731, -114.7464346 | high (53118 Hwy 31) | Google Maps link |

Coords geocoded via OpenStreetMap Nominatim / geocoder.ca and adversarially bounding-box-checked against the Seba Beach anchor (53.5648, -114.7297). **Note:** SebaStays and Village Vows are the *same* Forest Lodge property (two brands); SebaStays' pin is nudged ~30–40 m so both markers are tappable.

## Decisions in force
- **Map:** OpenStreetMap/Leaflet + Esri satellite tiles (no API key) chosen over Google Maps because it needs no key and suits "keep it open" + GitHub Pages.
- **Leaflet vendored locally** rather than CDN, for resilience.
- Kokanee has no confirmed website, so its link points to a Google Maps search (safe) rather than a possibly-dead domain.
- Coordinates are intentionally approximate ("we're pirates, not surveyors"); confidence noted above.

## Open / next (awaiting Tim's "more details as we go")
- **Real photos/videos** to replace placeholder tiles (drop in `assets/`, swap `.ph` blocks for `<img>`/`<video>`).
- Confirm/refine exact pin locations, especially **SebaHub** (low confidence) — drop a precise pin if desired.
- Decide the **prize / how to claim** the treasure (currently "coming soon").
- Optional: custom domain (e.g. a sebahub.com subdomain) instead of the `github.io` path.
- Optional: repo/URL rename if a different public name is preferred.

## Deploy
Repo root on `main` → GitHub Pages (Source = branch `main`, `/root`). `.nojekyll` present. See README for details.
