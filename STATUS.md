# STATUS — The Great Seba Beach Treasure Hunt

_Last updated: 2026-07-08_

## What this is
A fun/cheesy/pirate-themed promo site for a **REAL $5,000 cash treasure hunt** in the woods of Seba Beach, AB (north shore of Lake Wabamun). Marketing theme: **"Tim lost his wallet in the woods."** Static site, GitHub Pages, `murdawkmedia`, public. **Live: https://murdawkmedia.github.io/seba-treasure-hunt/**

## The hunt (public-facing facts baked into the site)
- **Prize:** $5,000 cash, wrapped in rubber bands, hidden in a plain **coffee can**. Buried **Thu Jul 9, 2026 (afternoon)**; **hunt LAUNCHES Fri Jul 10 (tentative)** — not the moment it's buried.
- **Weekday double:** found on a **Mon/Tue/Wed → $10,000** (drives weekday visits).
- **Sweetener:** if unfound after ~2 weeks (~Jul 24), **+$5,000** added; pot may also grow as sponsors join.
- **Bonus loot:** **two real diamond rings** also hidden as separate finds, just for fun ("find a ring, keep the ring"). In hero, Loot section, and Fine Print.
- **Hours:** hunt only **9 AM–8 PM daily** (don't wake the campers).
- **Rules (real):** no cutting trees, no fires, no digging in the driving range. Plus (playful, unattributed): no trucks/excavators/helicopters; park in designated areas; leave it better than you found it.
- **No complex clues** — just the map (playing field + parking) and the rules. Authentic **real photos/videos, no AI**; proof videos coming (Tim counting cash, burying it on his side-by-side).
- **CFCW 840 AM = Official Radio Partner** (the ONLY confirmed sponsor — logo vendored at `assets/cfcw-logo.png`, shown in top strip + sponsor section + footer). Prize updates announced Fridays on CFCW.
- **Festival tie-in:** soft promo for the **"In the Woods" music festival**; the older **golf-balls-for-festival-tickets** idea runs quietly alongside (mentioned in the Festival section).

## Folded in from the co-worker's parallel site (`sebatreasur-b8njza3s.manus.space`, 2026-07-08)
That site is a *different* concept (multi-week clue trail, sponsor-funded $21,400 pot, app). Per Tim, we kept his guerrilla $5k model and cherry-picked: **CFCW partner + logo**, a **"This Is Just Year One" vision** section (yearly event, grow-the-pot, first-time-now), a **"Become a Sponsor"** section (tiers Gold $5k+/Silver $2.5k/Community $1k/In-Kind; CTA → sebahub.com interim), and a **"The Fine Print" official-rules** section (eligibility AB 18+, no-purchase, prize, **how-to-claim = gov ID + signed declaration**, safety code, disputes, privacy). **Deliberately excluded:** the clue trail, stale live stats, the $21,400 pot, and the other sponsor names (Parkland County/ATB/Seba Beach Marina/Parkland Realty — NOT confirmed, kept off).

## Deliberately kept OFF the public site (internal planning context)
Team friction and names — Ian's property-damage worries, Samantha's logistics/security anxiety, partner **Stephanie / CSCW**, the two-day-notice scramble, and the photo **metadata/GPS-stripping** operational detail. None of this is published. (Ask before adding any of it.)

## Site sections (v4)
CFCW partner strip → Hero (aerial + $5,000 flash + weekday-double + launch date) → **The Loot** ($5k/$10k/+$5k tiers + CFCW Friday line) → The Legend → **The Playing Field** map (4 spots + 3 landmarks + 2 parking) → The Four Spots (cards) → **The Pirate's Code** (rules + 9–8 hours banner) → How to Play + checklist → Festival tie-in → **Proof It's Real** (gallery) → **This Is Just Year One** (vision) → **Become a Sponsor** (tiers + CFCW anchor) → **The Fine Print** (official rules) → footer (CFCW credit).

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
4. ~~Claim mechanics~~ ✅ addressed in "The Fine Print" (present gov ID + sign a declaration) — confirm the wording works for you.
5. **Sponsor contact** — "Become a Sponsor" CTA currently points to **sebahub.com** (interim). Provide a dedicated sponsor email/mailto to swap in.
6. **Official Rules sign-off** — the Fine Print is plain-language, NOT lawyer-vetted. Get Tim's (ideally legal) review before launch; also decide a hard **hunt end date** (currently "until found").
7. **Optional POIs** — co-worker's lakeside spots (Old Dock, Boathouse, Pavilion, Cedar Trail, Sunset Point) can be added to the map only if confirmed real.
8. Optional: custom domain; repo/URL rename.

## Deploy
Repo root on `main` → GitHub Pages (branch `main`, `/root`). `.nojekyll` present. See README.
