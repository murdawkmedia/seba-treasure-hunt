# Tim Lost Something?

**This year: Tim lost his ID—along with roughly $5,000 in cash and two diamond
rings.**

This is the public 2026 Seba Beach Treasure Hunt. Finders may keep the cash and
rings; Tim only asks that his government ID bundle be returned to SebaHub.

## Live addresses

- Canonical: <https://www.timlostsomething.com/>
- Bare-domain redirect: <https://timlostsomething.com/>
- Cloudflare Pages fallback: <https://seba-treasure-hunt.pages.dev/>

The bare hostname permanently redirects to the canonical **www** hostname while
preserving paths and query strings.

## Pages

| Page | Purpose |
|---|---|
| index.html | Campaign premise, real evidence, disclosed ID prop, rules, quick answers, contacts and sponsor framing |
| route.html | Twelve GPS-mapped waypoints, 61 route photos, trail map and the 81-second route video |
| interview.html | Tim's full 20-question account and 11 optional Hunter's Notes |

## Brand and marketing bridge

- Umbrella brand: **Tim Lost Something?**
- 2026 sub-brand: **This year: Tim lost his ID.**
- Descriptor: **The Seba Beach Treasure Hunt**
- Every **Always Sunny in Seba** badge links to the
  [SebaStays Sunny Guarantee](https://www.sebastays.com/guarantee).

## Tech

- Plain static HTML, CSS and JavaScript, packaged by a staged public build.
- Vendored Leaflet with Esri imagery tiles; no map API key.
- Route photos are web-optimized and intentionally retain GPS metadata because
  their locations are part of the hunt.
- assets/route/route-video.mp4 is a 1,949-frame, 24 fps, 1920×1080 H.264/AAC
  file with faststart. Its canonical end card displays
  **www.timlostsomething.com**.
- Search and answer-engine surfaces include page-specific metadata, canonical
  URLs, Open Graph/X cards, visible quick answers, JSON-LD, robots.txt and
  sitemap.xml.

## Evidence and campaign artwork

- assets/photos/evidence-cash.jpg is the real last-known photo. The readable
  ID/card details are blurred.
- assets/photos/tim-lost-id-campaign-prop.webp is deliberately fictional
  campaign artwork. It is visibly disclosed as a dramatization and must never
  be presented as evidence, an exact likeness of the missing ID, or social
  preview artwork.

## Test and preview

    node --test tests/*.test.mjs
    node scripts/build-public.mjs
    python -m http.server 8080 --directory dist

Open <http://localhost:8080>, /route.html and /interview.html.

The 14 contract tests verify the campaign and canonical-host contracts plus the
public-build allowlist and its prohibited-content safeguards. The staged build
must succeed before preview or deployment.

## Deploy

- Cloudflare Pages project: **seba-treasure-hunt**
- Production artifact: the generated **dist/** directory
- Deployment command from **main**:
  `npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch main`
- Canonicalization: Pages advanced-mode worker redirects only the bare hostname
  and passes all other requests to the static asset binding.

Never deploy the repository or working directory directly. `dist/` is an
explicit allowlist: repository documentation, tests, scripts, planning, source
media, local state, and removed or unapproved partner assets are not public.

## Decisions in force

- Canonical campaign language says Tim lost his **ID bundle**, not a wallet.
  Verbatim interview material may still explain that he does not carry a
  conventional wallet.
- The 12-waypoint/61-photo route is authoritative.
- GPS metadata on route photographs is public intentionally.
- The evidence photo remains the social preview.
- No fabricated claims or fake urgency on the website.
- The published MP4 must remain below Cloudflare Pages' 25 MiB per-file limit.
- _worker.js and canonical-host-worker.mjs are the tested production redirect;
  do not replace them with an unverified client-side redirect.
