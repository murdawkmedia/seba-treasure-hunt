# SebaStays Badge Link and Custom Domain Design

Date: 2026-07-10
Status: Approved design, awaiting written-spec review

## Goal

Use the treasure-hunt campaign as a clear marketing bridge to SebaStays and give
the campaign a memorable public domain that works with and without `www`.

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

## Deployment safety

- Deploy from a clean archive/staging directory so gitignored `planning/` and
  `source-media/` material cannot be published.
- Keep the existing Pages project and current static architecture.
- Do not expose credentials, source media, planning material, or Wrangler
  account cache files.
- Do not change the SebaStays website itself.

## Verification

Before completion:

1. Confirm the repository is clean except for the intended changes.
2. Check all four badge links, accessible names, new-tab behavior, and keyboard
   focus styling.
3. Smoke-test `/`, `/route`, `/interview`, and the route video locally.
4. Deploy the intended tracked site files to `seba-treasure-hunt`.
5. Verify the Pages project and both custom hostnames over HTTPS.
6. Verify the bare hostname returns a permanent redirect to `www` while
   preserving paths and query strings.
7. Verify the canonical hostname serves the current 12-waypoint/61-photo build.
8. Verify every published Sunny badge reaches
   `https://www.sebastays.com/guarantee`.

## Success criteria

- Both campaign hostnames work over HTTPS.
- `www.timlostsomething.com` is the sole canonical campaign hostname.
- The bare hostname redirects permanently and preserves paths/query strings.
- All four Sunny badges link accessibly to the live SebaStays guarantee page.
- The existing hunt experience, media, and navigation continue to work.
