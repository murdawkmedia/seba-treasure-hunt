# Guided Official Update Publishing and Ops Clarity

**Date:** 2026-07-18

**Status:** Approved design; implementation plan not started

**Target:** Disposable validation first; production only after explicit owner approval

**Scope:** Standalone Official Updates, report-derived Official Updates, and a
plain-language usability pass across the Ops dashboard

## Summary

Make publication understandable to an operator who has never used the Case
Room before. Replace the current collection of simultaneously disabled actions
with a guided workspace that always explains the current state, the next safe
action, and any blocking prerequisite.

Both standalone and report-derived Official Updates use one draft-first media
and publication system. An operator can attach up to three images, inspect the
exact public result, publish immediately or schedule it. A report-derived
Official Update remains locked until its private source report is **Verified**.
Case Notes remain a separate public destination and nothing auto-publishes.

This design refines the interface portions of the July 17 Submission, Ops and
Publication Refinement design and the July 18 Guided and Reversible Private
Report Workflow design. Their privacy, authorization, audit, reversible-state
and public-content guards remain in force.

## Goals

- Let an inexperienced operator understand what to do without training.
- Support zero to three images on standalone and report-derived Official
  Updates through the same preparation and publication pipeline.
- Explain every unavailable action beside the action itself.
- Preserve private drafts, selected-media controls, exact public previews,
  scheduling, withdrawal and audit history.
- Keep private report review status separate from public publication.
- Improve responsive, keyboard and screen-reader behavior throughout Ops.
- Preserve existing production users, reports, evidence and published content.

## Non-goals

- Do not redesign authentication, roles or the authorization boundary.
- Do not change legal documents, participant acceptance or hunter onboarding.
- Do not automatically publish a report, Case Note, image or draft.
- Do not make private originals publicly addressable.
- Do not change the Moderation Queue's working publication semantics.
- Do not introduce a second image-processing policy or storage system.
- Do not edit, migrate or test mutations against live production records.

## Operator mental model

Every important Ops workflow answers three questions in plain language:

1. **Where am I?** The current state is named and explained.
2. **What should I do next?** One recommended action is visually primary.
3. **Why can I not do something yet?** Every locked action names its unmet
   prerequisite and points to the place where it can be completed.

The interface never expects an operator to infer workflow meaning from a grey
button. Internal terms may appear in audit details, but task controls use plain
language.

## Shared publication architecture

Use one Official Update entity for standalone and report-derived publication.
The current schema already supports this boundary:

- `official_updates` stores draft, scheduled, published and withdrawn Updates;
- `official_update_uploads` owns private direct uploads by `update_id`;
- `official_update_uploaded_media` records the deliberate public selection,
  order, alt text and caption for those uploads; and
- `official_update_media` records deliberately selected report evidence.

No database migration is expected. The implementation must confirm this
against validation before treating the schema as final.

Generalize the current report-scoped upload operations into a shared
update-scoped publication service. The report workflow may retain compatible
report routes as a thin facade, but storage, validation and public selection
must not be duplicated.

The shared service has four isolated responsibilities:

1. **Draft service** — creates and updates private Official Update copy.
2. **Media service** — prepares, uploads, processes and retrieves private
   Update-owned derivatives.
3. **Selection service** — records the maximum three ready derivatives that
   the operator deliberately includes, with order and alt text.
4. **Publication service** — validates prerequisites and performs save,
   schedule, publish-now and withdrawal actions atomically and audibly.

Server authorization and publication guards remain authoritative. Browser
state may explain availability but never grants it.

## Shared publishing contract

A standalone composer first creates a private draft and receives an Update ID.
Only then can direct images be uploaded. A report-derived composer uses the
same Update ID model and additionally retains its private `source_report_id`.

The implementation may preserve compatible existing routes, but the logical
contract is update-scoped:

- create an Official Update draft;
- edit the draft title, body and optional schedule;
- add or retrieve Update-owned media;
- select up to three ready media items for the public output; and
- save, schedule, publish now or withdraw the Update.

Repeated identical mutations must be idempotent. Public readers receive only
published or due scheduled Updates and only ready, explicitly selected public
derivatives.

## Standalone Official Updates workspace

The Official Updates screen uses three numbered stages.

### 1. Write the Update

The operator enters a headline and answer-first story. The primary action is:

> **Save draft & continue**

Supporting copy states that saving does not publish anything. The draft ledger
must preserve the new draft so the operator can leave and continue later.

### 2. Add images

Once the draft exists, activate a file picker for up to three JPEG, PNG or WebP
images. Reuse the existing browser preparation policy: a supported source of
20 MB or less may upload directly; supported sources over 20 MB through 50 MB
must be prepared below the server's 20 MB limit. Do not introduce a different
policy for standalone Updates.

Each file shows preparation, upload, processing, ready or failed state. A
failure identifies the file and offers retry or removal without clearing the
draft copy.

Every uploaded image remains private and unselected by default. The image card
states:

> Uploaded privately — check **Include in this Update** to make its approved
> derivative public.

Alt text becomes required only when the image is selected. The operator can
remove, reorder and choose the lead image before publication. The workspace
shows a persistent `N of 3 images selected` counter.

### 3. Review and publish

Render the exact public preview, including title, body, publisher label,
timestamp behavior and selected images. One confirmation checkbox covers that
exact preview and renders as one semantic and visual control.

The operator chooses one of two final outcomes:

- **Publish Official Update now**
- **Schedule Official Update** with a future Edmonton date and time

Only the action matching the current decision is visually primary. The final
confirmation names the destination and timing. Nothing else in the workspace
can publish implicitly.

## Update ledger

The ledger includes Draft, Scheduled, Published and Withdrawn records.

- Drafts provide **Continue editing**.
- Scheduled Updates show their Edmonton publication time and provide the
  existing safe withdrawal/rescheduling path.
- Published Updates provide **Open public Update** and the existing deliberate
  withdrawal path.
- Withdrawn Updates remain visible for audit and recovery context.

Loading or empty states explain what the operator can do. `Source not loaded`
is not a terminal message; it includes **Retry loading Updates** and preserves
any unsaved composer text.

## Private Report public outcome

The opened report keeps two visually separate work areas:

1. **Private review workflow** — status, assignment, evidence and audited
   internal decisions.
2. **Public outcome** — keep private, publish to Case Notes or prepare an
   Official Update.

The destination choices explain their meaning:

- **Keep private** — no part of the report is published.
- **Publish to Case Notes** — publish an operator-reviewed community
  observation; it is not an official case update.
- **Prepare an Official Update** — create the source-of-truth public Update;
  publishing requires a Verified report.

An operator may save the public copy as a draft and prepare images before the
report is Verified. Schedule and publish remain server-locked until
verification. When locked, the workspace says:

> **Locked until this report is Verified.** Complete the private review before
> publishing this as an Official Update.

It provides **Go to Review workflow**, which moves focus to the status control
and its required next action.

A rejected or resolved report can be reopened by an authorized operator using
the approved reversible workflow, but must pass through Reviewing and Verified
again before its Official Update can publish. Status changes never publish,
withdraw or republish content.

## Report media selection

Present submitted evidence and direct Update uploads in one public-selection
area with one maximum-three counter.

- Submitted evidence remains private unless its ready derivative is checked.
- Direct uploads remain private unless their ready derivative is checked.
- No image is selected by default.
- Processing or failed images cannot be selected.
- Alt text is required for every selected image.
- The exact checked images appear in the final public preview.

If selected media are processing, publication stays locked and the interface
names those files. The operator may wait, retry, remove them or publish without
them after deliberately deselecting them.

## Guided action states

The publishing workspace derives one visible stage from authoritative data.

| State | Primary action | Explanation for later actions |
|---|---|---|
| No draft | Save draft & continue | Images and publication require a saved private draft. |
| Draft saved | Add or select images | Nothing is public; media preparation is optional. |
| Media processing | Review progress or retry | Publication waits for selected media to become ready. |
| Report not Verified | Go to Review workflow | Draft preparation is allowed; public release is locked. |
| Ready for preview | Review exact public preview | Confirmation is required before scheduling or publishing. |
| Ready to publish | Publish now or schedule | The chosen final action is explicit and audited. |
| Scheduled | Open scheduled Update | The public feed remains unchanged until the scheduled time. |
| Published | Open public Update | Any withdrawal is separate and confirmed. |

Do not present every possible action as an equal row of disabled buttons. Show
the current stage's primary action and keep future actions visible only where
their locked explanation helps the operator understand the sequence.

## Ops-wide clarity standard

Apply the same guidance rules to actionable screens throughout the Case Room,
including Command Desk, Official Updates, Private Reports, Moderation Queue,
Search Zones, Rules, Players, Users & Access and Audit Trail. This pass changes
guidance and presentation, not business rules.

For each mutation or decision:

- show the current state in text, not colour alone;
- identify one recommended next action;
- place destructive or withdrawal actions separately;
- explain every unavailable action inline;
- show progress while work is running;
- announce whether the result was private, scheduled or public;
- link directly to the resulting public or internal record where appropriate;
- provide a retry or recovery path for load and provider failures; and
- preserve entered work when a recoverable error occurs.

Empty states explain whether there are no records, access is missing or the
source failed to load. Tooltips may supplement labels but cannot contain the
only explanation because touch and keyboard users must receive the same help.

## Success and failure messages

Success feedback states exactly what happened:

- `Draft saved privately. Nothing was published.`
- `Three images uploaded privately. Select the images to include.`
- `Official Update scheduled for Jul 20, 2026 at 9:00 a.m. MDT.`
- `Official Update published. Open the public Update.`
- `Case Note published. It did not create an Official Update.`

Errors preserve the operator's copy and identify the recovery action. A failed
publication leaves the Update as a draft. A failed schedule does not expose the
Update. A failed image does not remove ready images. A stale or concurrent
change fails closed and offers a refresh without claiming success.

Prevent duplicate records from repeated clicks by disabling the active action
while it is running and enforcing request idempotency on the server.

Warn before navigating away from unsaved changes. Do not warn after a
successful explicit save.

## Authorization, privacy and audit

- Existing Ops authorization remains unchanged.
- Draft creation, edits, uploads, selections, schedules, publications,
  withdrawals and report-state changes remain audited.
- Private review status and public publication remain separate actions.
- The Verified prerequisite is enforced by the server for report-derived
  scheduling and publication.
- Contact details, private names and minor identities never become public.
- An operator-approved waypoint and submitted GPS remain eligible public game
  facts through the existing allowlisted report fields.
- Unverified claims and all other private fields remain excluded from public
  copy.
- Private originals never receive public URLs. Public outputs use only ready,
  metadata-free derivatives.
- Directly uploaded images remain publication-off by default.

## Responsive and accessible behavior

On desktop, the opened report may use two columns only while both columns are
fully visible. On narrow laptops, browser zoom and mobile screens, it becomes a
single document flow in this order:

1. private report details and evidence;
2. private Review Workflow;
3. public copy and media selection;
4. exact preview and final action.

No status control or action row may sit below an independently scrolling panel
where it is difficult to discover. The dialog stays within the visual viewport
and provides one obvious scroll container.

Additional requirements:

- 44-pixel minimum touch targets;
- buttons wrap vertically rather than overflowing;
- persistent visible labels for inputs and file controls;
- a text label such as `Close review` for close controls;
- focus moves to the active stage after a successful action;
- errors and status changes use announced live regions;
- confirmation dialogs trap and restore focus correctly; and
- no critical guidance depends on hover.

## Verification

### Shared publishing tests

- A standalone Update saves as a private draft before any upload.
- Zero, one and three selected images publish correctly.
- A fourth selected image is rejected without losing the first three.
- Files at or below 20 MB use the supported direct path; supported files over
  20 MB through 50 MB use browser preparation; unpreparable files receive a
  specific error.
- Uploaded images remain private and unselected until explicitly checked.
- Selected images require alt text and appear in the exact preview order.
- Draft, scheduled, published and withdrawn states appear correctly in the
  ledger.
- Scheduling remains private before the due time and becomes public once.
- Duplicate publish attempts create only one public Update.

### Report workflow tests

- Operators can save report-derived copy and prepare images before
  verification.
- Schedule and publish fail in both UI and API until the report is Verified.
- `Go to Review workflow` focuses the current status control.
- Rejected and resolved reports can be reopened but cannot jump directly to
  publication eligibility.
- Submitted evidence and direct uploads share one maximum-three selection.
- Case Note publication never creates an Official Update.
- Review status changes never publish, withdraw or republish content.

### Recovery and audit tests

- Image, network and provider failures preserve draft copy.
- A failed publish leaves the record private and auditable.
- A stale mutation shows a refresh path and no false success.
- Every successful mutation records the actor, target, action and timestamp.
- Success messages correctly distinguish private, scheduled and public states.

### Ops usability tests

- Every disabled actionable control has a visible reason.
- Every actionable screen has a current state, recommended next action and
  recovery path.
- Empty and unavailable sources have distinct explanations.
- Chrome and Edge pass at 100%, 125% and 150% Windows scaling.
- iPhone-sized Safari and Android-sized Chrome layouts require no horizontal
  scrolling or browser zoom.
- Keyboard, focus, screen-reader announcements and high-contrast rendering
  pass for the shared guidance and publication controls.

## Rollout

Deliver in two validation checkpoints:

1. Shared draft/media/publication service plus the guided standalone and
   report-derived Official Update workspaces.
2. The Ops-wide clarity and responsive-behavior audit using the same guidance
   components and language.

Use only disposable validation records for mutation tests. The read-only
production snapshot may be used to verify rendering but never to exercise
actions. Existing production users, reports, evidence and public Updates remain
untouched.

Run unit, integration, authorization, media, accessibility, typecheck,
production-build and authenticated browser checks before presenting validation
to Murphy. Production promotion requires explicit approval after owner testing
and a protected production-data baseline comparison.
