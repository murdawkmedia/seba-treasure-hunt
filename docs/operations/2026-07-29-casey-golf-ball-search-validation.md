# Casey Golf-Ball Search Validation Release

Date: 2026-07-29

## Candidate

- Source commit: `0db0100836368a7345e9905a71074cfe887a1c43`
- Immutable deployment: `https://87076691.seba-treasure-hunt.pages.dev`
- Stable validation homepage:
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=0db0100`
- Stable validation golf-ball page:
  `https://codex-validation.seba-treasure-hunt.pages.dev/golf-balls?release=0db0100`
- Cloudflare runtime: `deploymentEnvironment: validation`

This candidate was reviewed in validation and subsequently approved by Murphy
for byte-for-byte production promotion.

## Included Story Changes

- Tim remains the homepage lead.
- The roughly $5,000 figure is identified as the amount the search began with.
- The current cash estimate is described as approaching $10,000, not as an
  exact guarantee.
- Tim is still retracing his route for his ID and continues losing cash.
- Tim's ID and both diamond rings remain missing; the rings are described as
  being in separate baggies.
- Casey's marked In the Woods golf balls are a distinct side search.
- Only balls bearing the official In the Woods logo qualify.
- The current offer is one qualifying ball for one festival ticket, with finer
  terms still subject to update.
- Casey is the sole redemption contact through `casey@sebahub.com` or at
  SebaHub School Monday-Friday, and the ball must be returned.
- The page links to `https://www.inthewoodsmusicfestival.com/`.

## Verification Evidence

- Exact Privacy and Waiver artifacts verified against their authoritative
  sources.
- All worker, client and test TypeScript projects passed.
- Complete automated suite: 572 passed, 0 failed.
- Focused public-content suite: 26 passed, 0 failed.
- Isolated responsive browser audit: 72 page navigations, 111 audited states
  and 21 screenshots with zero console, page or request errors and zero
  external or local writes.
- Desktop and 390-pixel mobile renderings of the homepage and `/golf-balls`
  were reviewed.
- The built output privacy scanner passed all 49 served static files.
- Additional local-path, credential-value, private-account and test-fixture
  scans passed.
- Immutable and stable homepage and golf-ball URLs returned HTTP 200.
- The validation banner and `noindex, nofollow` runtime behavior were present.
- Casey's email, festival link, qualifying-ball language, shared navigation,
  sitemap and canonical metadata were verified.
- A validation-only 404 exposed a missing Worker clean-route registration.
  A regression test was added, the route registry was corrected, the full
  release gate was rerun, and this final immutable candidate passed.
- A read-only production comparison confirmed that
  `https://www.timlostsomething.com/` still contains neither the new route nor
  the new Casey story.

## Change Boundaries

- No database migration was run.
- No validation or production D1, R2 or queue data was mutated.
- No authentication, Clerk, account, reporting, moderation or Ops schema was
  changed.
- No media worker was deployed.
- No DNS, custom-domain or production Pages deployment was changed.
- No public post was created.

## Owner Review

1. Confirm Tim remains the homepage lead.
2. Confirm the $5,000 and approaching-$10,000 language feels accurate and
   appropriately non-guaranteed.
3. Confirm the ID and both ring baggies remain missing.
4. Confirm Casey's teaser follows the primary Tim case content.
5. Open **Golf Balls** from desktop and mobile navigation.
6. Confirm that only official logo-marked balls qualify.
7. Confirm the current one-ball/one-ticket wording.
8. Confirm Casey is the only redemption contact.
9. Test the Casey email, festival website and Rules links.
10. Confirm normal and enlarged-text readability.

## Production Promotion

- Murphy explicitly approved this exact candidate for production on
  2026-07-29.
- Exact application source:
  `0db0100836368a7345e9905a71074cfe887a1c43`.
- Production Pages deployment:
  `1ee12c0e-f53f-4f9d-9c73-397b1e273432`.
- Immutable production URL:
  `https://1ee12c0e.seba-treasure-hunt.pages.dev`.
- Canonical production URL: `https://www.timlostsomething.com`.
- The production release gate again passed the complete 572-test suite, all
  TypeScript projects, exact legal artifacts, the production build, output
  privacy scanning and read-only desktop/mobile browser checks.
- Production D1 was unchanged by the release. Pre- and post-deploy counts
  matched exactly, both reads wrote zero rows, `changed_db` was false and the
  foreign-key check was clean.
- No migration, D1/R2/queue write, Clerk change, media-worker deployment, DNS
  change or public post occurred.
- Rollback tag: `production-casey-golf-balls-2026-07-29`.
- Immediately previous production deployment:
  `cb2ad1cd-f5ce-45e8-a2c8-4b1d232ba45e`
  (`https://cb2ad1cd.seba-treasure-hunt.pages.dev`).
