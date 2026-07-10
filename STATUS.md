# STATUS — The Great Seba Beach Treasure Hunt

_Last updated: 2026-07-10_

## What this is (v5 — the Lost Wallet overhaul)
Public promo site for a **REAL lost-treasure hunt** at Seba Beach, AB: Tim lost his **ID (elastic-band bundle), ~$5,000 cash, and two diamond rings (small baggie)** along a real 10-stop side-by-side tour on **Thu Jul 9, 2026**. **Find it → keep the cash + rings; return the ID** to SebaHub (162 Second Ave) — that's the whole deal. May rise to **$10,000** if not found quickly. Static site, GitHub Pages, `murdawkmedia/seba-treasure-hunt` (public). **Live: https://murdawkmedia.github.io/seba-treasure-hunt/**

v5 replaced the earlier "buried coffee can / weekday-double" campaign per Tim (2026-07-10): the wallet story from the co-worker's asset hub (`sebatreasur-b8njza3s.manus.space` /lost-wallet + /interview) is now THE story. Kept: pirate voice, 9 AM–8 PM hours, Pirate's Code, CFCW partner, sponsors section, Fine Print (all updated to wallet framing).

## Site structure (3 pages)
- **index.html** — hub: Help Tim Find His ID hero → The Deal (cash/rings/ID cards) → **evidence photo** → the Story → route teaser (10 stops, 4 hot) → territory map (4 properties + parking + landmarks) → property cards → Rules + hours → How to Play → **Contact (Tim 780-909-6544 personal cell; Casey casey@sebahub.com — phone REMOVED per Tim 2026-07-10: publish Casey's number only if it appears on sebahub.com, and it does not)** → festival/golf-balls → gallery → vision → sponsor → Fine Print.
- **route.html** — the flagship: Leaflet trail map (10 numbered pins at REAL EXIF centroids + polyline), what-to-look-for, 10 stop sections each with Tim's quote + factual photo description + GPS-tagged gallery (58 photos, per-photo Google Maps links).
- **interview.html** — full 20-question transcript (verbatim), 11 Hunter's Notes behind a toggle, evidence photo, CTAs.

## The asset ingest (2026-07-10, "the tub")
- **Sources:** the 2 manus.space pages (canonical), `planning/In the Woods Execution Blueprint.pdf` (festival execution deck — image-based, rendered + ingested; EXIF-scrub advice deliberately IGNORED per Tim: GPS is part of the game), 169 iPhone files + 15 Pixel files from Downloads.
- **Originals** now live in `source-media/originals/` (tour/ + cash-evidence/) — **gitignored** (713 MB). `planning/` also gitignored (transcript, social toolkit source, blueprint brief, route-data.json, scripts, marketing kit). Downloads folders to be deleted after final verification.
- **Manifest pipeline** (`planning/build_manifest.py`): HEIC→JPEG, EXIF GPS/time extraction — **all 166 tour photos GPS-tagged**; real stop centroids computed (page's neat 53.59x/-114.6xx coords were placeholders ~5 km off).
- **Curation:** Workflow with 10 Sonnet reviewers (one/stop) + Opus finalizer → **58 keepers** of ~150, deduped, captioned, alt-texted. Privacy rejections honored: IMG_5166 (readable licence plate), 5026/5027 (readable business card), 5036/5073 (faces) — verified absent from `assets/route/`.
- **Production** (`planning/produce_route_assets.py`): 1600px q80 → `assets/route/stop-NN/` (~31 MB), **GPS re-embedded via piexif** (intentional), IMG_5069 top-cropped per curation. `planning/route-data.json` = single source for route.html.
- **Evidence photo:** IMG_5019 → `assets/photos/evidence-cash.jpg` with the **ID/VISA bundle blurred** (full-res barcodes + card were readable = identity-theft risk; cash/keys/flyer left crisp; caption owns the redaction). NO GPS re-embedded on this one.
- **Casey contact screenshot** (IMG_5024.PNG): extracted info only (Casey, "Seba SIC Principal") — raw screenshot NOT published. Published contact = **casey@sebahub.com** (Tim provided 2026-07-10); Casey's cell kept OFF the site per Tim's rule (verified not on sebahub.com — checked rendered homepage + /contact/about/get-involved/the-school + full local repo).
- **Route video (IMG_5128.MOV): unusable — 0.1-second fragment.** Placeholder tile on index; needs re-export from Tim's phone.
- **B-roll:** 2 Pixel shots published (Kokanee entrance sign, SEBAHUB IS OPEN banner) in the index gallery. The "cash-evidence" Pixel folder was actually property B-roll; real cash photos were IMG_5018–5020.

## Known data flags (for Tim/Casey to reconcile — not blocking)
Curation found the co-worker page's IMG→stop mapping doesn't match photo content for some stops: **S5** photos show the SebaHub road/store/playground/dome (not the locked gate); **S9** photos show the Kokanee driving-range grounds (not the pavilion beach); **S10** photos show the RV Pub & Grill (not the museum/school); part of **S3**'s first chunk looked like marina/town shots. Published copy keeps story names + factual photo descriptions (no wrong claims), and every photo's own 📍 map link is ground truth. 19 unassigned photos (incl. a 16:05 Kokanee-area segment 5113–5124) intentionally unpublished.

## Marketing kit (internal — `planning/marketing/`, gitignored)
Ready-to-post social copy (FB/IG/X/email/teaser + Friday one-liners), CFCW announcer reads + Tim's live call-in notes, print poster (`poster.html` + QR), 10 clue-board cards with per-stop QRs (`clue-board-cards.html`), launch README with the timeline (teaser Sat Jul 11 1 PM → full release ~Jul 14–15 → CFCW Jul 15–17 → Friday updates; owners Meg/Danny/Brianna/Murphy). **Move 5 (fabricated "someone got close" urgency post) deliberately excluded from ready-to-post copy and banned from the site** — team's call on social.

## Decisions in force
- Rings = **diamond** everywhere. Prize mechanics = **escalation** ("may rise to $10,000"), weekday-double retired. Coffee-can story fully retired.
- Route photos **keep GPS on purpose**; evidence photo does not. Personal cells published per Tim's explicit instruction, with "treat with respect" framing.
- No fabricated claims on the website, ever (escalation posts are social-side, team's call).
- Leaflet vendored; Esri tiles; no API keys. Marketing kit + originals never in the public repo.

## Open items
1. **Route video** — IMG_5128.MOV in the Drive export was a 0.1-second fragment (likely a Live Photo motion snippet or a bad Drive export), not the real clip. Tim re-exports/re-sends the actual video → replace the placeholder tile.
2. ~~Casey's email~~ ✅ casey@sebahub.com published (phone kept off per Tim's sebahub.com rule). Optional: hunt@sebahub.com photo-wall address (Move 9).
3. Stop-mapping flags above — awaiting Tim's local-knowledge answer on what the S5/S9/S10 photo locations actually are, then re-caption those galleries.
4. Fine Print legal sign-off; sponsor email (CTA still routes via sebahub.com).
5. ~~Wallet/ring close-ups~~ ✅ CLOSED per Tim 2026-07-10: no ring close-ups coming; the wallet exists only in the evidence photos we have. What-to-look-for stays text + evidence photo.

## Deploy
Repo root on `main` → GitHub Pages (branch `main`, `/root`), `.nojekyll`. Verify after push: index/route/interview 200, photo spot-checks, no "coffee can" remnants live.
