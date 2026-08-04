# Ops Access and Item Status Design

Date: 2026-08-04
Status: Approved for implementation planning

## Objective

Make routine campaign operations fast and dependable without weakening the existing audit, privacy, or publication boundaries. The release adds direct operator invitations, reliable local access suspension, focused item-status controls, and an authoritative Apple Watch found state.

## Current behaviour and root causes

- Staff suspension currently calls the external identity provider before changing the D1 authorization record. Provider errors are reduced to a generic failure, so local access remains active and the operator receives no actionable explanation.
- `staff_principals` already supports invitation records and email-based activation, but Ops has no endpoint or form for creating an invitation.
- Case items already support `found`, the public client already renders a FOUND stamp from that state, and the report form already lists known reportable items. Ops exposes the state only inside the complete item-edit form.
- The Apple Watch's seeded record and static homepage fallback still describe it as out there.

## Decisions

### Authoritative access state

D1 remains the authority for access to Ops. Suspending a principal changes the D1 status immediately and every subsequent protected request fails authorization. Clerk session revocation is defence-in-depth; a provider failure is recorded as a warning and does not silently restore local access.

Self-suspension is allowed only when another active principal remains. After a successful self-suspension response, the browser signs the operator out. The final active principal cannot be suspended by themselves or a peer. This invariant is enforced transactionally in D1 and represented in each row's server-provided capabilities.

Reactivation is a deliberate peer action. Suspended principals cannot regain access through the domain-based activation fallback or a new invitation.

### Direct invitations

Add `POST /api/v1/ops/staff/invitations`. It requires an active staff identity, same-origin protection, and a JSON body containing one valid normalized email address.

Any valid email address may be invited. The server creates an audited `invited` D1 principal first, making the address eligible immediately, then asks Clerk to deliver its verification invitation. Access becomes active only after the recipient controls and verifies that address and signs in.

Invitation delivery failure leaves the pending whitelist record visible and records a safe failure event. Ops offers `Resend invitation`. Repeating an invitation for the same pending address is idempotent. Active accounts are reported as already active; suspended accounts must be reactivated rather than re-invited; revoked accounts require a future explicit recovery design.

Invitation email addresses, delivery state, and audit history remain private Ops data.

### Focused item-status transitions

Add `POST /api/v1/ops/items/:id/status`. It requires active staff, same-origin protection, JSON, the current item version, explicit confirmation, and one of two transitions:

- `out_there` to `found`
- `found` to `out_there`

Draft, paused, archived, content, placement, visibility, and media changes remain in the complete item editor. The focused endpoint updates only status, version, and timestamps and appends dedicated case-item and audit events. A stale version returns the existing conflict contract without changing the item.

Every eligible item card receives a prominent `Mark found` or `Mark out there` action. The confirmation names the exact item and states that the public board changes immediately. The UI reloads the authoritative item record after success. It does not create or publish a Latest News entry.

### Apple Watch release state

An additive migration changes `case-item-watch` to `found` only when it is not already found, advances its version, and records deterministic system case-item and audit events. The homepage's static fallback card, metadata, structured data, and relevant visible copy are updated so an API failure never reverts the public story to “out there.”

The Apple Watch change does not close the overall case. Cash, rings, the camera, sunglasses and case, golf balls, and any other active records keep their independent states.

## Operator interface

The existing Case Room navigation and visual system remain intact.

`Users & Access` gains a compact invitation panel above the ledger with one email field and `Send invitation`. The ledger identifies the current operator with a `You` label, explains when self-suspension is unavailable, and retains recovery, session, suspension, reactivation, and resend actions only when the server grants each capability.

`What's Out There` gains a compact quick-status action in each eligible card header. The complete editor remains below it for deliberate content and placement changes.

All confirmations are keyboard accessible, results use semantic live regions, focus remains on the originating control, and mobile controls remain full-width where needed.

## Error handling

- Invalid or unauthorized invitations fail before a row is written.
- Clerk delivery failures retain the invited record, expose a safe retry message, and never expose provider payloads or credentials.
- Duplicate pending invitations return the existing record and may explicitly resend rather than create another principal.
- Suspension fails closed if the target is missing, already inactive, stale, or would remove the final active operator.
- A Clerk session-revocation warning cannot bypass a successful D1 suspension.
- Item status conflicts reload the current record and ask the operator to review it before retrying.
- No item mutation or invitation failure is reported as successful unless its authoritative D1 transition occurred.

## Verification

Automated coverage will include:

- staff-only and same-origin invitation enforcement;
- email normalization, invalid addresses, duplicate pending invitations, active/suspended conflicts, delivery failure, and resend;
- final-active-admin protection, peer suspension, self-suspension, immediate authorization denial, sign-out intent, reactivation, session-revocation warnings, and audit records;
- capability-driven UI rows with `You`, unavailable-action explanations, and pending invitation state;
- focused item-status authorization, confirmation, allowed transitions, stale versions, reversibility, and append-only events;
- Apple Watch migration idempotency, fallback wording, structured data, public status projection, and FOUND overlay;
- no public exposure of staff email, invitation, provider, or audit data;
- keyboard, narrow-screen, and horizontal-overflow acceptance.

Release verification requires the complete test suite, every TypeScript project, the production-shaped build, privacy scanning, and desktop/mobile walkthroughs of Ops and the homepage.

## Release boundary

This specification authorizes implementation and local verification only. Pushing, deploying, applying the production migration, sending a real invitation, or changing a production principal remains a separate explicit release action.
