# 💰 The Great Seba Beach Treasure Hunt

**Tim lost his ID, ~$5,000 in cash, and two diamond rings** somewhere along a 10-stop
side-by-side tour of the Seba Beach properties on Lake Wabamun, Alberta.

**The deal: find it, keep the cash and the rings. He just needs his ID back.**

🔴 **Live site:** https://murdawkmedia.github.io/seba-treasure-hunt/

## Pages

| Page | What's on it |
|------|--------------|
| [`index.html`](index.html) | The deal, the story, the last-known photo of the loot, rules, hours, contacts |
| [`route.html`](route.html) | The 10-stop route: trail map, 58 GPS-tagged photos, per-stop clues |
| [`interview.html`](interview.html) | Tim's full 20-question interview — the clues are in his answers |

## Tech (deliberately simple)

- **Plain static site** — no build step. HTML + `css/style.css` + `js/site.js` (index only).
- **Maps:** [Leaflet](https://leafletjs.com/) (vendored in `js/vendor/leaflet/`) + Esri World Imagery tiles — no API keys.
- **Photos:** web-optimized to ~1600px in `assets/` — route photos in `assets/route/stop-NN/`.
  Route photos carry **GPS EXIF on purpose**: the coordinates are part of the game
  (open any photo's 📍 Map link and stand where the side-by-side stood).
- **Radio partner:** 840 CFCW — logo + Friday update mentions sitewide.

## Editing

- Home-base property cards + territory map pins: the `SPOTS`/`LANDMARKS`/`PARKING` arrays in [`js/site.js`](js/site.js).
- Route stops/photos: regenerate from the curation data (see `planning/` — not in the repo) or edit `route.html` directly.
- Hunt facts (prize, hours, contacts): `index.html` — sections `#deal`, `#rules`, `#found`, `#official-rules`.

## Local preview

```bash
python -m http.server 8080
# open http://localhost:8080
```

## Deploy

GitHub Pages, branch `main`, root. `.nojekyll` present.

---

*A SebaHub Production · Radio partner 840 CFCW · Map data © OpenStreetMap contributors · Imagery © Esri.
The treasure is real. Hunt hours 9 AM–8 PM. Park where yer told. Don't set anything on fire.*
