# Selectable Private-Report Public Destinations

**Date:** 2026-07-18

**Status:** Approved; implementation plan written

**Target:** Disposable validation first, then promote the exact verified artifact
to production under the approval recorded in this task

**Scope:** The Public Outcome area inside an opened Ops Private Report

## Summary

Turn the existing explanatory destination cards into real, unmistakable
controls. An operator first chooses whether to keep a report private, publish a
reviewed Case Note, or prepare an Official Update. The interface then reveals
only the workflow for that choice.

Selecting a destination never publishes, schedules, saves or changes the
private review status. The existing exact-preview review and explicit final
confirmation remain the publication boundary.

This design is a focused usability correction to the July 18 Guided Official
Update Publishing and Guided and Reversible Private Report Workflow designs.
Their authorization, privacy, audit, media, reversible-state and publication
rules remain in force.

## Problem and root cause

The current interface presents three destination descriptions as plain
`article` cards:

- Keep private;
- Publish to Case Notes; and
- Prepare an Official Update.

They visually resemble choices but have no selection behavior. A generic
`Prepare public outcome` button only moves focus into one shared composer, where
Case Notes and Official Update actions appear together. On mobile this makes it
unclear which destination has been chosen, how submitted images will be used,
or which action will publish where.

The live report submitted at approximately 12:54 p.m. MDT on July 18 confirms
the problem is presentation rather than missing source data: the report has
three ready images, is eligible for a public outcome, and has no existing Case
Note or Official Update. Production was inspected read-only and must not be
mutated to test this correction.

## Goals

- Make the public-destination decision obvious to an inexperienced operator.
- Make every destination a large, accessible, mobile-friendly selection.
- Reveal only the controls that apply to the selected destination.
- Preserve the existing deliberate preview and confirmation before publishing.
- Make image selection and the eventual public destination unambiguous.
- Preserve typed copy and eligible image selections while switching choices.
- Keep all existing private-review, authorization, privacy and audit behavior.
- Ship the verified change to the live website without changing production
  records during deployment testing.

## Non-goals

- Do not automatically publish anything when a card is selected.
- Do not change report status when a public destination is selected.
- Do not change the Moderation Queue.
- Do not change public Case Notes or Official Update schemas or APIs unless a
  failing implementation test proves a compatibility fix is required.
- Do not change legal documents, hunter onboarding, roles or permissions.
- Do not preselect any submitted image for publication.
- Do not mutate the identified production report during automated or browser
  verification.

## Considered approaches

### 1. Selectable destination cards — selected

Use a native radio group presented as three large cards. Selecting one card
reveals only its matching workflow. This provides persistent state, works well
on mobile and with assistive technology, and requires no new server state.

### 2. Jump buttons — rejected

Make each card a button that scrolls to the existing shared composer. This is a
small code change, but both publishing paths remain visible and the operator
still has no persistent indication of the chosen destination.

### 3. Multi-page wizard or tabs — rejected

A full wizard could be clear, but it adds navigation state, keyboard and focus
complexity, and more opportunities to lose unsaved work. It is disproportionate
to this focused correction.

## Destination selector

Render a `fieldset` with the legend **Choose what happens next** and three
native radio inputs presented as full-card labels. Each card includes a short
description and a visible selected indicator.

The options are:

1. **Keep private** — no part of the report is published.
2. **Publish to Case Notes** — publish a reviewed community observation that is
   not an Official Update or official clue.
3. **Prepare an Official Update** — create the source-of-truth public Update;
   scheduling or publishing a report-derived Update requires a Verified report.

The safe default for a report with no existing public work is **Keep private**.
If an existing Case Note is being managed, select Case Notes when the drawer
opens. If an Official Update draft, schedule or publication already exists,
select Official Update. An active Official Update takes precedence if both
destinations exist.

Changing the selected destination is a local interface action only. It does not
call an API, write an audit event, change status or publish content.

## Conditional workflows

Only the panel matching the selected radio is visible. Hidden panels remain in
the current dialog state so switching back does not destroy typed copy or
prepared media, but hidden controls cannot be focused or submitted.

### Keep private

Show a concise confirmation:

> This report remains private. No public action will be taken.

Hide the public composer, preview and all publication actions. Keep the private
Review Workflow fully available because private status is a separate decision.

### Publish to Case Notes

Show:

- the reviewed public story field (Case Notes are body-only in the established
  public contract and must not show a false headline preview);
- eligible submitted-evidence cards;
- an explicit `N of 3 images selected` counter;
- the Case Note public preview;
- the existing exact-preview confirmation; and
- one final **Publish to Case Notes** action, plus withdrawal or management
  controls if a Case Note already exists.

Only ready submitted-report derivatives may be selected. Every image remains
off by default. Direct Official Update uploads do not appear in the Case Notes
workflow.

Success feedback must say:

> Case Note published. It did not create an Official Update.

### Prepare an Official Update

Show the guided Official Update workflow:

- public headline and story fields;
- ready submitted-evidence cards;
- direct Update image upload and processing controls;
- one combined maximum-three selected-media counter;
- exact public preview;
- save-private-draft action;
- scheduling and publish-now choices; and
- the existing exact-preview confirmation.

Draft preparation may follow the existing report-state rules. Scheduling and
publishing remain locked by the server until the report is Verified. When
locked, show the prerequisite and a control that moves focus to the private
Review Workflow.

## State preservation and confirmation

- Preserve entered headline, story, schedule and media selections while the
  report drawer remains open and the operator changes destination.
- Reset the exact-preview confirmation whenever the destination, public copy,
  schedule or selected public media changes.
- Closing and reopening the drawer reloads authoritative saved data. Unsaved
  local work may continue to use the existing navigation warning behavior.
- Disable the active final action while a request is in flight and preserve the
  draft after a recoverable failure.
- Repeated final submissions remain protected by the existing server-side
  idempotency and audit boundary.

## Eligibility and existing publications

The selector explains authoritative availability rather than granting it.

- Keep private is always selectable.
- Case Notes follows the existing Case Note eligibility and public-content
  guards.
- Official Update drafting follows the existing draft rules; scheduling and
  publishing require Verified.
- A destination choice remains selectable so the operator can inspect its
  workflow. Unavailable final actions stay disabled and state the exact
  prerequisite beside them.
- If a Case Note or Official Update already exists, its destination card shows
  the current public state and opens the corresponding management controls.
- Existing withdrawal and reversible-review rules remain separate and
  confirmed.

## Accessibility and responsive behavior

- Use native radio inputs inside a labelled `fieldset`; do not simulate the
  decision with clickable `article` elements.
- Give the entire card a minimum 44-pixel touch target.
- Provide visible focus, checked and disabled states using text or icons in
  addition to colour.
- Associate each option with its description using native label semantics and
  `aria-describedby` only where needed.
- Announce the newly revealed workflow heading after selection without moving
  focus unexpectedly.
- Use the `hidden` attribute or equivalent so inactive controls leave the
  accessibility and tab order.
- Stack cards and workflow controls vertically on mobile. No action row may
  require horizontal scrolling or browser zoom.
- Verify at 390-by-844 CSS pixels, 200% browser zoom and narrow desktop widths,
  in addition to normal desktop layouts.

## Data, API, privacy and audit boundaries

No migration or new persisted destination field is expected. Selection is
browser state; the existing Case Note and Official Update records remain the
authoritative persisted outcomes.

- Existing authorization remains server-enforced.
- Private contact information, private names, unapproved evidence and minor
  identities remain excluded from public projections.
- Public images remain deliberate, ready derivative selections only.
- Final publication, scheduling and withdrawal remain audited.
- Merely changing the selected card creates no audit event because it creates no
  durable state or public effect.

## Test strategy

### Test-first contract and behavior coverage

Before changing production code, add a failing test that proves the current
cards are not selectable and the workflows are not destination-specific. Then
cover:

- native, labelled destination controls replace static explanatory cards;
- a new report defaults to Keep private;
- existing Case Note and Official Update records restore the proper choice;
- only the selected destination panel is visible and focusable;
- switching choices preserves draft copy and media but clears confirmation;
- Case Notes shows only eligible submitted evidence and its final action;
- Official Update shows submitted evidence, direct uploads, draft, schedule and
  publish actions;
- unavailable actions state their authoritative prerequisite;
- choosing or switching a card causes no API mutation;
- final Case Note and Official Update actions still use their existing guarded
  endpoints; and
- no image becomes selected by default.

### Browser and responsive verification

Use disposable validation fixtures to exercise all three choices on desktop
and phone-sized viewports. Verify keyboard selection, screen-reader names,
focus order, exact-preview reset, selected-media counts and final confirmation.
Run Chrome-based QA plus the existing Edge-compatible browser contract tests.

Do not publish, schedule, withdraw, change status or select public images on the
production report used to diagnose the issue.

### Regression suite

Run typecheck, unit and integration tests, API authorization tests, media and
privacy output tests, accessibility checks, production build, broken-link and
console checks, and the existing authenticated Ops browser workflow.

## Validation and production rollout

1. Capture a read-only production baseline and confirm the source worktree is
   clean except for this task.
2. Implement test-first and build one immutable artifact.
3. Deploy that artifact to the disposable validation site.
4. Exercise all three destination paths using validation-only records, including
   three-image Case Notes and Official Updates, without publishing production
   data.
5. Run authenticated responsive and accessibility smoke checks against the
   validation deployment.
6. If every required check passes, promote the exact tested commit and asset set
   to `www.timlostsomething.com` under the production approval recorded in this
   task.
7. Confirm the live commit, asset version, routes and read-only data baseline.
   Investigate any concurrent count changes rather than assuming the deployment
   caused them.
8. Record the release and rollback point. Do not wipe or migrate the production
   database.

Any failed required test, unexpected production-data delta, authorization
regression or validation/production artifact mismatch stops promotion and is
reported instead of being worked around.
