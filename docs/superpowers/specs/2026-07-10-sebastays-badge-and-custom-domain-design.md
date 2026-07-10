# SebaStays Badge Link and Custom Domain Design

Date: 2026-07-10
Status: Approved revised design, awaiting written-spec review

## Goal

Give the treasure-hunt campaign a memorable repeatable brand, use it as a clear
marketing bridge to SebaStays, make the campaign domain work with and without
`www`, and improve factual search/answer-engine discoverability.

## Campaign brand hierarchy

The reusable umbrella brand is:

`Tim Lost Something?`

The 2026 campaign sub-brand is:

`This year: Tim lost his ID.`

Where space permits, use the fuller campaign line:

`This year: Tim lost his ID—along with $5,000 and two diamond rings.`

`The Seba Beach Treasure Hunt` remains the plain-language geographic
descriptor. It supports clarity and search intent but is no longer the primary
wordmark.

Apply this hierarchy consistently:

- Top navigation on every page: `Tim Lost Something?`
- Compact supporting copy: `This year: Tim lost his ID.`
- Homepage hero and machine-readable campaign summary: the full campaign line.
- Browser and social titles: lead with `Tim Lost Something?`, then the page or
  hunt descriptor.
- Internal README/status title: `Tim Lost Something? — The Great Seba Beach
  Treasure Hunt`.
- Keep natural body references such as `the Seba Beach Treasure Hunt` where
  they explain what the campaign is.

Use `ID`, not `wallet`, in canonical campaign claims because the lost item is an
elastic-banded ID bundle. Historical/verbatim interview references to a wallet
may remain when they accurately represent the source material.

## Badge links

Every `Always Sunny in Seba` badge on the treasure-hunt website will link to:

`https://www.sebastays.com/guarantee`

This includes:

- The homepage hero badge.
- The homepage footer badge.
- The route-page footer badge.
- The interview-page footer badge.

Each link will open in a new tab so visitors keep their place in the hunt. The
link will use `rel="noopener"`, an accessible label that identifies the Sunny
Guarantee and announces the new tab, and a visible keyboard-focus treatment.
The badge's existing appearance and animation will remain unchanged apart from
an understated hover/focus affordance.

## Campaign domain

The canonical campaign address will be:

`https://www.timlostsomething.com/`

The bare address will permanently redirect to the canonical address:

`https://timlostsomething.com/` -> `https://www.timlostsomething.com/`

Both hostnames will be configured in the same Cloudflare zone and associated
with the existing Murdawk Media Cloudflare Pages project,
`seba-treasure-hunt`. Cloudflare will provide HTTPS for both hostnames. The
redirect will preserve the requested path and query string so links such as
`https://timlostsomething.com/route` continue to the corresponding canonical
page.

The site's canonical metadata, Open Graph URL/image, and public absolute links
will use the `www` hostname. Relative navigation between the three site pages
will remain relative.

## Public campaign-prop image

The user-supplied doctored ID image is approved public campaign artwork, not
evidence and not a real credential.

- Preserve the provenance-bearing source outside the public build at
  `source-media/originals/campaign-props/tim-lost-id-campaign-prop.png`.
- Publish an optimized derivative at
  `assets/photos/tim-lost-id-campaign-prop.webp`.
- Keep the existing blurred `evidence-cash.jpg` as the primary evidence image
  and social preview.
- Display the prop separately on the homepage after the real evidence, never
  inside the `Last Known Photo` figure and never as Open Graph artwork.
- Visible title: `Tim's ID — Campaign Prop`.
- Visible disclosure: `Campaign prop / dramatization — not a real driver's
  licence and not an exact image of the card hunters are looking for.`
- Alt text: `Fictional campaign prop resembling an Alberta driver's licence
  for Captain Latimer on a dark counter; all details are invented.`
- Set intrinsic dimensions/aspect ratio and lazy-load the below-fold image.

## Search and answer-engine optimization

Apply a factual, non-spammy SEO/AEO layer across the homepage, route, and
interview pages:

- Unique page titles and meta descriptions led by `Tim Lost Something?`.
- Canonical URLs on `https://www.timlostsomething.com`.
- Complete Open Graph and X/Twitter metadata using absolute canonical URLs.
- A concise visible homepage answer block explaining what `Tim Lost
  Something?` is, what was lost, what the finder keeps, and how to return the
  ID.
- Visible, plainly answered FAQs for the prize, rules, route, hours, safety,
  access, and ID return process. Do not invent new rules or claims.
- JSON-LD grounded in visible page content: `WebSite`, page-specific `WebPage`,
  `BreadcrumbList`, `FAQPage` for visible FAQs, and an `ItemList` for the
  published 12-waypoint route.
- Consistent entities and locations: Tim Latimer, Seba Beach, Lake Wabamun,
  Alberta, SebaHub, SebaStays, and the Sunny Guarantee.
- Clear heading hierarchy, semantic navigation, descriptive link labels, and
  accurate image alt text.
- Add `robots.txt` and `sitemap.xml` for the three canonical public pages.

Do not add keyword-stuffed copy, thin doorway pages, fabricated urgency,
unsupported prize claims, fake reviews, or hidden answer-engine text.

## Route-video end-card update

The published route video was built from the local Remotion composition
`SebaRouteRetraced`; QuickCut/CapCut is not required. Change only the end-card
URL from the old GitHub Pages address to:

`www.timlostsomething.com`

Preserve the 12-waypoint/61-photo sequence, 1,949-frame duration, 24 fps,
1920×1080 dimensions, timing, motion, title card, end-card wording, hunt hours,
CFCW credit, and current soundtrack. Render to a separate output, copy the
existing AAC soundtrack without re-encoding, and apply the existing
Cloudflare-safe H.264 compression plus `faststart`.

The end card begins at frame 1841. Verification must show identical decoded
frames through frame 1840, the same decoded-audio hash, and visual changes only
on frames 1841–1948.

## Deployment safety

- Deploy from a clean archive/staging directory so gitignored `planning/` and
  `source-media/` material cannot be published.
- Keep the existing Pages project and current static architecture.
- Do not expose credentials, source media, planning material, or Wrangler
  account cache files.
- Do not change the SebaStays website itself.
- Preserve the existing published video until the replacement has passed
  duration, frame, audio, size, and visual checks.

## Verification

Before completion:

1. Confirm the repository is clean except for the intended changes.
2. Check the campaign brand/sub-brand on all pages and in metadata.
3. Check all four badge links, accessible names, new-tab behavior, and keyboard
   focus styling.
4. Verify the real evidence and clearly disclosed prop image render in their
   intended separate contexts.
5. Validate canonical/social metadata, JSON-LD, `robots.txt`, and `sitemap.xml`.
6. Smoke-test `/`, `/route`, `/interview`, and the route video locally.
7. Verify the new video retains 1,949 frames, duration, soundtrack, and all
   pre-end-card decoded frames while changing only the final URL.
8. Deploy the intended tracked site files to `seba-treasure-hunt`.
9. Verify the Pages project and both custom hostnames over HTTPS.
10. Verify the bare hostname returns a permanent redirect to `www` while
   preserving paths and query strings.
11. Verify the canonical hostname serves the current 12-waypoint/61-photo build.
12. Verify every published Sunny badge reaches
   `https://www.sebastays.com/guarantee`.

## Success criteria

- Both campaign hostnames work over HTTPS.
- `www.timlostsomething.com` is the sole canonical campaign hostname.
- The bare hostname redirects permanently and preserves paths/query strings.
- All four Sunny badges link accessibly to the live SebaStays guarantee page.
- `Tim Lost Something?` and the approved 2026 ID sub-brand are consistent.
- Search/answer-engine metadata and visible answers are complete and factual.
- The campaign prop is useful but cannot reasonably be mistaken for evidence
  or a real driver's licence in site context.
- The video's only content change is its final displayed URL.
- The existing hunt experience, media, and navigation continue to work.
