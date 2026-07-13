# Validation Integration and Production Promotion Design

Date: 2026-07-13

Status: Approved for implementation planning

Project: Tim Lost Something? Hunter Platform

## Purpose

Use the existing `codex-validation.seba-treasure-hunt.pages.dev` deployment as a disposable, link-accessible integration environment. Complete and battle-test the identity, human-verification, private-media, moderation and operations flows there without changing the current live release or allowing validation accounts and submissions into production.

After validation passes, promote the exact tested commit and equivalent configuration to the live domains with clean production identity and data. Purge validation personal data after production verification while retaining empty validation infrastructure for future regression testing.

## Goals

- Keep the current validation URL and Cloudflare Pages project.
- Keep validation accessible to anyone with its URL and excluded from search indexing.
- Isolate validation identity, data, uploads, rate limits, queues and secrets from production.
- Exercise the complete site except functionality that requires the forthcoming approved participation waiver.
- Make cross-environment writes fail closed.
- Promote a tested commit rather than rebuilding or manually copying the site.
- Start production with no validation users, consent records, submissions, uploads or activity history.
- Provide a guarded and auditable validation-data purge.

## Non-goals

- Do not change the current production deployment, custom domains or DNS during validation setup.
- Do not migrate validation accounts or submissions into production.
- Do not invent, paraphrase or pre-accept a participation waiver.
- Do not authorize account sessions on immutable, hash-addressed Pages deployment URLs.
- Do not protect validation with Cloudflare Access.
- Do not commit secrets, credentials, private administrator addresses or private evidence.

## Chosen Approach

Use one Cloudflare Pages project with isolated preview bindings.

Cloudflare Pages supports `env.preview` and `env.production` configuration. Preview overrides apply to every preview deployment in the Pages project, not to one branch only. Therefore, every preview branch is treated as disposable test infrastructure, and `codex-validation` is the stable alias used for authenticated testing.

This approach preserves the current validation URL, keeps configuration close to the code and avoids duplicating the Pages project. It is safer than sharing production resources and simpler than operating a second Pages project.

## Environment Architecture

### Validation

The Pages preview environment binds to resources whose names visibly identify them as validation resources:

- a validation D1 database;
- a private validation R2 bucket;
- a validation KV namespace;
- a validation media-processing queue and dead-letter queue;
- a separately deployed validation media processor;
- a Clerk development instance for hunters;
- a separate Clerk development instance for staff;
- a validation Turnstile widget;
- preview-only secrets and public environment variables.

The Cloudflare Images transformation binding may remain account-level because the media processor writes transformed output only to the validation R2 binding.

### Production

The top-level or explicit production configuration retains the existing campaign D1, R2, KV and queue bindings. Production Clerk instances, Turnstile credentials, webhook secrets and staff principals are configured only during the promotion phase. The existing live deployment remains unchanged until validation passes.

## Environment Guardrails

Add an explicit deployment-environment value and a database sentinel.

- Validation configuration declares `DEPLOYMENT_ENV=validation`.
- Production configuration declares `DEPLOYMENT_ENV=production`.
- A new `0004_environment_metadata.sql` migration creates the environment-sentinel schema.
- Each D1 database contains one `environment_metadata` record with the expected environment.
- Before any authenticated write, legal acceptance, report, community post, staff action or upload reservation, the Worker verifies that the configured environment matches the D1 sentinel.
- A mismatch returns `503 environment_mismatch` before writing personal data or enqueuing media.
- The validation purge requires all of the following: the validation deployment value, the validation D1 sentinel, validation-suffixed resource names and a separate explicit confirmation flag.
- Clerk development keys are accepted only in validation. Production rejects test-key prefixes.

No secret values or private resource identifiers appear in public responses, logs, source documentation or browser code beyond the publishable keys that Clerk and Turnstile require.

## Validation User Experience

Validation remains accessible to anyone with the link and continues to send `X-Robots-Tag: noindex`.

Every validation page displays a small, persistent notice:

> Validation environment — test accounts and submissions will be deleted before launch.

The notice must be visible without blocking the campaign content, accessible to assistive technology and absent from production. Account emails and recovery flows must also identify the development or validation environment.

The stable branch alias is the supported authentication URL. Immutable deployment URLs remain available for unauthenticated smoke testing, but authorized-party and redirect configuration does not allow account sessions on them.

## Identity and Account Flow

### Hunters

- Use a Clerk development instance dedicated to validation hunters.
- Require verified email and passwords of at least 12 characters.
- Use provider-managed compromised-password checks, sessions and emailed recovery.
- Verify Clerk lifecycle webhook signatures before creating the D1 player record.
- Store profile, funnel stage, consent history and hunt activity in validation D1 only.
- Keep the participation waiver visibly pending and participation-only tools locked.

### Staff

- Use a separate invitation-only Clerk development instance.
- Invite the four previously approved administrators; their addresses remain in private operational configuration, not the public repository.
- Repeat staff authorization in validation D1 rather than trusting identity alone.
- Use provider-managed password recovery and session controls.
- Staff cannot view or assign another person's password.

## Turnstile and Write Protection

- Create a validation Turnstile widget authorized for the stable validation hostname.
- Keep production hostname configuration separate.
- Require successful server-side Turnstile verification for public write actions already designated by the application.
- Missing or invalid Turnstile configuration disables the affected write action and returns a safe service-unavailable response.
- Retain KV-backed rate limits as an independent control.

## Private Media Pipeline

- Reports and Field Notes upload originals to validation R2 only.
- The validation Pages Worker writes media jobs to the validation queue.
- The validation media processor validates and re-encodes approved raster formats through Cloudflare Images.
- Processed derivatives return to validation R2 and become eligible for their existing moderated delivery path.
- Private report evidence, exact locations, ID details and cash evidence never enter the public-media path.
- A media failure never auto-publishes an original or partially processed asset.

## Data and Request Flow

1. A visitor opens the stable validation alias and sees the validation notice.
2. Public reads use the validation D1 seed and expose only public-safe campaign data.
3. Account actions use the appropriate Clerk development instance.
4. Verified lifecycle webhooks bootstrap validation D1 accounts.
5. Authenticated writes validate the Clerk session, environment sentinel, legal state, authorization, rate limit and Turnstile requirement as applicable.
6. Uploads reserve private validation storage and enqueue validation-only media jobs.
7. Staff review submissions in the validation Ops interface.
8. Audit records remain in validation D1 and do not contain credentials or unnecessary evidence content.

## Integration Order

1. Inventory the current Pages configuration and verify the active Murdawk Media Cloudflare account without exposing credentials.
2. Provision validation D1, R2, KV, media queue and dead-letter queue.
3. Add preview-specific bindings, public variables and environment guardrails.
4. Add `0004_environment_metadata.sql`, then apply migrations `0001` through `0004` and the idempotent campaign seed to validation D1 only.
5. Deploy the separate validation media processor.
6. Configure validation Turnstile.
7. Configure the hunter Clerk development instance, webhook and recovery flow.
8. Configure the staff Clerk development instance and approved invitations.
9. Configure preview secrets through provider-managed secret storage.
10. Deploy validation and run the complete test matrix.
11. Add and test the authoritative participation waiver when supplied.
12. Complete production readiness review and obtain explicit promotion approval.

Account creation or settings that require an owner login, acceptance of provider terms, billing choice, domain verification or mailbox confirmation pause at that step for the project owner. Codex may complete authenticated setup already authorized and available in the active session, but does not guess credentials, purchase services or weaken provider security controls.

## Failure Handling

- Missing Clerk, Turnstile, webhook or media credentials fail closed for the affected action.
- Invalid webhook signatures do not create or modify accounts.
- Environment mismatch stops writes before D1 mutation, R2 upload or queue publication.
- Authentication and authorization errors do not reveal whether a private account, report or staff principal exists.
- Upload-processing failures retain no public derivative and surface a reviewable operational state.
- Structured logs contain request IDs, environment and failure categories, but exclude passwords, reset codes, session tokens, private evidence and unnecessary personal information.
- Critical validation failures block production promotion.

## Battle-Test Matrix

Validation must cover:

- hunter signup, verification, password login, recovery and session revocation;
- profile completion and the exact active privacy/media acceptance version and hash;
- pending-waiver behavior and locked participation tools;
- account-optional private reports, required find-claim photos and optional location;
- private upload processing and the absence of public original-media access;
- Field Notes, images, replies, flags, premoderation and Turnstile;
- staff login, recovery, authorization, suspension and session controls;
- player ledger, legal versions and separate communication permissions;
- case status, official updates, zone state, rules and FOUND confirmation;
- desktop and mobile accessibility;
- public-output privacy and metadata scans;
- failure states for absent configuration, invalid signatures, rate limits and environment mismatch.

Automated tests, type checking and production builds must pass from the release-candidate commit. Live validation smoke tests must confirm the `noindex` header and the expected environment notice.

## Production Promotion

1. Select one successfully battle-tested Git commit as the release candidate.
2. Prepare production Clerk instances, Turnstile widget, webhooks and provider-managed secrets.
3. Verify production bindings and the production D1 sentinel.
4. Apply migrations `0003` and `0004` to production D1 only after explicit approval and backup/export checks.
5. Seed only approved production staff principals and campaign state.
6. Build and deploy the exact release-candidate commit to the production branch.
7. Verify both live hostnames, redirects, indexing policy, authentication, reports, private media, moderation and privacy boundaries.
8. If a critical check fails, restore the previous Pages deployment and keep production writes disabled until corrected.

Production begins with no validation user, consent, report, Field Note, upload or activity records.

## Validation Data Purge

After production passes its launch verification and the project owner confirms the purge:

1. Stop validation writes.
2. Produce counts for validation Clerk users, personal D1 rows, R2 objects, KV keys and outstanding queue jobs.
3. Verify the validation deployment value, D1 sentinel and validation resource names.
4. Delete validation Clerk users.
5. Delete personal and activity records from validation D1, preserving only the approved campaign seed and environment sentinel.
6. Delete every validation R2 object and validation KV key.
7. Drain or delete outstanding validation queue jobs and inspect the dead-letter queue.
8. Run a second count proving that personal validation data is gone.
9. Re-enable the empty validation environment for future regression testing when desired.

The purge is destructive and therefore remains a separately confirmed launch operation even though this design establishes the intended outcome.

## Privacy and Security Boundaries

- Validation data is disposable but is handled with the same privacy controls as production data.
- Legal acceptance records, contact data, staff principals and private submissions never appear publicly.
- Private administrator addresses remain outside public artifacts.
- Secrets live only in Clerk and Cloudflare secret storage.
- Validation emails must not imply that the hunt is live.
- The existing Privacy Policy & Media Notice remains the legal baseline for validation collection.
- No waiver acceptance is recorded until the authoritative waiver is supplied and enabled as a separate document.

## Completion Criteria

The integration phase is complete when:

- validation uses isolated resources for every stateful or identity-dependent service;
- environment guardrails have been deliberately tested;
- all configured account, recovery, reporting, media, community and staff flows pass end to end;
- waiver-dependent functionality remains correctly locked unless the approved waiver has been supplied;
- automated, accessibility, mobile, privacy and live smoke checks pass;
- the production environment remains unchanged; and
- a release-candidate commit and production promotion checklist are recorded.
