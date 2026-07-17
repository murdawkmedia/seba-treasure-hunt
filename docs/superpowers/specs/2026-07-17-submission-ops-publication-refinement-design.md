# Submission, Ops and Publication Refinement Design

**Date:** July 17, 2026

**Status:** Approved design

**Target:** Validation first; production only after explicit owner approval

## Purpose

Refine the working Tim Lost Something hunter and operator experience without
rebuilding the platform or disturbing real production accounts, reports,
updates, evidence or legal records. The release must make the distinction
between Case Notes, private reports and official Updates unmistakable, give
operators a safe draft-first publication workflow, improve public attribution
and media handling, and align the private Ops presentation with the public
Documentary Case File design.

The live Nancy & Ron Update and its source report remain unchanged unless an
authorized operator deliberately edits or withdraws them through the audited
production workflow.

## Decisions in Force

- Production remains authoritative. Validation writes only to disposable
  validation resources; the production snapshot remains read-only.
- Existing production accounts and handles remain valid and are never forced
  through replacement onboarding.
- Private report status and public publication are separate decisions.
- Nothing submitted privately auto-publishes.
- Legal names, contact information, private originals and children's
  identities never become public through this workflow.
- Routine discoveries belong on Case Notes. Official Updates are reserved for
  meaningful, verified or operationally important developments.
- The Lucky 13 remains a fixed set of thirteen stops.
- Existing legal-document language, acceptance records, account-provider
  behavior and exact-route access controls remain unchanged.
- Public media consists only of explicitly selected, metadata-free
  derivatives. Private originals never receive public URLs.

## Delivery Strategy

Implement the design in one feature branch with three validation checkpoints:

1. Submission trust, human verification, media-count, checkbox and routing
   corrections.
2. Attribution, report review, Case Note publication and draft/scheduled
   official Updates.
3. Shared approved-media viewer, direct Update uploads and Ops visual
   alignment.

Each checkpoint must pass automated and manual verification before the next is
promoted to the stable validation URL. Production promotion remains a separate
owner-approved action.

## Environment and Data Boundaries

Validation uses its disposable D1, R2 and authentication configuration for all
normal actions. Staff may inspect the existing full-fidelity production
snapshot, but snapshot routes remain GET-only and expose no publication,
moderation, email or mutation action.

Before any production promotion, record protected D1 row counts, foreign-key
health and referenced R2 object counts. Repeat the same read-only checks after
deployment. Validation testing must not send production operator alerts or
participant mail.

Any required schema evolution is additive and forward-compatible. The design
may add attribution snapshots and source relationships, but it must not rewrite
existing report, profile, update or media records.

## Public Submission Paths

### Case Notes

Use the public identity **Case Notes** for moderated community observations.
The route remains `/clue-board` for compatibility. Navigation and contextual
links distinguish three actions:

- **Read Case Notes**
- **Share a Case Note**
- **Report a Find Privately**

The Case Note form states that approved notes may become public but are not
official clues. If the visitor appears to be reporting a find or sensitive
evidence, a prominent link sends them to the private report form.

The submission receipt states that the note and media were received for
moderation, shows a reference, and explains that nothing is public yet.
Idempotency protection prevents an accidental repeat from creating duplicate
notes.

### Private reports

The private report form states that evidence, contact information and the
unedited report remain private. Its receipt shows the report reference and
explains that a later public Case Note or Update requires a separate operator
decision.

The two forms cross-link using plain language. No success message may imply
that a report was published, approved or converted into a clue.

## Case Note Moderation Repair

Pending-note queries return an authoritative media count and each media item's
processing state. The Ops queue must distinguish `processing`, `ready` and
`failed` rather than silently displaying zero images.

Operators can inspect the full approved derivative for every ready image before
moderation. Public-image selection is off by default. Approving text does not
implicitly approve media, and failed or processing media cannot be selected.

The moderation confirmation presents the exact public note body,
attribution, stop and selected images. It records the operator and result in
the audit trail.

## Human Verification

Keep server-side Turnstile verification, rate limiting and moderation. Use a
separate validation widget configuration so experiments cannot change
production behavior.

Add privacy-safe client events for widget rendered, verified, expired, errored
and reset states. Never log or persist a Turnstile token. Guard every form
against duplicate widget rendering and record the application reason for a
reset.

Test VPN on/off, Chrome, Edge, mobile Wi-Fi and mobile cellular. Inspect
Turnstile analytics for interactive solves, retries, timeouts and failures. If
ordinary non-VPN visitors encounter repeated interaction, use Non-Interactive
Turnstile for public submission forms while keeping the same server-side
verification boundary.

## Lucky 13 Labels

Replace long `Waypoint` labels in visitor and Ops controls with concise
`Stop NN · Name` labels. Examples include:

- `Stop 04 · Seniors Centre`
- `Stop 05 · Derby's General Store`
- `Stop 11 · Driving Range / Digger Café`

Report and Case Note selectors contain:

- Not sure which stop
- Different location / outside the Lucky 13
- Stop 01 through Stop 13

Stable waypoint IDs, route order, stories, photos and authenticated map access
do not change. Future locations are Additional Search Areas or New Leads, never
Stop 14.

## Public Identity and Attribution

The private account profile retains the participant's legal or full name for
waivers, receipts, account support and operator contact. Do not derive a public
identity from the email address or automatically expose the first token of a
legal name.

Adults may set an optional public display name such as `Nancy & Ron`. The
existing generated handle, such as `Hunter 43BA`, remains the privacy-safe
default. Every report requires an explicit public-attribution choice:

- use my public display name;
- use my anonymous hunter handle;
- publish as Community Hunter.

The previous selection may be remembered for convenience, but the choice is
shown again on each report. The selected public attribution is snapshotted with
the submission so a later profile edit cannot silently change it.

Accounts marked `minor_guardian_permission` always publish as `Young Hunter`.
Their chosen handle, display name and legal name remain private. Anonymous or
unlinked eligible submissions publish as `Community Hunter`.

The Ops public preview displays the exact allowed attribution. An operator may
select only from attribution values authorized by the submission; the private
reporter name is not an implicit public option.

## Private Report Review Workflow

Present report handling as a clear state machine:

1. Received
2. Reviewing
3. Needs follow-up, Contacted or Escalated
4. Verified or Rejected
5. Resolved

**Begin review** assigns the current operator where appropriate and changes the
visible status to Reviewing. The disabled button is replaced by a persistent
status pill, assignment and clear next actions. Every state mutation receives
an explicit success or failure message and an audit event.

Operators may prepare public copy while a report is under review, but an
official Update cannot become public until the report is verified. A report
may be verified or resolved without any public output.

## Publication Destinations

The review experience offers three deliberate outcomes.

### Keep private

Continue the investigation or resolve the report without publishing any part
of it.

### Publish to Case Notes

Create an **Operator-reviewed Case Note** from an allowlisted preview. It may
contain the edited story, selected public attribution, Lucky 13 stop, approved
GPS and explicitly selected derivatives. It is not an official clue and does
not appear in the official Updates feed or the homepage's latest official
update slot.

The public Case Note retains a private source relationship to the report for
authorization and audit purposes. The public API never exposes the source
report identifier or private fields.

An Operator-reviewed Case Note can later be promoted to an official Update
without re-uploading media or copying private content. The interface shows
existing destinations and prevents accidental duplicate publication. Case
Notes and Updates can be withdrawn independently.

### Create an official Update

Open a draft-first Update composer populated only from the allowlisted public
preview. Operators can edit the headline and body, select attribution, stop,
GPS and media, and preview the exact result.

Available actions are:

- Save draft
- Schedule
- Publish now
- Withdraw

Publishing now requires a final confirmation. Scheduling uses the existing
`scheduled_for` and publication-time fields with server-time, time-gated
visibility. The public feed must not reveal scheduled content early, and due
content must become visible without a second manual publication action.

The interface provides editorial guidance rather than a hard publication
quota: routine findings belong on Case Notes, while official Updates cover
meaningful evidence, new clues, safety changes or major case developments.

## Direct Official Update Media

The Update composer accepts up to three JPEG, PNG or WebP images. Reuse the
existing browser preparation, R2 storage, metadata stripping and derivative
pipeline. Apply the current source-size and prepared-payload limits rather than
creating a second upload policy.

Show preparation and upload progress, failure and retry states. Operators can
remove, reorder and choose a lead image, enter alt text and an optional short
caption, and preview the public result. No image is selected for publication by
default.

## Shared Approved-Media Viewer

Use one accessible viewer for official Updates, Operator-reviewed Case Notes,
community Case Notes, Ops previews and Lucky 13 galleries.

- Thumbnails preserve the full composition with `object-fit: contain`.
- Decode phone/EXIF orientation before removing metadata so derivatives do not
  appear sideways.
- Each thumbnail is a real link to the full approved derivative, preserving
  browser open-in-new-tab behavior without JavaScript.
- Normal activation opens a responsive lightbox scoped to the current Update,
  Case Note or waypoint gallery.
- Multiple images provide previous/next controls and an image count.
- The viewer exposes useful alt text and captions, supports `Escape`, backdrop
  close and a visible close button, and restores focus to its trigger.
- Mobile presentation uses the available viewport without horizontal
  overflow. Keyboard focus remains trapped while the viewer is open.
- Thumbnails lazy-load with reserved dimensions to prevent layout shift.
- Private original URLs and object keys never enter public markup or APIs.

## Checkbox Rendering Repair

The Ops publication confirmation currently renders one semantic checkbox as
multiple overlapping visual boxes. Replace it with one visible control and one
associated label. The full label receives a comfortable pointer target while
the native input remains keyboard and assistive-technology accessible.

Verify unchecked, checked, disabled and focus-visible states in Chrome and
Edge at 100%, 125% and 150% Windows scaling, on mobile, and in Windows
high-contrast mode. Repair the shared component anywhere else the same defect
appears.

## Ops Documentary Design Alignment

Retain the information density and privacy boundaries of the staff console,
but replace its remaining pirate-era presentation.

- Remove Pirata One, IM Fell English and Special Elite from Ops.
- Use the shared Documentary Case File typography: editorial serif headings,
  clean sans-serif body copy and restrained monospace labels.
- Replace the `T?` seal with the approved missing-ID/question-mark campaign
  mark and identify the area plainly as the Tim Lost Something Case Room.
- Use the shared dark green, cream, gold and restrained evidence-red tokens.
- Standardize navigation, account controls, buttons, inputs, status pills,
  dialogs, spacing and focus states.
- Use evidence red for warnings or destructive actions, not decoration.
- Improve the long report-review dialog for laptop and mobile viewports while
  keeping private and public preview regions visually distinct.
- Keep destructive, state-change and publication actions clearly separated.

Presentation changes do not alter Ops authorization, APIs, data visibility or
audit requirements.

## Error and Recovery Behavior

- A media-processing failure shows the affected file and retry path without
  losing the report or prepared public copy.
- A failed state change leaves the prior state visible and does not
  optimistically claim success.
- A failed publication leaves the draft intact and does not mark the report
  verified or published.
- A scheduling failure leaves the Update as a draft.
- An expired or failed Turnstile challenge gives one clear retry path.
- Missing public media shows a bounded unavailable state and never falls back
  to the private original.
- Repeated submissions reuse idempotency keys where the existing API contract
  supports them.

## Testing and Acceptance

Implementation follows test-driven development. Automated coverage must prove:

- pending Case Notes return correct media counts and states;
- public-image selection remains off by default;
- duplicate submit retries do not create duplicate records;
- private and public submission receipts describe the correct destination;
- Turnstile renders once, resets only for recorded reasons and remains
  server-validated;
- selectors expose the fixed Lucky 13 plus the two non-stop options;
- adult attribution choices are preserved and legal names remain private;
- minor names and handles never reach public APIs or publication previews;
- report state transitions, assignments and audit events remain valid;
- Case Note publication does not create an official Update;
- official drafts and scheduled Updates remain private before their time;
- due scheduled Updates become publicly visible exactly once;
- publication and withdrawal are authorized, idempotent and audited;
- only selected ready derivatives can become public;
- right-click image URLs resolve only approved derivatives;
- private object keys never appear in public HTML or API output;
- validation actions cannot mutate production or snapshot resources.

Manual end-to-end review covers hunter onboarding, both submission paths,
large-image preparation, Case Note moderation, private-report review, every
publication destination, scheduling, withdrawal, public attribution, the media
viewer, Windows scaling, mobile layout, keyboard navigation and Turnstile with
VPN on and off.

Before production promotion, run the full unit, integration, static,
accessibility, typecheck, legal-artifact and production-build suites. Record a
production baseline, deploy only after owner approval, smoke-test public and
Ops routes, and prove the protected production baseline remains intact.

## Out of Scope

- Rebuilding the dashboard framework or authentication provider
- Replacing the waiver, Privacy Policy or Media Notice
- Publishing validation content to production
- Wiping, reseeding or editing existing production accounts
- Exposing private originals or contact information publicly
- Automatically turning every report into a Case Note or Update
- Adding a Stop 14
- Enforcing a fixed number of official Updates per day
- Changing the current live Nancy & Ron Update as part of migration
