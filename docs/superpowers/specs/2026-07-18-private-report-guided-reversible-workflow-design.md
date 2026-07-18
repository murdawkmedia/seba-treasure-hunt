# Guided and Reversible Private Report Workflow

**Date:** 2026-07-18

**Status:** Approved design; implementation not started

**Scope:** Ops Private Reports and hunter-facing private-report status

**Out of scope:** Moderation Queue behavior, legal-document text, report intake fields, automatic publication

## Summary

Make the opened Private Report understandable to an inexperienced operator,
while allowing authorized staff to correct every non-destructive workflow
mistake. Replace the special `Begin review` interaction with one guided status
control inside the opened report. Keep private review status, public Case Notes
and Official Updates as three separate decisions.

A hunter submits private source material. Their submission never becomes an
"official report" automatically. After review, an operator may keep it private,
publish an edited Case Note, or use it as the source for an Official Update.

## Goals

- Explain every internal report status in plain English.
- Let any currently authorized operator correct or reopen a report.
- Preserve an append-only history of every transition and correction.
- Prevent a status correction from publishing, republishing or unpublishing
  content implicitly.
- Give hunters a simple, truthful view of what is happening to their report.
- Preserve publication-off-by-default media behavior and all existing privacy
  protections.

## Non-goals

- Do not alter the working Moderation Queue.
- Do not permit unrestricted direct jumps between arbitrary statuses.
- Do not automatically publish a hunter submission after verification.
- Do not add a new operator role or require administrator-only overrides.
- Do not add hunter status emails in this refinement. The on-screen submission
  receipt and Hunter Dashboard are the supported status surfaces.
- Do not change Privacy Policy, Media Notice or Waiver language.

## Operator mental model

The opened report presents three separate areas in this order:

1. **Private report details and evidence** — what the hunter supplied.
2. **Review workflow** — who is handling it and what internal stage it is in.
3. **Public outcome** — keep private, publish an edited Case Note, or prepare an
   Official Update.

Changing a review status never performs a public action. Publishing never
silently changes the private review status.

## Status language

| Internal state | Operator explanation | Hunter-facing state |
|---|---|---|
| `received` | Waiting for an operator to assess it. | Received |
| `reviewing` | An operator is assessing the report. | Under review |
| `contacted` | The reporter has been contacted for more information. | Under review |
| `escalated` | The report needs additional operational or safety attention. | Under review |
| `verified` | The relevant facts have been confirmed. An Official Update may now be prepared. | Verified |
| `resolved` | Internal work on the report is complete. | Closed |
| `rejected` | The report is invalid, unsafe, duplicate or spam. | Closed |

The Hunter Dashboard does not expose internal rejection reasons, operator
assignments, private notes or escalation details.

## Reversible transition model

The workflow is guided rather than freely editable. The opened report shows
only allowed destinations for the current state.

| Current state | Allowed destinations |
|---|---|
| `received` | `reviewing`, `rejected` |
| `reviewing` | `contacted`, `escalated`, `verified`, `rejected` |
| `contacted` | `reviewing`, `escalated`, `verified`, `rejected` |
| `escalated` | `reviewing`, `contacted`, `verified`, `rejected` |
| `verified` | `reviewing`, `resolved` |
| `resolved` | `reviewing` |
| `rejected` | `reviewing` |

All backward corrections and terminal overrides return the report to
`reviewing`. A rejected or resolved report cannot jump directly to `verified`
or publication. Any authorized operator may use `Reopen for review`; no special
administrator permission is required.

`received` continues to mean untouched intake and is not a backward
destination. An operator who no longer owns a report uses a separate
`Unassign report` action without changing its status.

## Opened-report interface

Remove the separate `Begin review` button. In its place, the Review Workflow
panel contains:

- a persistent current-status badge;
- the plain-English explanation for that status;
- assigned operator or `Unassigned`;
- a `Move report to` dropdown containing only allowed destinations;
- short helper text beneath the selected destination;
- an `Apply status` button;
- `Unassign report` when an assignment exists; and
- recent status history, with a link or disclosure for the full audit trail.

Choosing a dropdown option does not save automatically. The operator must use
`Apply status`.

Moving from `received` to `reviewing`, reopening a terminal report, or taking
an unassigned report assigns the acting operator. Moving between other states
retains the existing assignment unless the operator explicitly unassigns it.

### Confirmation and reasons

- Ordinary forward transitions may include an optional private note.
- Returning to `reviewing` from another state requires a reason.
- `rejected` and `resolved` require a reason and explicit confirmation.
- `Reopen for review` requires a reason and explicit confirmation.
- `Unassign report` requires confirmation and an optional note.

The confirmation names both states, for example:

> Reopen this report from Rejected to Reviewing? This change will be recorded
> in the audit trail and will not publish anything.

## Public outcome

The Public Outcome panel remains visibly separate from Review Workflow and
offers:

- **Keep private**
- **Publish to Case Notes**
- **Prepare an Official Update**

Case Note publication retains its existing reviewed-copy rules. An Official
Update still requires a `verified` report, deliberate edited copy, individually
selected ready images and final confirmation. No image is selected by default.

When a report is not eligible, the panel explains the exact prerequisite and
links the operator back to Review Workflow. Once a report is `verified`, the
interface prominently offers `Prepare public outcome` without performing it.

### Public-content guards

- A report cannot move below `verified`, become `resolved`, or become
  `rejected` while a linked Official Update is active. The operator must
  withdraw the Update first.
- A report cannot become `rejected` while a linked Case Note is public. The
  operator must withdraw the Case Note first.
- Reopening a rejected or resolved report never republishes withdrawn content.
- Withdrawing public content never deletes the private report or its history.
- Stale or concurrent changes fail closed and require a refresh.

## Hunter experience

After submission, show a persistent success state with the report reference and
this meaning:

> Your report was sent privately to the SebaHub case team. It is not public.
> We may contact you to verify details. After review, an operator may publish
> an edited Case Note or Official Update. Your email, phone number and private
> details will not be published.

The Hunter Dashboard continues to list only reports belonging to the signed-in
hunter. Replace raw internal states with the hunter-facing states in the table
above and add a separate publication label:

- `Not published`
- `Published in Case Notes`
- `Used in an Official Update`

When a public destination exists, the label may link to that public item. A
report used in both destinations shows both. Reopening changes the private
status back to `Under review` but does not alter an existing public label.

Minor reports continue to use `Young Hunter` publicly. The dashboard remains
private and may identify the signed-in account's own report, but public outputs
must never expose a child's name, email, phone number or account identifier.

## Data and API design

No new database table is required.

- Extend the shared transition contract with the approved reversible paths.
- Continue recording every transition in `report_events` and `audit_events`.
- Audit metadata records previous state, new state, actor, reason, assignment
  change and timestamp.
- Add an audited unassign mutation or extend the existing report patch contract
  with an explicit unassign operation. A missing assignment value must not be
  interpreted as an unassign request.
- Extend the hunter dashboard's private report projection with a derived,
  privacy-safe status label and linked publication destinations. Do not expose
  operator notes, staff identity, rejection reasons or private evidence.
- Continue enforcing transitions and publication guards on the server. The
  browser is never the authorization boundary.

## Error handling

- A failed status mutation leaves the visible state unchanged and preserves the
  operator's entered reason for retry.
- A stale transition returns a conflict message and offers `Refresh report`.
- A public-content guard names the active destination and offers the applicable
  withdrawal action.
- A failed assignment change cannot append a misleading success audit event.
- Repeated identical mutation requests must not create duplicate state events.
- Network or provider failures never default a report to a more permissive
  state.

## Accessibility and responsive behavior

- The dropdown has a persistent label and associated helper text.
- Status meaning is conveyed by text, not colour alone.
- Confirmation and error messages use an announced status region.
- All controls meet the existing 44-pixel mobile target standard.
- Keyboard focus returns to the triggering control after a confirmation closes.
- On narrow screens, Review Workflow appears before Public Outcome; neither
  requires horizontal scrolling.

## Verification

### Transition and audit tests

- Every allowed transition succeeds and appends one report event plus one audit
  event with the correct old/new states.
- Every disallowed direct jump fails without changing state or audit history.
- `resolved -> reviewing` and `rejected -> reviewing` work for any authorized
  operator and require a reason.
- Reopening assigns the acting operator.
- Unassigning preserves status and records the change.
- Concurrent and repeated transition attempts remain atomic and idempotent.

### Publication tests

- A status change never creates, publishes, withdraws or republishes public
  content.
- Active Official Updates block backward and terminal transitions as designed.
- A public Case Note blocks rejection until withdrawal.
- Verified reports expose publication preparation while ready images remain
  unselected.
- Reopened reports require review again before an Official Update can publish.

### Hunter and privacy tests

- Submission confirmation explains private intake and possible edited public
  outcomes.
- Dashboard states use only the approved hunter-facing labels.
- Publication labels match linked public records and expose no private data.
- Rejection reasons, staff identities, audit notes and evidence never appear in
  the hunter or public API.
- Minor public attribution remains `Young Hunter`.

### Interface tests

- `Begin review` is absent from the opened report.
- The dropdown does not save on selection.
- Each status displays its explanation and only allowed destinations.
- Backward, terminal and reopen actions require the correct reason and
  confirmation.
- Desktop, mobile, keyboard, zoom and screen-reader checks pass.

## Rollout

Implement and test locally, then deploy to the disposable validation
environment. Exercise forward movement, backward correction, rejection,
reopening, assignment, unassignment and all three public outcomes using only
validation records. Production promotion requires Murphy's explicit approval
after authenticated owner testing. No production report is to be changed as
part of deployment verification.
