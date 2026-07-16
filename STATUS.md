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
- Investigate and restore the missing twentieth item in the public 20-question
  interview. Preserve the authoritative wording and add a future count check;
  no interview content changed in this roadmap-only update.

See `README.md` for build and operating contracts and
`docs/operations/2026-07-16-production-release.md` for release and rollback
details. See `docs/ROADMAP.md` for approved future direction.
