# 💰 The Great Seba Beach Treasure Hunt

A fun, cheesy, unapologetically pirate-themed treasure-hunt website for Seba Beach, Alberta (west end of Wabamun Lake).

**Premise:** *Captain Tim lost his wallet in the woods* — and a lost wallet is basically buried treasure. The hunt threads together four real local spots in the SebaHub ecosystem:

| # | Spot | Nickname | Site |
|---|------|----------|------|
| 1 | SebaHub | Skull Rock HQ | [sebahub.com](https://sebahub.com) |
| 2 | SebaStays | Cozy Cove | [sebastays.com](https://sebastays.com) |
| 3 | Village Vows (The Forest Lodge) | Lovers' Lagoon | [villagevows.com](https://villagevows.com) |
| 4 | Kokanee Springs RV Park | Wheelhouse Wharf | (18-lot RV park) |

## Tech (deliberately simple)

- **Plain static site** — `index.html` + `css/style.css` + `js/site.js`. No build step.
- **Interactive satellite map** via [Leaflet](https://leafletjs.com/) with **Esri World Imagery** tiles (free, no API key — works great on GitHub Pages).
- Map markers and property cards read from a single `SPOTS` array in `js/site.js`, so they never drift apart.
- Pictures/videos are **placeholders** for now (styled "coming soon" tiles).

## Editing content

- **Copy, riddles, nicknames, links:** edit the `SPOTS`/`LANDMARKS` arrays in [`js/site.js`](js/site.js) and the section text in [`index.html`](index.html).
- **Coordinates:** each spot has `lat`/`lng` in `SPOTS`. They're approximate on purpose ("we're pirates, not surveyors"). Tune by dragging around the map or dropping a pin in Google/OpenStreetMap and pasting the decimal degrees.
- **Real photos:** drop files in `assets/` and swap the `.ph` placeholder blocks for `<img>` tags.

## Local preview

Any static server works, e.g.:

```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Deploy (GitHub Pages)

Served from the repo root on the default branch. In **Settings → Pages**, set Source = *Deploy from a branch*, branch = `main`, folder = `/ (root)`. The `.nojekyll` file keeps Pages from running Jekyll over the static files.

---

*A Murdawk Media production. The treasure is friendship (and also a wallet). Map data © OpenStreetMap contributors · Imagery © Esri.*
