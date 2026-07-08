# STATUS — The Great Seba Beach Treasure Hunt

_Last updated: 2026-07-07_

## What this is
A fun/cheesy/pirate-themed promo site for a **REAL $5,000 cash treasure hunt** in the woods of Seba Beach, AB (north shore of Lake Wabamun). Marketing theme: **"Tim lost his wallet in the woods."** Static site, GitHub Pages, `murdawkmedia`, public. **Live: https://murdawkmedia.github.io/seba-treasure-hunt/**

## The hunt (public-facing facts baked into the site)
- **Prize:** $5,000 cash, wrapped in rubber bands, hidden in a plain **coffee can**. Buried **Thu Jul 9, 2026 (afternoon)** — hunt is on once it's in the ground.
- **Weekday double:** found on a **Mon/Tue/Wed → $10,000** (drives weekday visits).
- **Sweetener:** if unfound after ~2 weeks (~Jul 23), **+$5,000** added.
- **Rules (real):** no cutting trees, no fires, no digging in the driving range. Plus (playful, unattributed): no trucks/excavators/helicopters; park in designated areas; leave it better than you found it.
- **No complex clues** — just the map (playing field + parking) and the rules. Authentic **real photos/videos, no AI**; proof videos coming (Tim counting cash, burying it on his side-by-side).
- **Festival tie-in:** soft promo for the **"In the Woods" music festival**; the older **golf-balls-for-festival-tickets** idea runs quietly alongside (mentioned in the Festival section).

## Deliberately kept OFF the public site (internal planning context)
Team friction and names — Ian's property-damage worries, Samantha's logistics/security anxiety, partner **Stephanie / CSCW**, the two-day-notice scramble, and the photo **metadata/GPS-stripping** operational detail. None of this is published. (Ask before adding any of it.)

## Site sections (v3)
Hero (aerial + $5,000 flash + weekday-double) → **The Loot** ($5k/$10k/+$5k tiers) → The Legend (guerrilla-entrepreneur story) → **The Playing Field** map → The Four Spots (cards) → **The Pirate's Code** (rules) → How to Play + checklist → Festival tie-in → **Proof It's Real** (gallery).

## Photos (all REAL, GPS-EXIF stripped, ~2.2 MB in `assets/photos/`)
Pulled from each property's own local project folder, web-optimized (re-encode strips EXIF — audited, **no GPS on any file**):
- Hero = **`schoolhouse-wide`** aerial of Seba Beach / Hwy 31 / the lake (village-vows repo).
- Cards: SebaHub = InTheWoods community fair; SebaStays = Seba Beach marina aerial; Village Vows = lakeside wedding arch; Kokanee = camper-among-spruces.
- Gallery: Forest-Lodge woods deck, lakeside ceremony, community powwow (+ 3 "video coming soon" tiles).
- **Removed the two SebaStays `sunny-lake` images** — orphaned in `output/zip-assets`, unreferenced by the site, and AI-risk; SebaStays' own design.md mandates "real visuals, no AI." Swapped for confirmed-real shots.

## Map coordinates (corrected per owner; still approximate — "we're pirates, not surveyors")
| Spot | lat, lng | Confidence |
|------|----------|-----------|
| SebaHub (old Seba Beach School) | 53.5603733, -114.7397426 | **HIGH — owner-provided exact coord (2026-07-08).** Village-core side, east of Hwy 31 (the Kokanee/Lodge cluster is across the highway to the west). |
| Kokanee Springs RV | 53.5645731, -114.7464346 | high (OSM-named, 53118 Hwy 31) |
| Village Vows (Forest Lodge) | 53.5666, -114.7458 | med — placed just N of Kokanee per owner |
| SebaStays (Forest Lodge) | 53.567, -114.7451 | med — same lodge, nudged off Village Vows |

Map now framed as the **playing field**, treasure explicitly **not** marked; official boundary + parking pins to be added when cash is hidden Thursday. Landmark markers changed from ❌ to 🪧 (an X wrongly implied "treasure here"). Did **not** touch ResNexus (offered as fallback, but it holds booking data, not the school's GPS — unnecessary).

## Decisions in force
- Map = OpenStreetMap/Leaflet (**vendored locally**) + Esri satellite tiles (no API key). Kokanee links to a Google Maps search (no confirmed site).
- Coffee-can/cash facts, prize amounts, dates, and rules are stated plainly (cheese as garnish only) — these are real stakes.

## Open / next
1. ~~Confirm SebaHub's exact pin~~ ✅ DONE 2026-07-08 — owner gave exact school + parking coords.
2. **Playing-field boundary** — still to add (map polygon) when the cash is hidden Thu Jul 9. **Parking: two 🅿️ pins** (SebaHub school lot 53.559917,-114.739583 [owner DMS]; Kokanee lot at the main entrance by the RV Pub & Grill ~53.5633,-114.7400). Owner unsure of other lots / the boundary — add as confirmed.
3. **Real proof media** — Tim counting the $5k, side-by-side bury video, raw stills (screenshot to strip GPS before upload).
4. Decide claim mechanics (how a finder proves it / contacts you).
5. Optional: custom domain; repo/URL rename.

## Deploy
Repo root on `main` → GitHub Pages (branch `main`, `/root`). `.nojekyll` present. See README.
