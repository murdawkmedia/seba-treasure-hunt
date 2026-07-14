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
| `/sponsors` | Public information and a protected private sponsorship inquiry form |
| `/privacy` | Versioned Privacy Policy & Media Notice |
| `/waiver` | Versioned Participation Waiver, guardian terms and print view |
| `/community-guidelines` | Public contribution and moderation rules |
| `/ops` | Invitation-only staff case room, including the private Ops Sponsors ledger |

Every **Always Sunny in Seba** badge links to the [SebaStays Sunny Guarantee](https://www.sebastays.com/guarantee).

## Architecture

- Cloudflare Pages advanced-mode Worker serves the site and versioned API.
- D1 stores case state, dated updates, rules, zones, waypoints, player accounts, profiles, progress, communication permissions, append-only legal acceptances, reports, moderation and audit events. It never stores passwords or reset codes.
- Private R2 stores report and community-media originals.
- A Queue delivers uploaded media to a private Worker that validates and re-encodes approved raster formats through Cloudflare Images.
- Only a D1-authorized, ready derivative can be read publicly; originals and find evidence have no public delivery path.
- D1 provides atomic fixed-window rate limits using salted identifier hashes and expiring counters. Turnstile is the second write control.
- Sponsor inquiries use the dedicated `sponsor_inquiry` Turnstile action, idempotency, and rate limits before entering a private D1 sponsor-inquiry and append-only event ledger. Authorized staff use Ops Sponsors to search, filter, and record audited pipeline changes.
- Sponsor follow-up remains a deliberate staff workflow. There is no automated email, marketing subscription, public sponsor list, or CSV export in this implementation.
- Hunter and staff identity use separate Clerk applications. Hunters use verified email and a password of at least 12 characters with provider-managed recovery. Signed Clerk lifecycle webhooks create the D1 player only after the primary email is verified. Staff authorization is repeated in D1.
- Privacy/media acceptance, participation-waiver review and participation-waiver acceptance are separate append-only legal events. One adult may register up to ten directly supervised minors by name and birth year; those snapshots are private and absent from player exports.
- A stored waiver acceptance queues one transactional full-text receipt to the player account's verified email. Delivery and deliberate resend require dedicated `LEGAL_RECEIPT_EMAIL_FROM` and `LEGAL_RECEIPT_EMAIL_REPLY_TO` configuration. The same configured Reply-To is applied to player and staff recovery instructions so campaign replies reach one operations mailbox; none of these messages change hunt-update or SebaHub marketing permissions.
- `assets/favicon.svg` is the canonical Sunny Pirate Mystery Chest favicon. `npm run assets:favicons` deterministically regenerates its PNG and multi-resolution ICO variants.

The browser receives waypoint names, descriptions and safety states only. Exact navigation content is returned only after hunter authentication, a completed profile, current Privacy/Media `2026.2` acceptance, current Participation Waiver `2026.1` acceptance and an active/open safety check. Exact directions, progress writes and community participation remain locked until all independent gates pass.

## Privacy and campaign artwork

- All published route photographs are re-encoded without EXIF, GPS, XMP or IPTC metadata.
- `assets/photos/evidence-cash.jpg` is the real last-known evidence image; readable card details are blurred.
- `assets/photos/tim-lost-id-campaign-prop.webp` is fictional campaign artwork and is visibly disclosed as a dramatization. It is never evidence or social preview artwork.
- `assets/photos/sunny-pirate-treasure-seba-beach.webp` is the dedicated sponsor-hero illustration; its 1200x630 JPEG companion is the sponsor page's social preview. The favicon remains a small-format campaign mark and is not enlarged as page artwork.
- Exact directions, staff allowlists, private reports, originals, secrets and internal runbooks are excluded from the public build.
- Unapproved future campaign, partner and prize claims are not published.

## Develop and verify

```powershell
npm ci
npm run legal:verify
npm run assets:favicons
npm test
npm run typecheck
npm run build
npm run dev
```

The complete suite covers public content contracts, SEO/AEO, canonical redirects, gated waypoint data, auth separation, status transitions, reporting, sponsorship inquiries, private sponsor workflow totals, moderation, rate limits, upload privacy, legal-document integrity, media re-encoding, UI normalization, metadata removal and the Cloudflare file-size limit.

## Deploy

Cloudflare configuration is in `wrangler.toml`; the queue consumer is in `wrangler.media.toml`. Production database changes are versioned under `migrations/` and must be applied in order.

All Pages preview deployments use disposable validation-suffixed D1, R2 and Queue bindings. Rate-limit counters live in the isolated validation D1 database. The stable authenticated test URL is `codex-validation.seba-treasure-hunt.pages.dev`; immutable deployment URLs are for unauthenticated smoke tests only. Validation records are never promoted to production.

Never upload the working directory. `npm run build` creates an allowlisted `dist/` and excludes planning, source media, environment files, local Cloudflare state and unconfirmed partner assets.

Do not promote a build until all of these are configured and tested in preview:

1. public Clerk application with verified email/password, password recovery and compromised-password protection;
2. separate invitation-only staff Clerk application;
3. signed Clerk lifecycle webhook and deployment secret;
4. required D1 migrations through `0009_atomic_rate_limits.sql`, including the player/legal ledger, environment sentinel, sponsor inquiries, waiver/receipt records, fenced delivery leases, immutable legal-delivery ledgers and atomic rate-limit counters;
5. privately seeded staff principals;
6. hostname-restricted Turnstile widget and secret;
7. private report upload and queue processing;
8. hunter and staff sign-in, recovery and authorization;
9. sponsor inquiry submission and Ops Sponsors review with the exact `sponsor_inquiry` Turnstile action;
10. full public-output privacy scan.
11. a dedicated Resend legal-receipt sender configured through both `LEGAL_RECEIPT_EMAIL_FROM` and the shared transactional `LEGAL_RECEIPT_EMAIL_REPLY_TO`;

## Decisions in force

- Umbrella brand: **Tim Lost Something?**
- 2026 sub-brand: **This year: Tim lost his ID.**
- Descriptor: **The Seba Beach Treasure Hunt**
- Canonical item language is **ID bundle**, not lost wallet.
- The current 12-waypoint route is authoritative.
- Public media must be metadata-free; exact guidance is account-gated.
- Public notes and images are premoderated. Private reports never auto-publish.
- Sponsor inquiries and internal pipeline notes remain private; submitting does not create an agreement, marketing consent, or publication authorization.
- Privacy/media acceptance and Participation Waiver `2026.1` acceptance are separate versioned records. Guardian acceptance, covered minors and receipt delivery remain private; participation unlocks only for the exact active version and hash.
- The real evidence photo remains the social preview.
- No fabricated claims, countdowns or urgency.
- The route MP4 must remain below Cloudflare Pages' 25 MiB per-file limit.
- Production stays on the last working release until identity and human verification pass end-to-end.
