# Mobile Signup and Account Recovery Design

## Summary

Stabilize Hunter account creation and return sign-in for ordinary mobile users,
especially people who switch to an email app during verification. Keep privacy
and waiver acceptance separate and explicit, but remove the artificial rule
that a participant must open both full documents before the acceptance boxes
become available.

This is a validation-first usability and state-machine repair. It does not
change the authoritative Privacy Policy, Media Notice, Participation Waiver,
legal document versions or hashes, password ownership, account schema, or the
production database.

## Confirmed Problems

The current legal viewer and account state machine have several independent
failure paths:

- Each signup legal dialog has only a top-right X. There is no obvious textual
  return action at the bottom of the long document.
- The iframe receives `embed=signup`, but the legal pages do not consume that
  mode. They render the full case strip, navigation and footer inside the
  dialog.
- The waiver's `Return to registration` link navigates inside the iframe.
  Because Dashboard cannot be framed, this can leave a blank or failed nested
  page while the outer dialog remains open.
- A document is considered reviewed when its iframe finishes loading, even if
  the participant did not read or deliberately acknowledge it.
- The pending Clerk signup, legal identities and signup draft are held only in
  JavaScript memory. Mobile reload, tab eviction or an email-app round trip can
  erase the visible verification step.
- Clerk session activation occurs before D1 profile/legal finalization. A slow
  webhook can leave a valid verified session presented as unavailable or
  signed out.
- Password sign-in treats every provider state other than `complete` as a
  generic failure rather than routing or explaining the required next step.
- The shared header and Dashboard create separate Clerk instances. The header
  can continue to say `Sign in` after an in-page signup or sign-in.

## Approved Interaction Model

### Account setup

Keep one account form for the first release. Retain name, email, password,
adult/minor participation basis and guardian permission as currently defined.
The legal section changes to:

- show a short plain-language explanation;
- show separate links/buttons to read the current Privacy Policy & Media Notice
  and Participation Waiver;
- show both required acceptance checkboxes immediately, enabled and unchecked;
- require both boxes before account creation;
- continue storing the exact active version, hash, subject and timestamp only
  after the verified account is successfully finalized; and
- never infer acceptance from opening, loading, scrolling or closing a
  document.

Privacy/media acceptance and waiver acceptance remain separate records. No
button checks either box automatically.

### Legal document viewer

When a participant chooses to read a document, open a clean dialog/sheet:

- render an embed-only document body without case status, site navigation,
  footer, account controls or a nested Dashboard link;
- retain the authoritative legal body unchanged;
- show a labelled `Close and return to account setup` control in the header;
- show a sticky bottom `Done — back to account setup` control;
- allow Escape and backdrop dismissal where supported;
- restore focus to the button that opened the dialog;
- preserve the participant's form values and scroll position; and
- provide a normal new-tab link as a progressive fallback.

Closing the viewer means only that the viewer was closed. It does not record or
preselect legal acceptance.

### Verification and resume

After Clerk sends the code, show a dedicated verification step containing:

- the masked destination email;
- code entry and Verify action;
- Resend code;
- Change email / return to account setup; and
- concise live-region status messages.

Persist only non-secret recovery state needed to rediscover the step, such as
the masked/normalized email, legal document identities, participation fields
and the current stage. Never persist the password, verification code, session
token or provider secret. On reload:

1. reconnect to Clerk's provider-managed pending signup when available;
2. restore safe draft fields and the verification screen;
3. if the provider attempt cannot be resumed, explain that clearly and offer a
   clean restart or ordinary sign-in; and
4. never silently reset the participant to the beginning.

### Verified account finishing state

Once Clerk verifies the email and activates a session, switch to a dedicated
`Email verified — finishing your account` state. This state:

- does not show the password sign-in form;
- retries webhook-backed bootstrap with bounded, increasing waits long enough
  for normal provider delivery;
- runs idempotent profile/privacy/waiver finalization;
- shows progress and a manual Retry action;
- distinguishes a temporary synchronization delay from invalid credentials;
- resumes unfinished profile/privacy/waiver steps without repeating completed
  work; and
- provides support-safe diagnostic wording without exposing provider or
  database details.

A valid Clerk user whose D1 record is delayed must never be rendered as signed
out. Permanent failure remains recoverable on refresh or a later sign-in.

### Returning sign-in

Ordinary password sign-in continues to be the primary returning-user flow.
Handle provider statuses deliberately:

- `complete`: activate and load the Dashboard;
- additional supported verification: present its continuation step or clear
  recovery guidance;
- unfinished signup: resume verification/setup instead of creating another
  account; and
- invalid credentials: show the existing password/recovery guidance.

Use one effective Hunter Clerk/session source for both the shared header and
Dashboard. Auth-state changes update the header, account menu and Dashboard
without a page reload.

## Accessibility and Mobile Contract

- All legal dialog controls have descriptive accessible names and at least a
  44 by 44 CSS-pixel target.
- The dialog heading is announced and focus remains trapped inside while open.
- Close, Escape and bottom Done restore focus to the invoking control.
- Verification, synchronization, resend and error messages use appropriate
  polite or assertive live regions.
- Hidden steps are not keyboard- or screen-reader-focusable.
- Acceptance rows have comfortably sized touch targets; native inputs remain
  associated with their full labels.
- The flow remains usable at 390 by 844, 200% zoom, reduced motion and keyboard
  only, with no horizontal scrolling.
- The embedded legal body has no nested site chrome and no link that can load
  Dashboard inside the iframe.

## Data and Security Boundaries

- Clerk continues to own password storage, password recovery, verification
  codes and sessions.
- D1 continues to own player profile, consent history, legal acceptance and
  hunt activity; it never stores passwords or reset codes.
- Session storage, if used, contains only a minimal non-secret resume draft and
  is cleared after completion, explicit restart or sign-out.
- Exact legal document identity is rechecked before final acceptance. A
  document change during verification requires one clear fresh acceptance.
- Finalization remains idempotent and append-only legal acceptance semantics
  remain intact.
- Production users and records are never copied, reset or mutated during
  validation testing.

## Error Handling

- Legal embed failure: keep acceptance boxes usable, offer the full document in
  a new tab, and explain the viewer error without losing the form.
- Lost provider attempt: show a clean resume/restart choice; do not loop.
- Webhook/bootstrap delay: remain in the finishing state with bounded retry.
- Partial finalization: query current server state and continue only missing
  steps.
- Outdated document: return to the legal section, identify the changed
  document, clear only its acceptance and require fresh acceptance.
- Additional provider verification: show an actionable continuation or direct
  the participant to password recovery; never use a generic dead-end error.

## Verification Plan

Automated and browser validation must cover:

- privacy and waiver boxes are enabled, separate, required and initially
  unchecked;
- iframe load/close never checks acceptance;
- embed-only legal output contains no case strip, nav, footer or Dashboard
  return link;
- top, bottom, Escape and backdrop exits restore focus and preserve form state;
- signup code sent, email-app visibility change and page reload resume the
  provider-backed verification step without persisting secrets;
- resend and change-email paths;
- verification followed by webhook delays of 0, 5 and 30 seconds;
- permanent bootstrap failure shows retry instead of sign-in;
- verified account with missing profile, privacy or waiver resumes exactly the
  next incomplete step;
- ordinary return sign-in, wrong password, password recovery and supported
  additional provider states;
- shared header updates immediately after sign-in/sign-out;
- adult and minor/guardian flows;
- document-version change during verification;
- keyboard, accessible-name, focus order, live-region and axe checks;
- 390 by 844 mobile layout, 200% zoom and reduced motion; and
- no external writes in anonymous/read-only QA and disposable validation-only
  writes in authenticated end-to-end acceptance testing.

## Rollout

Implement and test locally first. Deploy only to the `codex-validation` Pages
branch with Preview bindings. Run a disposable mobile signup, reload during
email verification, sign out and sign back in, and delayed-bootstrap checks.
Production promotion remains a separate explicit decision after owner review.

## Non-Goals

- No multi-page wizard in this stabilization release.
- No combined privacy/waiver acceptance.
- No automatic checkbox selection.
- No change to legal bodies, versions, hashes or retention rules.
- No social login, SMS, new account schema or production data migration.
- No restoration workflow for moderation-hidden Case Notes.
