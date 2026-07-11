# Tim Lost Something?

The 2026 Seba Beach Treasure Hunt campaign and hunter platform.

**This year: Tim lost his ID — along with roughly $5,000 in cash and two diamond rings.** Finders may keep the cash and rings; Tim only asks that his government ID bundle be returned.

## Addresses

- Canonical production site: <https://www.timlostsomething.com/>
- Bare-domain redirect: <https://timlostsomething.com/>
- Cloudflare Pages project: `seba-treasure-hunt`
- Current release preview: <https://codex-validation.seba-treasure-hunt.pages.dev/>

The bare hostname permanently redirects to the canonical `www` hostname while preserving paths and query strings. Preview deployments are noindexed.

## Product surfaces

| Route | Purpose |
|---|---|
| `/` | Campaign story, case status, primary actions, evidence and quick answers |
| `/start` | Permanent QR destination, live route/zone ledger and safe starting instructions |
| `/route` | Public 12-waypoint overview, public-safe photos and route video |
| `/interview` | Tim's full account and optional Hunter's Notes |
| `/dashboard` | Hunter identity, profile, progress and authenticated exact guidance |
| `/updates` | Dated official case-update feed |
| `/report` | Private find, tip and safety reporting; account optional |
| `/clue-board` | Moderated public Field Notes, images, replies and abuse reporting |
| `/rules` | Versioned current rules and safety guidance |
| `/privacy` | Campaign privacy notice |
| `/community-guidelines` | Public contribution and moderation rules |
| `/ops` | Invitation-only staff case room |

Every **Always Sunny in Seba** badge links to the [SebaStays Sunny Guarantee](https://www.sebastays.com/guarantee).

## Architecture

- Cloudflare Pages advanced-mode Worker serves the site and versioned API.
- D1 stores case state, dated updates, rules, zones, waypoints, profiles, progress, reports, moderation and audit events.
- Private R2 stores report and community-media originals.
- A Queue delivers uploaded media to a private Worker that validates and re-encodes approved raster formats through Cloudflare Images.
- Only a D1-authorized, ready derivative can be read publicly; originals and find evidence have no public delivery path.
- KV provides salted, hashed-identifier rate limits. Turnstile is the second write control.
- Hunter and staff identity use separate Clerk applications. Staff authorization is repeated in D1.

The browser receives waypoint names, descriptions and safety states only. Exact navigation content is returned only after hunter authentication and an active/open safety check.

## Privacy and campaign artwork

- All published route photographs are re-encoded without EXIF, GPS, XMP or IPTC metadata.
- `assets/photos/evidence-cash.jpg` is the real last-known evidence image; readable card details are blurred.
- `assets/photos/tim-lost-id-campaign-prop.webp` is fictional campaign artwork and is visibly disclosed as a dramatization. It is never evidence or social preview artwork.
- Exact directions, staff allowlists, private reports, originals, secrets and internal runbooks are excluded from the public build.
- Unapproved future campaign, partner and prize claims are not published.

## Develop and verify

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

The complete suite covers public content contracts, SEO/AEO, canonical redirects, gated waypoint data, auth separation, status transitions, reporting, moderation, rate limits, upload privacy, media re-encoding, UI normalization, metadata removal and the Cloudflare file-size limit.

## Deploy

Cloudflare configuration is in `wrangler.toml`; the queue consumer is in `wrangler.media.toml`. Production database changes are versioned under `migrations/` and must be applied in order.

Never upload the working directory. `npm run build` creates an allowlisted `dist/` and excludes planning, source media, environment files, local Cloudflare state and unconfirmed partner assets.

Do not promote a build until all of these are configured and tested in preview:

1. public Clerk application and allowed identity methods;
2. separate invitation-only staff Clerk application;
3. privately seeded staff principals;
4. hostname-restricted Turnstile widget and secret;
5. private report upload and queue processing;
6. hunter and staff sign-in, recovery and authorization;
7. full public-output privacy scan.

## Decisions in force

- Umbrella brand: **Tim Lost Something?**
- 2026 sub-brand: **This year: Tim lost his ID.**
- Descriptor: **The Seba Beach Treasure Hunt**
- Canonical item language is **ID bundle**, not lost wallet.
- The current 12-waypoint route is authoritative.
- Public media must be metadata-free; exact guidance is account-gated.
- Public notes and images are premoderated. Private reports never auto-publish.
- The real evidence photo remains the social preview.
- No fabricated claims, countdowns or urgency.
- The route MP4 must remain below Cloudflare Pages' 25 MiB per-file limit.
- Production stays on the last working release until identity and human verification pass end-to-end.
