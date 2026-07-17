# Production Snapshot Mirror Design

**Date:** July 16, 2026

**Status:** Approved design

**Target:** Validation Ops only; production remains authoritative

## Purpose

Give authorized staff a realistic, full-fidelity view of current production
records while they test the validation website, without binding validation
write paths to production or risking the real hunter accounts and submissions.

Public validation pages remain accessible to anyone with the link. Sensitive
snapshot information is available only after the existing Staff sign-in and
server-side Ops authorization. Cloudflare Access is not part of this design.

## Decisions in Force

- Production D1 and R2 remain authoritative and are never bound to validation
  as writable application storage.
- Validation accounts, submissions, publications and test actions continue to
  use only the disposable validation D1 and R2 resources.
- A manual, one-way refresh creates a separate production snapshot for
  validation Ops.
- The snapshot preserves production data without masking names, email
  addresses, phone numbers, minor records, report details or private evidence.
- Snapshot records are read-only in the validation application.
- Public validation pages never read from or publish snapshot-only records.
- Every existing production account and record is treated as real and must be
  unchanged before and after a snapshot refresh.

## Storage Architecture

Provision dedicated validation-only snapshot resources:

- a D1 database bound under a distinct name such as
  `PRODUCTION_SNAPSHOT_DB`;
- a private R2 bucket bound under a distinct name such as
  `PRODUCTION_SNAPSHOT_MEDIA`.

These resources are separate from both production and disposable validation
storage. The normal `DB`, upload and media bindings retain their current
environment-specific behavior.

Snapshot D1 receives the production records required to reproduce the Ops
ledgers and report detail views, including legal and participation metadata.
Authentication-provider secrets, passwords, reset codes and active production
sessions are never copied; those are not application data and remain managed
by the identity provider.

Snapshot R2 receives private report evidence needed by the mirrored report
detail view. Objects remain private. Snapshot media is returned only through
an authenticated Ops endpoint and never receives a public bucket URL.

The snapshot stores refresh metadata including:

- snapshot identifier;
- production source environment;
- refresh start and completion timestamps;
- copied table and row counts;
- copied object count and bytes;
- source and destination verification results;
- the operator or local process that initiated the refresh.

## Manual Refresh Workflow

The refresh is an explicit local operator command, not a schedule and not a
public application endpoint.

The workflow is:

1. Authenticate the local CLI against the intended Cloudflare account.
2. Resolve every source and destination resource by immutable identifier.
3. Verify the source D1 environment sentinel is `production`.
4. Verify the destination sentinel is `production-snapshot` and refuse any
   destination whose identifier matches production or validation storage.
5. Record read-only production baselines for protected tables and R2 objects.
6. Export the approved production records and referenced private media.
7. Load them into staging structures in the snapshot resources.
8. Verify row counts, referential integrity, media hashes and environment
   metadata before making the new snapshot visible.
9. Atomically mark the verified snapshot as current.
10. Re-run production baselines and prove that production received zero
    writes, deletions or object mutations.
11. Emit a local refresh report without printing personal data or credentials
    to the terminal.

If verification fails, the previous valid snapshot remains current. A partial
refresh is never exposed to the validation application.

The refresh tool uses least-privilege credentials where Cloudflare permits it.
Secrets live only in a gitignored local environment file or the existing
credential store and are never committed, logged or copied into generated
reports.

## Server Interfaces and Authorization

Add dedicated endpoints under a namespace such as
`/api/v1/ops/production-snapshot/*`. Every request must:

1. authenticate the current application session;
2. resolve the current user server-side;
3. require the existing Ops role or approved company-domain staff access;
4. reject hunter-only and signed-out sessions;
5. query only the snapshot binding through a read-only repository;
6. return `Cache-Control: private, no-store`.

The snapshot repository exposes query methods only. It does not expose generic
SQL execution, mutation methods, publication actions or storage writes.
Existing production and validation repositories are not reused through a
runtime environment toggle.

No snapshot endpoint may:

- approve, reject, publish, unpublish or edit a report;
- change a user, profile, role or legal acceptance;
- send operator or participant email;
- enqueue moderation or media-processing work;
- write to production, validation or snapshot campaign tables;
- return private media without a newly authorized request.

Optional access-view events may be written to the validation audit trail, but
never to production or snapshot storage.

## Ops Experience

The Ops dashboard keeps disposable validation data as its default context. A
staff-only control can open **Production snapshot** as a separate view.

The snapshot view must remain visually unmistakable:

- persistent “Read-only production snapshot” label;
- source and “refreshed at” timestamp;
- no approval, publication, editing, reset or email actions;
- no ambiguous shared filters that could switch a validation mutation onto a
  snapshot record;
- a direct way back to validation data.

Mirrored reports may display their actual reporter details, minor status,
location, evidence and legal records because the view is staff-authenticated.
The public site and hunter dashboard never receive these fields from snapshot
APIs.

Nontechnical public testers continue using the validation site normally.
Staff testers use the existing **Staff sign in** flow; no Cloudflare Access,
VPN, service token or second administrative login is required.

## Failure Handling

- A missing or stale snapshot shows a clear unavailable/stale state rather
  than falling back to production.
- A missing media object shows its snapshot identifier and refresh status to
  Ops without leaking a production storage URL.
- Authorization failures return a generic 401 or 403 and no record counts.
- A destination-sentinel mismatch aborts before any destination mutation.
- A source-sentinel mismatch aborts before export.
- Refresh interruption leaves the last verified snapshot active.
- Snapshot API errors never retry against production storage.

## Testing and Acceptance

Implementation follows test-driven development. Automated tests will prove:

- signed-out visitors and authenticated hunters cannot access any snapshot
  API, record count or media object;
- authorized Ops users can read the approved full-fidelity fields;
- every snapshot route supports only safe read operations;
- mutation attempts return an error and leave all three environments
  unchanged;
- public pages and public APIs never query snapshot bindings;
- validation actions still write only validation D1 and R2;
- snapshot refresh refuses production or validation as a destination;
- a failed refresh retains the prior verified snapshot;
- copied D1 relationships and referenced R2 evidence remain intact;
- production baselines match before and after refresh;
- no emails, queue messages, webhooks or publications are triggered by import;
- snapshot responses are private and non-cacheable.

End-to-end review will cover Staff sign-in, dataset labeling, report details,
minor records, private media, stale-snapshot behavior and attempted access by a
hunter account. The production row and object baselines will be recorded before
and after the first real refresh.

## Out of Scope

- binding validation directly to production D1 or R2;
- sharing a writable database between environments;
- Cloudflare Access or a VPN;
- masking or synthesizing snapshot data;
- scheduled, nightly or event-driven refreshes;
- copying passwords, reset codes, provider secrets or live sessions;
- allowing public or hunter access to snapshot records;
- changing production records from the snapshot interface.
