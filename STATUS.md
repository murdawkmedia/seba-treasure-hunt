# STATUS — Tim Lost Something? / The Seba Beach Treasure Hunt

Last updated: 2026-07-13

## Current state

The 2026 public campaign has been rebuilt and locally verified under the
umbrella brand **Tim Lost Something?**

Campaign line: **This year: Tim lost his ID—along with roughly $5,000 in cash
and two diamond rings.**

Finders may keep the cash and rings. Tim only asks that his ID bundle be
returned to SebaHub. The site is a static three-page Cloudflare Pages project
with a 12-waypoint route, 61 GPS-tagged photographs and a route video.

The emergency unconfirmed-partner hotfix is live on Cloudflare Pages. Both
custom hostnames are active and HTTPS-valid. The bare hostname returns a
permanent path/query-preserving redirect to the canonical www hostname. The
separate hunter-platform validation deployment remains unchanged and noindexed.

## Public surfaces

- Canonical target: https://www.timlostsomething.com/
- Bare-domain target: https://timlostsomething.com/ → permanent www redirect
- Pages fallback: https://seba-treasure-hunt.pages.dev/
- Pages project: seba-treasure-hunt
- Pages: home, /route and /interview
- Verified production deployment: ad89ff2a.seba-treasure-hunt.pages.dev

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
- Added a tested Pages advanced-mode worker that redirects only
  timlostsomething.com to www.timlostsomething.com and passes www/Pages aliases
  through unchanged to static assets.

## 2026-07-13 emergency unconfirmed-partner hotfix

- Removed all visible partner strips, links, logos, broadcast schedules,
  audience claims, founding-sponsor claims, on-air claims and partner CSS from
  the legacy production source.
- Deleted the standalone partner logo.
- Audited the current validation hunter-platform and media surfaces; both are
  clean.
- Replaced repository-wide publishing with an explicit `dist/` allowlist that
  excludes documentation, tests, scripts, planning, source media, local state,
  and removed or unapproved partner assets.
- Hardened the staged builder to reject prohibited text, prohibited paths and
  symlinks, and to remove deployable output when a build fails.
- Local full suite passes 14/14.
- The exact `dist/` inventory is 10 top-level entries and 92 files.
- The public scan is clean.
- Added explicit `404` responses with `Cache-Control: no-store` for the removed
  logo and repository-only documentation, test and script paths.
- Production deployment `ad89ff2a` is live and verified on both custom
  hostnames and the Pages production alias.

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
- Deploy only the staged `dist/` allowlist; never publish repository
  documentation, tests, scripts, planning, source media, local state, or
  removed or unapproved partner assets.
- www is canonical. The apex must preserve path/query strings when redirecting.

## Verification

- Full local contract suite: 14/14 passing tests.
- Staged public build succeeds and contains exactly 10 top-level entries and 92
  files.
- Public scan reports no prohibited text or paths.
- JSON-LD parses on all three pages.
- Git whitespace check passes.
- Remotion end-card regression test, ESLint and TypeScript pass.
- Video frame/audio invariants pass.
- Cloudflare Pages reports both custom hostnames active with active validation.
- Live apex check: 301 to www with path/query preservation.
- Live www checks: home, /route, /interview, robots.txt, sitemap.xml, prop image
  and route MP4 return successfully.
- Live home, route, interview and CSS responses contain no unconfirmed-partner
  material.
- The former partner logo, repository documentation and repository test URLs
  return `404` and do not fall through to stale assets.
- The noindex `codex-validation` hunter-platform deployment remains clean and
  retains its separate Ops surface.
- Live Sunny Guarantee links: 4, all with accessible new-tab labels.
- Public-release denylist scan: no tracked-file hits.

## Remaining release work

1. Integrate the verified emergency hotfix into main so the repository source
   of truth matches the live production deployment. Do not redeploy the legacy
   main branch before this integration.
2. Obtain final legal/owner sign-off on the official hunt rules and prize
   language; this remains an operational review item rather than a deployment
   blocker requested for this technical refresh.
