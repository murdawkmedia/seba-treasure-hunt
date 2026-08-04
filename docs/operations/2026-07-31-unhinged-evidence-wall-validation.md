# Unhinged Evidence Wall Validation Release

Date: 2026-07-31

## Candidate

- Source commit: `084234cc08960552c2088ee1cff49dac49f6055a`
- Immutable deployment: `https://25925500.seba-treasure-hunt.pages.dev`
- Stable validation homepage:
  `https://codex-validation.seba-treasure-hunt.pages.dev/?release=084234c`
- Stable validation Ops entry:
  `https://codex-validation.seba-treasure-hunt.pages.dev/ops?release=084234c`
- Cloudflare runtime: `validation`
- Validation media worker version:
  `632e9e96-f616-4057-a9ad-7dded5e6cbe9`
- Production promotion: not performed

## Included Changes

- Rebuilt the public and hunter experience around the approved B2 Full
  Investigation Board direction. Generated evidence-wall art is atmospheric;
  real photographs remain the authoritative evidence.
- Marked Tim's ID Found everywhere current status appears. The tracked ID image
  remains unchanged; its red Found stamp is a reversible accessible page
  overlay.
- Added the public-safe dynamic What's Out There board with seven seeded items:
  ID, cash, rings, camera, Apple Watch, purse and Casey's qualifying golf balls.
- Added audited Draft, Out there, Found, Paused and Archived item states,
  optimistic versions, append-only events, up to three processed item images
  and private Official Update announcement drafts.
- Simplified the public shell to Where to Look, I Found Something and My Hunt.
  Latest News, What People Found, Tim's Story and Rules & Safety live under
  More while their stable URLs remain compatible.
- Converted My Hunt's existing per-hunter progress into a private 13-place
  checklist. Public points, rankings, badges and streaks were not introduced.
- Simplified account creation into two distinct legal consent cards and a
  return-to-origin flow after verification. Legal versions and separate
  acceptance records remain unchanged.
- Unified reporting around four plain choices while preserving guest private
  reports, Turnstile, rate limits, media optimization, notifications and staff
  moderation.
- Reorganized Ops around private reports, public moderation, the item board and
  Latest News while retaining advanced ledgers and access controls.

## Data and Deployment Boundary

- Applied `0016_dynamic_case_items.sql` only to
  `tim-lost-hunter-platform-validation`.
- The validation D1 contains seven seeded case items and seven append-only seed
  events. A post-deploy read returned `changed_db: false` and zero rows written.
- Deployed `tim-lost-media-processor-validation` only, using the validation D1,
  R2 bucket and processing queue.
- Deployed Pages only to the `codex-validation` preview branch.
- Production remained on its existing Pages deployment and schema. No
  production D1, R2, queue, Clerk, DNS, account, report, publication or public
  post was changed.
- Existing validation accounts and submissions remain disposable. Its existing
  test Latest News entry is validation-only and was not copied to production.

## Verification Evidence

- MJS/static regression suite: 299 passed, 0 failed.
- Non-D1 TypeScript regression suite: 546 passed, 0 failed.
- Real-D1 integration suite: all 27 top-level tests passed in four bounded
  groups. The complete one-process Windows run still spends excessive time in
  Miniflare teardown; assertions were therefore verified in bounded groups.
- Focused release contracts: 52 passed, 0 failed.
- TypeScript worker, client and test projects: passed.
- Authoritative legal-artifact verification: passed.
- Production-shaped build: passed.
- Credential-like patch scan: zero findings.
- Public media metadata/privacy regressions: passed.
- `git diff --check`: passed.
- Unified-shell browser QA: 72 navigations, 111 audited states and 21
  screenshots; zero console, page or request errors and zero external or local
  writes.
- Waiver/signup browser QA: passed with zero production-source, rendered-public
  or public-bundle privacy findings.
- Stable and immutable candidate URLs return HTTP 200 and the validation
  response sends `X-Robots-Tag: noindex, nofollow`.
- Desktop and 390-pixel mobile deployment checks found no horizontal overflow.
- The mobile report surface exposes all four choices and all 13 place choices,
  including Not sure and Different location.
- The public item API returns seven records. Tim's ID is Found; the other six
  items are Out there.
- Production still reports runtime `production`, contains no validation banner
  and contains none of the new evidence-wall lead copy.

## Owner Review

Use disposable validation records only.

1. Review the evidence wall on desktop and phone. Confirm the generated art
   reads as atmosphere while real photographs read as evidence.
2. Confirm Tim's ID is visibly Found and the original image remains available
   without a baked-in stamp.
3. Confirm cash is approximate, both rings remain out there, the camera, Apple
   Watch and purse are finder-keeps items, and only orange In the Woods logo
   golf balls qualify.
4. Open Where to Look signed out. Confirm all 13 stories and photos are public
   while exact directions stay locked.
5. Sign in with a disposable validation hunter and confirm the private
   checklist, exact-direction gating and return-to-origin behavior.
6. Create an adult and a minor-with-guardian disposable account. Confirm the
   two legal cards have View, Accept and Done—back to signup controls.
7. Exercise each I Found Something choice. Confirm guest private reporting,
   signed-in autofill, the final reference number and the separate public
   contribution choice.
8. As validation Ops, change an item through each allowed state and reverse it.
   Confirm stale versions fail, history is append-only and public state updates
   only after an explicit save.
9. Add, reorder and remove item media. Confirm images start private, use
   processed derivatives and expose correct alt text only after publication.
10. Create an item announcement draft. Confirm it is private, editable and not
    present in Latest News until a separate reviewed publication action.
11. Confirm the four task-first Ops actions are obvious and advanced ledgers
    remain available under the secondary section.

Production promotion requires the owner's separate explicit approval after this
authenticated owner review. Before promotion, export production D1 and deploy
the exact immutable candidate with rollback ready.
