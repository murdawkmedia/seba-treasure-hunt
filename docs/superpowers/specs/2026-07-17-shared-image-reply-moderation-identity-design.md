# Shared Image, Reply Moderation and Public Identity Design

**Date:** July 17, 2026

**Status:** Owner-approved design

**Target:** Validation first; production only after explicit owner approval

## Purpose

Make image uploads behave consistently across the campaign, keep public Case
Note discussion useful without leaving it open to uncontrolled posting, give
operators reversible and audited reply moderation, and use each adult hunter's
optional custom public name consistently throughout the public experience.

This release extends existing working systems. It does not replace
authentication, legal acceptance, media storage, the Case Notes pre-moderation
flow, or the production/validation boundary.

## Decisions in Force

- Production accounts, profiles, reports, Case Notes, replies, media, Updates,
  legal acceptances and audit records remain protected.
- Normal validation writes remain isolated in disposable validation resources.
- Validation may read the existing authorized production snapshot but cannot
  mutate it.
- Case Notes remain pre-moderated. Replies from participation-unlocked hunters
  may appear immediately after server-side human verification and rate limiting.
- Reply removal is a reversible soft hide, never a destructive dashboard delete.
- Private contact information and children's identities never become public.
- The existing generated handle, such as `Hunter D48E`, remains the safe
  fallback when an adult has not supplied a custom public name.
- Existing waiver, Privacy Policy and Media Notice bodies and legal acceptance
  records are unchanged.

## Shared Image Preparation

Use one browser image-preparation contract on every application-owned image
upload surface:

- private Report evidence;
- public Case Note submissions; and
- direct Ops Official Update images.

Supported sources remain JPEG, PNG and WebP. Accept no more than three selected
files. Files through decimal 20 MB upload directly. Supported sources above 20
MB and through 50 MB are decoded and compressed on the user's device. Prepared
files may total no more than decimal 30 MB.

Every surface shows the same filename-specific checking, optimization, ready,
failure, cancellation and retry states. A prepared file is appended to the
request instead of the original. Server validation remains authoritative and
accepts only supported, signature-valid prepared images through 20 MB each and
30 MB combined.

The existing report preparation module becomes the shared implementation or is
wrapped by a neutral shared client module. Report and Ops behavior must remain
backward compatible. Case Notes stop using their independent 10 MB client
validator and use the shared limits and preparation path.

The media worker continues to remove metadata and create public derivatives.
Private originals and R2 object keys never receive public URLs. This release
does not add HEIC or HEIF conversion.

## Reply Publication and Abuse Controls

Replies remain available only to authenticated hunters whose profile, privacy
and media acceptance, and participation waiver are current. The API continues
to require the Case Notes reply feature switch, same-origin requests,
server-verified Turnstile, safe reply content and an existing public Case Note.

Reduce the reply allowance from 20 to **5 replies per fixed 10-minute
window**. The existing D1 rate limiter applies the limit independently to both
the authenticated subject and the Cloudflare client IP. Changing accounts does
not reset an exhausted IP bucket, and changing IPs does not reset an exhausted
account bucket. A rejected request returns HTTP 429, a `Retry-After` header and
a clear human-readable retry message.

The existing global `repliesEnabled` Ops switch remains an emergency stop. The
public UI does not optimistically render a reply before the server accepts it.
Turnstile tokens are never logged or stored.

## Public Identity Resolution

Use one server-owned public identity resolver rather than allowing clients to
supply an arbitrary author label.

For an adult account:

1. Use the optional safe `publicDisplayName` when it is present.
2. Otherwise use the generated `publicHandle` such as `Hunter D48E`.

For an account marked `minor_guardian_permission`, public Case Notes and replies
always use **Young Hunter**. A minor's custom display name, generated handle,
legal name and email remain private.

The signed-in account control is private to its owner. It displays the owner's
optional custom public name when present and otherwise the generated handle.
Case Notes, replies and eligible adult report attribution use the same resolved
adult public identity. Existing report-time explicit attribution choices remain
available; this change does not silently replace a report snapshot after it has
been submitted.

The profile field remains labelled as an optional public name and continues to
reject contact details and invalid lengths. The system does not derive public
identity from email addresses or legal names.

## Operator Reply Moderation

Add a **Public replies** section to the existing Ops Moderation area. It lists
recent replies with:

- reply body;
- resolved public identity;
- parent Case Note excerpt and stop;
- publication state and timestamp;
- number and state of community flags; and
- available operator actions.

Operators can inspect flagged replies in the same area. A flag shows its target
context without exposing unrelated private profile information.

### Hide reply

An authorized operator supplies a private reason and confirms the action. The
server changes the reply from `published` to `hidden`, records `moderated_at`
and `moderated_by`, and writes an audit event containing the reason and relevant
flag identifiers. The public board omits hidden replies immediately. The
original body and author relationship remain private and queryable by Ops.

### Restore reply

An authorized operator supplies a private reason and confirms restoration. The
server changes the reply from `hidden` to `published` and writes a distinct
audit event. Restoration never changes the original body, author or creation
time.

### Flag resolution

An operator may resolve a flag by hiding its target or dismiss it without
hiding. The flag records its final state, resolver and resolution timestamp.
Hiding a reply resolves its outstanding flags in the same audited transaction.
Repeated actions are conflict-safe and cannot create duplicate audit results.

No Ops route permanently deletes a reply. Database `deleted` status remains
reserved for a future owner-authorized retention workflow and is out of scope.

## Interfaces and Data

Use additive authenticated Ops interfaces under the existing moderation
namespace:

- list recent published and hidden replies with flag summaries;
- list or include received flags with their target context;
- hide or restore one reply; and
- dismiss or resolve one flag.

Mutation requests require exact origin, active Staff authorization, JSON media
type, an explicit action and a private reason. They return the resulting state
and never expose private account data publicly.

The current `field_note_replies` table already supports `published`, `hidden`,
`moderated_at` and `moderated_by`. The current `content_flags` table already
supports received, reviewing, resolved and dismissed states with resolution
metadata. Prefer those existing columns. Add a migration only if implementation
evidence proves an essential audit value cannot be represented safely.

The public Case Notes API continues returning only `published` replies. It
returns the resolved public identity, never the profile subject or private
identity fields.

## Operator and Public Experience

- Case Note upload help text describes the 20 MB direct and 50 MB source limits
  in plain decimal MB.
- Preparation status uses an `aria-live` region and associates errors with the
  image field.
- The Ops reply table uses real buttons with visible focus states and clear
  `Hide reply` or `Restore reply` labels.
- Destructive hiding uses restrained evidence red; restoration is visually
  distinct and not presented as destructive.
- Confirmation copy names the reply action and states that the record remains
  in the private audit trail.
- Keyboard focus returns to the initiating control or the nearest surviving
  row action after a successful refresh.
- Empty, loading, failure and rate-limited states are explicit and do not rely
  on colour alone.

## Error and Recovery Behaviour

- Image preparation failure identifies the file and leaves the form text and
  other selections intact.
- Cancelling or changing selected images aborts stale preparation work.
- A failed upload does not create a Case Note or Update and permits retry with
  the same prepared selection where safe.
- A failed moderation request leaves the currently displayed public state
  unchanged and shows the server error.
- Concurrent hide or restore requests return a bounded conflict result instead
  of silently overwriting the newer state.
- If rate-limit storage is unavailable, reply creation continues to fail closed
  using the existing abuse-protection unavailable response.

## Testing and Acceptance

Implementation follows test-driven development. Automated coverage must prove:

- all three image upload surfaces share the 20 MB direct, 50 MB source,
  three-file and 30 MB prepared-total contract;
- an 11 MB Case Note image is accepted without optimization;
- a supported source above 20 MB is optimized before Case Note submission;
- unsupported and over-50 MB sources produce filename-specific errors;
- prepared Case Note uploads, not original large sources, enter `FormData`;
- replies use a 5-per-10-minute rule against both subject and IP;
- rate-limited replies return 429 and `Retry-After` and are not stored;
- only participation-unlocked hunters can reply;
- adult custom public names appear in the account model, Case Notes and replies;
- generated handles remain the adult fallback;
- minor public output uses `Young Hunter` and omits all minor names and handles;
- Ops can list published and hidden replies and inspect received flags;
- hide, restore, dismiss and resolve actions require Staff, exact origin and a
  private reason;
- hidden replies disappear from public output while their private record and
  audit event remain;
- restored replies return exactly once without changing original content;
- concurrent or repeated moderation actions are safe and auditable; and
- no public API exposes profile subjects, emails, legal names or object keys.

Run the complete static, unit, integration, accessibility, legal-artifact,
TypeScript and production-build suites. Complete manual validation in desktop
and mobile layouts with keyboard-only operation, 200% zoom, VPN on and off,
Case Note images at 11 MB and above 20 MB, visible custom account identity,
reply rate limiting, community flagging, operator hide and operator restore.

Deploy only to the `codex-validation` Pages branch and Preview bindings first.
Confirm the runtime sentinel is `validation` and that production row counts and
R2 references are unchanged. Production promotion requires a separate explicit
owner approval after validation review.

## Out of Scope

- Pre-moderating every reply
- Anonymous replies
- Permanent reply deletion through Ops
- Editing another participant's reply
- Public moderator reasons or private flagger identities
- Public custom identity for minor accounts
- HEIC or HEIF conversion
- Profile-photo upload or image hosting outside the three existing surfaces
- Copying validation submissions into production
- Mutating the production snapshot
