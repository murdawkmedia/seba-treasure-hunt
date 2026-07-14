# Microsoft Graph Transactional Email Design

Date: 2026-07-14
Status: Approved for implementation planning
Deployment boundary: `codex-validation` only

## Purpose

Move Tim Lost Something? transactional email from the currently active Resend sender to Microsoft Graph so mail is sent by the real SebaHub mailbox `tech@sebahub.com`. Replies must go to `casey@sebahub.com`.

The change covers participation-waiver receipts and the player/staff recovery instructions currently sent directly through Resend. Clerk remains responsible for its own identity-provider messages, including staff invitations and password-reset codes.

Production deployment, production data, `timlostsomething.com` web routing, and the live campaign remain outside this change. Validation accounts, submissions, legal records, media, and OAuth state remain disposable and must not be promoted to production. The only permitted DNS exception is adding the exact non-web verification/authentication records supplied by Resend to the authoritative `sebahub.com` zone for future sender readiness; MX records and existing web records are not changed.

## Decisions

### Active provider

Validation will use Microsoft Graph with delegated `Mail.Send` and `offline_access`. An operator completes a one-time Microsoft device-code sign-in as `tech@sebahub.com`; the application never receives or stores the mailbox password.

The Graph request uses `/me/sendMail`, so the Microsoft identity that granted consent determines the sending mailbox. The intended visible sender is:

`Tim Lost Something? by SebaHub <tech@sebahub.com>`

Every message sets:

`Reply-To: casey@sebahub.com`

### Deferred alternatives

App-only Graph authentication is not part of this pass. It would require administrator consent and Exchange mailbox scoping. It can replace delegated authentication later if production needs a fully unattended service identity.

Resend remains implemented as an explicitly selectable provider, but it is inactive while Graph is selected. There is no automatic Graph-to-Resend fallback.

The pending SebaHub Resend credential remains an encrypted Cloudflare Preview secret. If the `sebahub.com` Cloudflare zone is accessible, its domain-verification records may be prepared for future use without activating Resend or sending mail. After controlled setup and verification, Murphy must rotate the chat-supplied Resend credentials and replace only their encrypted Preview secrets.

## Architecture

### Provider-neutral sender

Introduce a small `TransactionalMailer` interface shared by waiver receipts and account-recovery messages. A message contains:

- recipient address;
- display sender and sender address;
- reply-to address;
- subject;
- plain-text body;
- HTML body when applicable;
- an application-generated delivery-attempt correlation ID.

A successful provider result contains:

- provider name;
- provider reference;
- provider-reference kind;
- provider-acceptance timestamp.

The Graph and Resend implementations remain isolated behind this interface. Account managers and waiver-receipt orchestration do not know provider URLs, credentials, or wire formats.

### Graph mailer

`MicrosoftGraphTransactionalMailer` performs two operations:

1. Acquire an access token by refreshing the delegated OAuth grant.
2. Submit a MIME message to `https://graph.microsoft.com/v1.0/me/sendMail`.

Messages use MIME rather than Graph's single-body JSON shape. Waiver receipts therefore retain the complete `multipart/alternative` plain-text and HTML representations already required by the legal-receipt design. Recovery messages use a text part and may include a simple equivalent HTML part.

MIME construction must:

- use CRLF line endings;
- encode Unicode safely;
- reject newline/control-character injection in addresses, display names, and subjects;
- include `From`, `To`, `Reply-To`, `Subject`, `Date`, `MIME-Version`, and a unique `Message-ID` under a SebaHub-controlled domain;
- include an `X-Tim-Lost-Delivery-Reference` correlation header;
- base64-encode the completed MIME document for Graph.

Graph receives a `client-request-id` for the same attempt. A `202 Accepted` response is the success boundary. It means Microsoft accepted the operation for processing; it does not prove final inbox delivery.

### OAuth token store

Cloudflare Pages secrets provide:

- the Microsoft application/client ID;
- the SebaHub tenant ID;
- the initial delegated refresh token;
- a random token-encryption key;
- the selected provider and sender configuration.

The initial refresh token is a bootstrap secret only. After the first refresh, the latest rotated refresh token is encrypted with AES-GCM before being stored in a private validation D1 OAuth-state row. D1 stores ciphertext, nonce, key version, optimistic-concurrency version, and timestamps; it never stores a plaintext refresh or access token. The AES-GCM key remains only in an encrypted Cloudflare Preview secret.

Refresh persistence uses compare-and-swap semantics. Concurrent requests may not overwrite a newer encrypted refresh token. Once an encrypted D1 token exists, an invalid token does not silently fall back to an older bootstrap token; the mailer fails closed and requires a new operator sign-in.

Access tokens remain in memory only for the current request and are never written to D1, files, logs, responses, analytics, or audit records.

## Delivery Evidence

The existing delivery ledger distinguishes provider acceptance from legal acceptance. A schema migration adds provider-reference fields without rewriting historical immutable events:

- `provider` identifies `microsoft_graph` or `resend`;
- `provider_reference` stores the provider request ID when Graph supplies one, otherwise the submitted client request ID;
- `provider_reference_kind` records whether the value is a Graph request ID, client request ID, or Resend message ID;
- the legacy `provider_message_id` remains for historical Resend compatibility.

The application-generated delivery correlation ID is also present in the MIME message. This allows an operator to correlate the immutable application event with the copy in the `tech@sebahub.com` Sent Items folder without granting the application mail-read permission.

The existing `sent` job state continues to mean "accepted by the configured provider." Public and Ops copy must not claim verified inbox delivery.

## Failure and Duplicate-Suppression Rules

The system fails closed for missing configuration, invalid consent, token-refresh failure, provider rejection, malformed success responses, or encryption/state errors. Public responses and logs use privacy-safe error codes and never include tokens, email bodies, provider response bodies, or recipient data.

Graph does not provide a message ID in its `202` response. The mailer records the response request reference when present and the submitted correlation reference otherwise.

A connection failure after submission may be ambiguous: Microsoft could have accepted the request before the Worker lost the response. Such an attempt is recorded as `provider_delivery_uncertain` and is not automatically retried, replayed, or sent through Resend. Participant self-resend is temporarily blocked for that receipt. An authorized operator must check the `tech@sebahub.com` Sent Items folder, then deliberately confirm and retry only when appropriate; that decision is audited.

No code path performs provider fallback within the same attempt. Provider changes are configuration changes made between attempts.

## Resend Preparation

The SebaHub Resend account may be prepared in parallel as a future provider:

1. Confirm the stored pending key belongs to the intended SebaHub Resend account without exposing it.
2. Add `sebahub.com` as a sending domain if it is still absent.
3. Add only the Resend-provided verification records to the authoritative Cloudflare zone after verifying the zone/account scope.
4. Confirm domain verification without sending an email.
5. Keep `TRANSACTIONAL_EMAIL_PROVIDER=microsoft_graph` and keep the Resend key inactive.
6. Ask Murphy to rotate the exposed key after setup, then replace only its encrypted Preview secret with the new value.

If the authoritative `sebahub.com` zone or required Microsoft/Resend administration is unavailable, preparation stops at that exact boundary. No substitute domain, forwarding service, MX change, web-routing change, or additional DNS mutation is inferred.

## Configuration Boundary

Validation uses Preview-only secrets and variables. The intended configuration shape is:

- `TRANSACTIONAL_EMAIL_PROVIDER=microsoft_graph`;
- Graph client ID and tenant ID;
- Graph bootstrap refresh token;
- Graph token-encryption key and key version;
- sender address/display name;
- shared reply-to address;
- existing Resend keys retained but not selected.

Provider configuration participates in the Worker application-cache signature so a changed secret or provider cannot reuse an app instance created with stale settings.

Production configuration is neither copied nor changed. A future production release requires its own Microsoft authorization, token state, Cloudflare secrets, database migration review, controlled test, data-reset plan, and explicit production approval.

## Verification

Implementation follows red-green-refactor tests covering:

- provider selection and fail-closed configuration;
- OAuth refresh request scope and tenant isolation;
- AES-GCM encryption/decryption and key-version handling;
- rotated-token compare-and-swap persistence;
- concurrent refresh behavior;
- MIME plain/HTML completeness and Unicode handling;
- sender and Casey reply-to headers;
- header-injection rejection;
- Graph `202` acceptance and request-reference capture;
- Graph rejection, token failure, malformed response, timeout, and ambiguous delivery;
- no automatic fallback or duplicate send;
- participant and Ops behavior for uncertain receipts;
- Resend remaining inactive while Graph is selected;
- privacy-safe logs and API output.

Before deployment, run the full static/contract, TypeScript, real-D1 integration, typecheck, build, privacy-output, accessibility, and browser QA suites. No test may contact Graph or Resend unless it is the separately controlled provider verification.

After deployment to `codex-validation` only:

1. Confirm validation retains `noindex, nofollow`.
2. Confirm production deployment, data, DNS, and source commit are unchanged.
3. Complete device-code consent as `tech@sebahub.com`.
4. Send one controlled transactional test to `tech@sebahub.com`.
5. Verify sender identity, Casey reply-to, plain/HTML content, Sent Items correlation, and private audit evidence.
6. Do not create a public account or campaign submission as part of provider verification.

## References

- Microsoft Graph `sendMail`: <https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0>
- Graph send-mail processing and `202 Accepted`: <https://learn.microsoft.com/en-us/graph/outlook-things-to-know-about-send-mail>
- Microsoft device authorization grant: <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code>
- Microsoft Graph permissions reference: <https://learn.microsoft.com/en-us/graph/permissions-reference>
