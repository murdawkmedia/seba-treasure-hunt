# Emergency Unconfirmed-Partner Removal Design

Date: 2026-07-13

Status: Approved emergency hotfix

## Purpose

Remove every public reference, logo, link and promotional claim associated with the uncontracted radio partner from the live Tim Lost Something? website immediately. Keep the current production campaign otherwise stable, and do not promote the unfinished hunter-platform validation build as part of this emergency change.

## Chosen Approach

Cut a minimal production hotfix from the currently deployed `main` release.

The hotfix will:

- remove the partner strip from all three public pages;
- remove the partner logo and outbound partner links;
- remove footer credits, broadcast schedules, audience claims, founding-sponsor claims and on-air benefits;
- rewrite only the surrounding sentences that would otherwise become incomplete;
- remove partner-specific CSS;
- delete the partner logo asset;
- add a regression contract that reconstructs the prohibited acronym at runtime and rejects it from every public source file;
- build an allowlisted `dist/` directory so repository documentation, tests and scripts are no longer published as website files; and
- deploy only the production hotfix because the current validation deployment is already clean.

## Alternatives Rejected

### Promote the validation platform to production

Rejected because identity, Turnstile, waiver and media integrations are intentionally incomplete. Removing a partner reference does not justify changing the live product architecture.

### Rewrite responses at the edge

Rejected because an edge text substitution could miss metadata, images, CSS, binary assets and directly addressable repository files. It would also be harder to verify and maintain.

### Remove visible markup but keep the current deployment package

Rejected because the existing production deployment exposes tracked documentation, tests and the logo asset as directly addressable public files. The deployment package must be narrowed as part of the hotfix.

## Content Changes

- Delete partner strips and partner footers from `index.html`, `route.html` and `interview.html`.
- Delete the home-page broadcast-update line.
- Replace the interview attribution with a neutral SebaHub-team attribution.
- Remove the future-roadmap broadcast reference without changing the annual-campaign idea.
- Remove the anchor-sponsor block.
- Make sponsor copy refer only to hunters and the Seba Beach community.
- Remove broadcast and on-air benefits from sponsor tiers.
- Make the FAQ say that prize updates will be published on the campaign website.
- Delete the partner logo file and every partner-specific style rule.

No replacement partner, sponsor, station, agreement or future media commitment will be invented.

## Public Build Boundary

Add a dependency-free Node build script that recreates `dist/` from an explicit allowlist:

- `_worker.js`;
- `canonical-host-worker.mjs`, which is imported by `_worker.js`;
- the three public HTML pages;
- `robots.txt` and `sitemap.xml`;
- `assets/`, excluding prohibited or removed files;
- `css/`; and
- `js/`.

The build must fail if a public file name or textual public file contains the prohibited acronym. Documentation, tests, source plans, status notes and scripts must not enter `dist/`.

## Verification

- Observe the new regression test fail against the current production source.
- Make the content and packaging changes.
- Run all existing Node tests and the new regression contract.
- Build `dist/` and scan every output path and textual asset.
- Confirm the removed logo is absent.
- Confirm public source has no partner name, link, logo path or partner-specific class.
- Run `git diff --check` and the public-release privacy scan.
- Deploy `dist/` to the production branch of the existing Cloudflare Pages project.
- Verify the canonical hostname, bare hostname and Pages production alias.
- Verify home, route, interview, former logo URL, former documentation URL and former test URL.
- Confirm the stable validation alias remains clean and unchanged.

## Rollback

If the hotfix breaks a critical page or canonical redirect, restore the preceding Pages production deployment. A rollback would temporarily restore the disputed material, so correction and redeployment take priority over leaving the rollback active.

## Completion Criteria

- No public production or validation response contains the partner acronym or partner claims.
- The former logo, repository documentation and repository test URLs return `404`.
- All three campaign pages and canonical redirects continue to work.
- The production deployment contains only the allowlisted public site.
- The validation hunter-platform deployment is not replaced.
