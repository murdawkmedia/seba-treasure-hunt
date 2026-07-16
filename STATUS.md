# STATUS — Tim Lost Something?

Last updated: 2026-07-16

## Current state

The Tim Lost Something hunter platform is live at
`https://www.timlostsomething.com`. The public campaign, password-based hunter
accounts, company-domain Ops access, private reports, moderated Field Notes,
Lucky 13 route, participation waiver, transactional email, and operator alerts
are active in production.

The validation environment remains separate and disposable. Do not copy
validation accounts, submissions, or credentials into production.

## Update 2026-07-16

- Prepared Release 1 interview-integrity source: the public feature is now
  Tim’s Account across page metadata, social previews, structured data,
  navigation and internal links.
- Kept the authoritative 19 entries and Tim’s answers intact, corrected the
  entry sequence to 1–19, and grouped the account under Before the route, Along
  the route and After the discovery.
- Kept the unpublished golf-ball question out of public sources and added
  focused regression coverage for count, numbering, sections, naming and
  excluded copy.
- Verified 218 static tests and 370 worker/client tests, legal generation,
  TypeScript checks and the production build.
- Release 1 changes are source-ready but are not recorded here as deployed to
  production. The later site-wide local-mystery rebrand remains pending.
- Kept the RV guest and horseshoe-pit area published as `restricted`.
- Updated its public instruction to require hunters to check in with office
  staff before going beyond the public approach and entering the park.
- Applied production D1 migration `0014_park_office_check_in_guidance.sql`.
- Verified the production API and rendered `/start` page show the new wording,
  one Restricted badge, and no browser console errors.
- Added a migration contract test; the static suite reports 211 passing tests,
  the worker/client suite reports 370, and TypeScript checks pass.
- Added an approved future creative direction to `docs/ROADMAP.md`: move from
  pirate theatre to a genuine local mystery. No production copy, artwork or
  styling changed as part of the roadmap update.

## Decisions in force

- Exact route controls remain available only to authenticated hunters.
- Public route stories and approved-report GPS locations remain public.
- Private evidence is never auto-published; operators make a separate explicit
  publication decision, with media publication off by default.
- Production and validation data must remain isolated.
- The RV guest and horseshoe-pit area remains restricted even when office staff
  check-in guidance is displayed.
- The next broad creative direction is suspenseful, conversational,
  community-led and lightly playful, with SebaHub as host rather than subject.
  Pirate expressions and exaggerated gimmicks will be retired as one reviewed
  transition, not through piecemeal production edits.

## Current follow-ups

- Add a scheduled retry consumer for transient operator-alert mail failures.
- Run a real participant waiver acceptance after owner testing to verify the
  production receipt presentation and email copy.
- Add visible waypoint-progress tracking later; it remains intentionally
  deferred.
- Rotate bootstrap and API credentials after the launch window.
- Implement the approved local-mystery direction in validation first, then seek
  explicit approval before any production rollout.
- Deploy and smoke-test the source-ready Tim’s Account integrity release before
  recording it as the live production state.

See `README.md` for build and operating contracts and
`docs/operations/2026-07-16-production-release.md` for release and rollback
details. See `docs/ROADMAP.md` for approved future direction.
