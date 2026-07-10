# STATUS — Tim Lost Something? / The Seba Beach Treasure Hunt

Last updated: 2026-07-10

## Current state

The 2026 public campaign has been rebuilt and locally verified under the
umbrella brand **Tim Lost Something?**

Campaign line: **This year: Tim lost his ID—along with roughly $5,000 in cash
and two diamond rings.**

Finders may keep the cash and rings. Tim only asks that his ID bundle be
returned to SebaHub. The site is a static three-page Cloudflare Pages project
with a 12-waypoint route, 61 GPS-tagged photographs and a route video.

Implementation is complete on the campaign-refresh branch. Cloudflare
deployment, custom-hostname activation and apex redirect verification are the
remaining release steps for this update.

## Public surfaces

- Canonical target: https://www.timlostsomething.com/
- Bare-domain target: https://timlostsomething.com/ → permanent www redirect
- Pages fallback: https://seba-treasure-hunt.pages.dev/
- Pages project: seba-treasure-hunt
- Pages: home, /route and /interview

## 2026-07-10 campaign refresh

- Rebranded navigation, titles, social metadata and visible campaign hierarchy
  to **Tim Lost Something?**
- Kept **The Seba Beach Treasure Hunt** as the plain-language geographic
  descriptor.
- Added factual SEO/AEO: canonical URLs, page-specific descriptions, Open
  Graph/X cards, visible quick answers, FAQs, JSON-LD, robots.txt and
  sitemap.xml.
- Linked all four **Always Sunny in Seba** badges to
  https://www.sebastays.com/guarantee with accessible new-tab labels and focus
  states.
- Preserved the real blurred cash/ID-bundle photograph as evidence and social
  artwork.
- Added the approved fictional Captain Latimer ID artwork as a visibly
  disclosed campaign prop. It is not evidence and not an exact image of the
  missing card.
- Updated canonical copy from “wallet” to “ID bundle” except where Tim's
  verbatim explanation distinguishes the bundle from a conventional wallet.

## Route video

- Canonical source: local Remotion composition **SebaRouteRetraced**.
- Updated only the final URL to **www.timlostsomething.com**.
- Published output remains 1,949 frames, 24 fps, 1920×1080 and 81.208 seconds.
- Frames 0–1840 are decoded-frame identical to the previous published video.
- Only frames 1841–1948 changed.
- The AAC soundtrack was copied without re-encoding and its decoded SHA-256
  remains 30928a5ca8991f5d69db5abf443483dcb800b42d6d64de0da25506d1daa275bb.
- Output is 20.46 MiB with H.264/AAC and faststart, below the Cloudflare Pages
  25 MiB per-file limit.

## Decisions in force

- The canonical annual brand is **Tim Lost Something?**
- The 2026 sub-brand is **This year: Tim lost his ID.**
- The current 12-waypoint/61-photo route is authoritative.
- Route-photo GPS metadata stays public intentionally.
- The campaign prop must always carry an explicit dramatization disclosure.
- The real evidence photo remains the social preview.
- No fabricated claims or fake urgency on the website.
- Deploy only from a clean git archive; never publish planning/, source-media/
  or local Cloudflare state.
- www is canonical. The apex must preserve path/query strings when redirecting.

## Verification

- Campaign contract: 6 passing tests.
- JSON-LD parses on all three pages.
- Git whitespace check passes.
- Remotion end-card regression test, ESLint and TypeScript pass.
- Video frame/audio invariants pass.

## Remaining release work

1. Complete desktop/mobile browser QA of the refreshed pages.
2. Run the public-release privacy scan on the final tracked surface.
3. Deploy the clean tracked archive to Cloudflare Pages.
4. Activate both custom hostnames and the apex-to-www 301 redirect.
5. Verify canonical pages, media, sitemap, badge links and redirect behavior
   live.
6. Obtain final legal/owner sign-off on the official hunt rules and prize
   language; this remains an operational review item rather than a deployment
   blocker requested for this technical refresh.
