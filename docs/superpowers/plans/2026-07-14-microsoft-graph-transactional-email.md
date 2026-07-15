# Microsoft Graph Transactional Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send validation waiver receipts and recovery instructions from `tech@sebahub.com` through delegated Microsoft Graph, with Casey as Reply-To, encrypted rotating OAuth state, auditable provider references, and no automatic Resend fallback.

**Architecture:** A provider-neutral `TransactionalMailer` separates application mail composition from Graph and Resend wire formats. Graph refreshes a least-privilege delegated token, persists rotations encrypted in validation D1, submits multipart MIME to `/me/sendMail`, and records provider acceptance/correlation evidence. Validation selects Graph explicitly; Resend remains dormant and separately prepared for future domain verification.

**Tech Stack:** TypeScript 7, Cloudflare Pages Workers, D1/SQLite, Web Crypto AES-GCM, Microsoft identity platform OAuth 2.0 device flow, Microsoft Graph Mail API, Node test runner with `tsx`, Miniflare, Wrangler.

---

## File map

- Create `src/server/transactional-mail.ts` — provider-neutral message/result/error contracts and header-safe multipart MIME renderer.
- Create `src/server/graph-token-store.ts` — encrypted D1 refresh-token persistence with optimistic concurrency.
- Create `src/server/microsoft-graph-mailer.ts` — delegated refresh and Graph `/me/sendMail` transport.
- Create `src/server/resend-mailer.ts` — retained explicit Resend adapter; never an implicit fallback.
- Create `src/server/transactional-mail-factory.ts` — fail-closed provider selection and configuration validation.
- Create `migrations/0010_graph_transactional_email.sql` — private OAuth state plus provider-reference evidence columns.
- Create `scripts/graph-device-login.mjs` — one-time device-code authorization that places the refresh token on the Windows clipboard without printing or writing it, for an immediate user paste into Cloudflare's Preview-only secret field.
- Create `tests/transactional-mail.test.ts` — MIME, Unicode, correlation, and injection tests.
- Create `tests/graph-token-store.test.ts` — encryption, key-version, and compare-and-swap tests against real D1 semantics.
- Create `tests/microsoft-graph-mailer.test.ts` — OAuth refresh, Graph acceptance, rejection, and ambiguous-send tests.
- Create `tests/transactional-mail-factory.test.ts` — explicit provider selection and dormant Resend tests.
- Modify `src/server/types.ts` — mail, provider evidence, uncertainty, OAuth store, environment, and resend-result types.
- Modify `src/server/d1-store.ts` — provider evidence writes, encrypted token state, and uncertain-delivery replay guards.
- Modify `src/server/waiver-receipts.ts` — composition only; send through the injected transactional mailer.
- Modify `src/server/player-accounts.ts` and `src/server/staff-accounts.ts` — inject the shared mailer for recovery instructions.
- Modify `src/server/app.ts` — block participant uncertain resend and require an audited Ops confirmation before retry.
- Modify `src/worker.ts` — construct one selected mail provider, include provider config in the cache signature, and inject it everywhere.
- Modify `src/client/dashboard.ts` — explain uncertain delivery and disable participant resend.
- Modify `src/client/ops.ts` — require an explicit Sent Items check before retrying an uncertain receipt.
- Modify `tests/waiver-receipts.test.ts`, `tests/account-recovery-links.test.ts`, `tests/waiver-api.test.ts`, `tests/api-store-integration.test.ts`, `tests/api-schema.test.ts`, `tests/api-worker.test.ts`, `tests/waiver-ui-client.test.ts`, and `tests/ops-board-ui-behavior.test.ts` — integration and regression coverage.
- Modify `.env.example`, `README.md`, `STATUS.md`, and `docs/qa/2026-07-14-waiver-guardian-receipt-verification.md` — configuration, validation evidence, operational boundaries, and handoff state.

### Task 1: Provider-neutral message and MIME boundary

**Files:**
- Create: `src/server/transactional-mail.ts`
- Create: `tests/transactional-mail.test.ts`

- [ ] **Step 1: Write failing MIME and contract tests**

Create tests that require multipart plain/HTML output, Casey reply routing, a stable correlation header, CRLF line endings, Unicode base64 round-trip, and header-injection rejection:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { renderTransactionalMime } from "../src/server/transactional-mail";

test("renders a correlated multipart message with Casey as Reply-To", () => {
  const rendered = renderTransactionalMime({
    to: "hunter@example.test",
    from: { name: "Tim Lost Something? by SebaHub", address: "tech@sebahub.com" },
    replyTo: "casey@sebahub.com",
    subject: "Your waiver receipt — TLS-W-1234",
    text: "Plain legal receipt",
    html: "<p>HTML legal receipt</p>",
    correlationId: "8eecbe25-8db6-4c5c-91f8-f1095e608f95",
    sentAt: new Date("2026-07-14T18:00:00.000Z"),
  });
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(rendered.base64), c => c.charCodeAt(0)));
  assert.match(decoded, /Reply-To: casey@sebahub\.com\r\n/);
  assert.match(decoded, /X-Tim-Lost-Delivery-Reference: 8eecbe25/);
  assert.match(decoded, /multipart\/alternative/);
  assert.match(decoded, /Plain legal receipt/);
  assert.match(decoded, /HTML legal receipt/);
  assert.doesNotMatch(decoded.replaceAll("\r\n", ""), /\n/);
});

test("rejects header injection before rendering", () => {
  assert.throws(() => renderTransactionalMime({
    to: "hunter@example.test\r\nBcc: attacker@example.test",
    from: { name: "SebaHub", address: "tech@sebahub.com" },
    replyTo: "casey@sebahub.com",
    subject: "Receipt",
    text: "Body",
    html: null,
    correlationId: crypto.randomUUID(),
    sentAt: new Date(),
  }), /header/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test tests/transactional-mail.test.ts`

Expected: FAIL because `src/server/transactional-mail.ts` does not exist.

- [ ] **Step 3: Implement the minimal provider-neutral contract and MIME renderer**

Define the exact public boundary:

```ts
export interface TransactionalMessage {
  to: string;
  from: { name: string; address: string };
  replyTo: string;
  subject: string;
  text: string;
  html: string | null;
  correlationId: string;
  sentAt?: Date;
}

export type ProviderReferenceKind = "graph_request_id" | "client_request_id" | "resend_message_id";

export interface TransactionalMailAcceptance {
  provider: "microsoft_graph" | "resend";
  providerReference: string;
  providerReferenceKind: ProviderReferenceKind;
  acceptedAt: string;
}

export type TransactionalMailErrorCode =
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_response_invalid"
  | "provider_delivery_uncertain";

export class TransactionalMailError extends Error {
  constructor(readonly code: TransactionalMailErrorCode) {
    super(code);
  }
}

export interface TransactionalMailer {
  send(message: TransactionalMessage): Promise<TransactionalMailAcceptance>;
}
```

Implement `renderTransactionalMime()` with validated single-line headers, UTF-8 base64 encoding through `TextEncoder`, unique deterministic boundaries derived from the correlation ID, and a `multipart/alternative` body when HTML exists. Never interpolate unvalidated header values.

- [ ] **Step 4: Run the MIME tests and typecheck**

Run: `npx tsx --test tests/transactional-mail.test.ts && npm run typecheck:worker`

Expected: all focused tests PASS and worker typecheck exits 0.

- [ ] **Step 5: Commit the MIME boundary**

```powershell
git add src/server/transactional-mail.ts tests/transactional-mail.test.ts
git commit -m "feat: add transactional MIME boundary"
```

### Task 2: Encrypted rotating Graph token state

**Files:**
- Create: `migrations/0010_graph_transactional_email.sql`
- Create: `src/server/graph-token-store.ts`
- Create: `tests/graph-token-store.test.ts`
- Modify: `tests/api-schema.test.ts`
- Modify: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing schema and token-store tests**

Require the migration to add private OAuth state and provider-reference evidence without mutating historical rows:

```sql
ALTER TABLE notification_delivery_events ADD COLUMN provider_reference TEXT;
ALTER TABLE notification_delivery_events ADD COLUMN provider_reference_kind TEXT;

CREATE TABLE oauth_provider_state (
  provider TEXT PRIMARY KEY CHECK (provider = 'microsoft_graph'),
  encrypted_refresh_token TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Test that D1 never contains the plaintext token, decrypts with the correct key, rejects a wrong key version, and permits exactly one compare-and-swap winner:

```ts
const first = await store.save(null, "refresh-token-one");
assert.equal(first, true);
assert.equal(JSON.stringify(await dumpOAuthRows(db)).includes("refresh-token-one"), false);
const loaded = await store.load();
assert.equal(loaded?.refreshToken, "refresh-token-one");
const results = await Promise.all([
  store.save(loaded!.stateVersion, "refresh-token-two"),
  store.save(loaded!.stateVersion, "refresh-token-three"),
]);
assert.equal(results.filter(Boolean).length, 1);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test tests/graph-token-store.test.ts tests/api-schema.test.ts`

Expected: FAIL because migration `0010` and `D1GraphTokenStore` do not exist.

- [ ] **Step 3: Implement AES-GCM persistence and compare-and-swap**

Create:

```ts
export interface StoredGraphRefreshToken {
  refreshToken: string;
  stateVersion: number;
}

export interface GraphRefreshTokenStore {
  load(): Promise<StoredGraphRefreshToken | null>;
  save(expectedVersion: number | null, refreshToken: string): Promise<boolean>;
}

export class D1GraphTokenStore implements GraphRefreshTokenStore {
  constructor(
    private readonly db: D1Database | null,
    private readonly encryptionKeyBase64: string | null,
    private readonly keyVersion: string | null,
  ) {}
  // import exactly 32 decoded bytes as AES-GCM; use a fresh 12-byte nonce;
  // INSERT ... ON CONFLICT DO NOTHING for expectedVersion === null;
  // UPDATE ... WHERE state_version = ? for rotations.
}
```

Use base64 helpers that never convert tokens through lossy Latin-1 strings. Throw a fixed configuration/state error without embedding ciphertext, token text, SQL, or key material.

- [ ] **Step 4: Prove migration replay and immutable-ledger compatibility**

Run: `npx tsx --test tests/graph-token-store.test.ts tests/api-schema.test.ts tests/api-store-integration.test.ts`

Expected: PASS, including existing immutable delivery-event trigger tests.

- [ ] **Step 5: Commit encrypted token state**

```powershell
git add migrations/0010_graph_transactional_email.sql src/server/graph-token-store.ts tests/graph-token-store.test.ts tests/api-schema.test.ts tests/api-store-integration.test.ts
git commit -m "feat: persist Graph tokens encrypted"
```

### Task 3: Delegated Microsoft Graph transport

**Files:**
- Create: `src/server/microsoft-graph-mailer.ts`
- Create: `tests/microsoft-graph-mailer.test.ts`

- [ ] **Step 1: Write failing OAuth and Graph transport tests**

Test the exact token form and send request, including `offline_access`, delegated `Mail.Send`, MIME, and correlation:

```ts
assert.equal(tokenForm.get("grant_type"), "refresh_token");
assert.equal(tokenForm.get("client_id"), "graph-client-id");
assert.equal(tokenForm.get("scope"), "offline_access https://graph.microsoft.com/Mail.Send");
assert.equal(sendRequest.url, "https://graph.microsoft.com/v1.0/me/sendMail");
assert.equal(sendHeaders.get("content-type"), "text/plain");
assert.equal(sendHeaders.get("client-request-id"), message.correlationId);
assert.equal(sendHeaders.get("return-client-request-id"), "true");
assert.match(String(sendRequest.body), /^[A-Za-z0-9+/]+=*$/);
```

Add cases for rotated refresh persistence, a concurrent save loser, token rejection, Graph non-202 rejection, missing access token, a `202` with `request-id`, a `202` without it, and a thrown send fetch mapped to `provider_delivery_uncertain`. Assert no test output contains access or refresh token values.

- [ ] **Step 2: Run the Graph test and verify RED**

Run: `npx tsx --test tests/microsoft-graph-mailer.test.ts`

Expected: FAIL because `MicrosoftGraphTransactionalMailer` does not exist.

- [ ] **Step 3: Implement access-token refresh**

Use this configuration boundary:

```ts
export interface MicrosoftGraphMailerConfig {
  fetch: typeof globalThis.fetch;
  clientId: string | null;
  tenantId: string | null;
  bootstrapRefreshToken: string | null;
  tokenStore: GraphRefreshTokenStore;
  now?: () => Date;
}
```

Load the encrypted D1 token first. Use the bootstrap secret only when no D1 state exists. POST URL-encoded refresh data to the tenant-specific v2 token endpoint. Require a non-empty `access_token`; persist a returned rotated `refresh_token` through compare-and-swap. Never fall back to bootstrap after a stored token fails.

- [ ] **Step 4: Implement Graph MIME submission**

Call `renderTransactionalMime(message)` and POST its base64 body to `/me/sendMail`. Map only `202` to success:

```ts
return {
  provider: "microsoft_graph",
  providerReference: response.headers.get("request-id")?.trim() || message.correlationId,
  providerReferenceKind: response.headers.get("request-id") ? "graph_request_id" : "client_request_id",
  acceptedAt: now().toISOString(),
};
```

Token-endpoint fetch failures are `provider_unavailable`. Send-endpoint fetch failures are `provider_delivery_uncertain`. Non-202 Graph responses are `provider_rejected`. Do not parse, persist, or log Graph error bodies.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx tsx --test tests/transactional-mail.test.ts tests/graph-token-store.test.ts tests/microsoft-graph-mailer.test.ts && npm run typecheck:worker`

Expected: all tests PASS and typecheck exits 0.

```powershell
git add src/server/microsoft-graph-mailer.ts tests/microsoft-graph-mailer.test.ts
git commit -m "feat: add delegated Graph mailer"
```

### Task 4: Explicit Resend adapter and provider selection

**Files:**
- Create: `src/server/resend-mailer.ts`
- Create: `src/server/transactional-mail-factory.ts`
- Create: `tests/transactional-mail-factory.test.ts`
- Modify: `src/server/types.ts`

- [ ] **Step 1: Write failing selection and dormant-provider tests**

Require `microsoft_graph` to construct only Graph, `resend` to construct only Resend, and missing/unknown configuration to return an unavailable mailer without network access:

```ts
const mailer = createTransactionalMailer({ provider: "microsoft_graph", graph, resend });
await mailer.send(message);
assert.equal(graphCalls, 1);
assert.equal(resendCalls, 0);
```

Test Resend success maps its response `id` to `resend_message_id`, respects Casey Reply-To, and maps malformed JSON to `provider_response_invalid`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test tests/transactional-mail-factory.test.ts`

Expected: FAIL because the adapters/factory do not exist.

- [ ] **Step 3: Extract the existing Resend behavior**

Move the current API call into `ResendTransactionalMailer`. It sends the same `from`, `to`, `reply_to`, `subject`, `text`, and optional `html` values and returns:

```ts
{
  provider: "resend",
  providerReference: body.id,
  providerReferenceKind: "resend_message_id",
  acceptedAt: now().toISOString(),
}
```

The adapter must never read `RESEND_API_KEY_SEBAHUB_PENDING`; only the factory's explicitly selected active key is passed in.

- [ ] **Step 4: Implement fail-closed selection**

Accept only `microsoft_graph` or `resend`. Do not catch one provider's error and call the other. A missing provider returns a mailer whose `send()` throws `provider_unavailable` before any fetch.

- [ ] **Step 5: Run tests and commit**

Run: `npx tsx --test tests/transactional-mail-factory.test.ts tests/microsoft-graph-mailer.test.ts && npm run typecheck:worker`

Expected: PASS.

```powershell
git add src/server/types.ts src/server/resend-mailer.ts src/server/transactional-mail-factory.ts tests/transactional-mail-factory.test.ts
git commit -m "refactor: select transactional mail explicitly"
```

### Task 5: Route waiver and recovery mail through the shared provider

**Files:**
- Modify: `src/server/waiver-receipts.ts`
- Modify: `src/server/player-accounts.ts`
- Modify: `src/server/staff-accounts.ts`
- Modify: `tests/waiver-receipts.test.ts`
- Modify: `tests/account-recovery-links.test.ts`

- [ ] **Step 1: Rewrite tests to inject a fake TransactionalMailer**

Replace global-fetch/Resend assertions with captured `TransactionalMessage` assertions:

```ts
const accepted = {
  provider: "microsoft_graph" as const,
  providerReference: "graph-request-1",
  providerReferenceKind: "graph_request_id" as const,
  acceptedAt: "2026-07-14T18:00:00.000Z",
};
const mailer = { send: async (message: TransactionalMessage) => { messages.push(message); return accepted; } };
```

Require waiver receipts to preserve the exact legal text/HTML, send to the verified account email, and pass the Graph evidence to the store. Require both recovery managers to use validation links and Casey Reply-To.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test tests/waiver-receipts.test.ts tests/account-recovery-links.test.ts`

Expected: FAIL until constructors accept the shared mailer.

- [ ] **Step 3: Refactor all three consumers**

`ManagedWaiverReceipts` keeps document matching and rendering, but calls the injected mailer:

```ts
const acceptance = await this.mailer.send({
  to: envelope.verifiedEmail,
  from: this.sender,
  replyTo: this.replyTo,
  subject: message.subject,
  text: message.text,
  html: message.html,
  correlationId: crypto.randomUUID(),
});
await this.store.completeWaiverReceiptJob(job, { status: "sent", ...acceptance });
```

Map `TransactionalMailError.code` to the fixed waiver error codes. Recovery managers call the same mailer and continue returning only `{ status: "instructions_sent" }`; provider references are not exposed in the API.

- [ ] **Step 4: Run focused and regression tests**

Run: `npx tsx --test tests/waiver-receipts.test.ts tests/account-recovery-links.test.ts tests/api-worker.test.ts`

Expected: PASS with zero real provider calls.

- [ ] **Step 5: Commit shared routing**

```powershell
git add src/server/waiver-receipts.ts src/server/player-accounts.ts src/server/staff-accounts.ts tests/waiver-receipts.test.ts tests/account-recovery-links.test.ts
git commit -m "refactor: share transactional mail provider"
```

### Task 6: Provider evidence and uncertain-delivery safeguards

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/dashboard.ts`
- Modify: `src/client/ops.ts`
- Modify: `tests/api-store-integration.test.ts`
- Modify: `tests/waiver-api.test.ts`
- Modify: `tests/waiver-ui-client.test.ts`
- Modify: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing evidence and uncertainty tests**

Require successful completion to insert the selected provider/reference fields while preserving the legacy Resend field only for Resend. Require `provider_delivery_uncertain` to project as receipt status `uncertain`, survive acceptance replay, block participant resend, and require `{ "confirmUncertainRetry": true }` from authorized Ops.

```ts
assert.equal((await currentAcceptance()).receipt.status, "uncertain");
assert.equal((await participantResend()).error.code, "waiver_receipt_delivery_uncertain");
assert.equal((await opsRetry({})).status, 409);
assert.equal((await opsRetry({ confirmUncertainRetry: true })).status, 202);
```

Assert the confirmed Ops retry appends `player.waiver-receipt.uncertain-retry-confirmed` and never exposes provider references publicly.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx tsx --test tests/api-store-integration.test.ts tests/waiver-api.test.ts tests/waiver-ui-client.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: FAIL because uncertainty is currently treated as an ordinary failed retry.

- [ ] **Step 3: Extend store completion and projections**

Change successful completion to accept:

```ts
{
  status: "sent";
  provider: "microsoft_graph" | "resend";
  providerReference: string;
  providerReferenceKind: ProviderReferenceKind;
  acceptedAt: string;
}
```

Insert `provider`, `provider_reference`, and `provider_reference_kind`. Populate legacy `provider_message_id` only for `resend_message_id`. Add `provider_delivery_uncertain` to the fixed error-code set and map `failed + that code` to public receipt status `uncertain`.

- [ ] **Step 4: Fence all uncertain replay paths**

Update acceptance replay, participant resend, claim, and standard Ops retry queries so `last_error_code = 'provider_delivery_uncertain'` cannot be requeued or claimed. Add an explicit `allowUncertainRetry` argument used only after the Ops request body contains `confirmUncertainRetry: true`; append the dedicated audit event in the same fenced D1 batch.

- [ ] **Step 5: Update accessible Dashboard and Ops behavior**

Dashboard copy:

```text
Microsoft may have accepted this receipt, but the confirmation response was interrupted. To prevent duplicates, another copy is temporarily blocked while the case team checks the sender mailbox.
```

Disable the participant resend button when status is `uncertain`. In Ops, change the confirmation to: “I checked tech@sebahub.com Sent Items and still want to retry this uncertain receipt.” Send `confirmUncertainRetry: true` only after that explicit confirmation.

- [ ] **Step 6: Run focused, accessibility-adjacent, and store tests**

Run: `npx tsx --test tests/api-store-integration.test.ts tests/waiver-api.test.ts tests/waiver-ui-client.test.ts tests/ops-board-ui-behavior.test.ts`

Expected: PASS; private references absent from API payload assertions.

- [ ] **Step 7: Commit evidence and uncertainty safeguards**

```powershell
git add src/server/types.ts src/server/d1-store.ts src/server/app.ts src/client/dashboard.ts src/client/ops.ts tests/api-store-integration.test.ts tests/waiver-api.test.ts tests/waiver-ui-client.test.ts tests/ops-board-ui-behavior.test.ts
git commit -m "feat: guard uncertain receipt delivery"
```

### Task 7: Worker wiring and secret-safe device authorization

**Files:**
- Modify: `src/worker.ts`
- Modify: `src/server/types.ts`
- Create: `scripts/graph-device-login.mjs`
- Create: `tests/graph-device-login.test.mjs`
- Modify: `tests/api-worker.test.ts`
- Modify: `tests/validation-bindings.test.mjs`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write failing Worker configuration tests**

Require the environment/cache signature to include:

```ts
TRANSACTIONAL_EMAIL_PROVIDER?: "microsoft_graph" | "resend";
GRAPH_CLIENT_ID?: string;
GRAPH_TENANT_ID?: string;
GRAPH_REFRESH_TOKEN_BOOTSTRAP?: string;
GRAPH_TOKEN_ENCRYPTION_KEY?: string;
GRAPH_TOKEN_KEY_VERSION?: string;
TRANSACTIONAL_EMAIL_FROM_ADDRESS?: string;
TRANSACTIONAL_EMAIL_FROM_NAME?: string;
TRANSACTIONAL_EMAIL_REPLY_TO?: string;
```

Assert Preview selects Graph, creates one shared mailer, and does not read `RESEND_API_KEY_SEBAHUB_PENDING`. Assert missing Graph configuration fails before network access.

- [ ] **Step 2: Write a failing secret-safety test for the login helper**

Spawn the helper against mocked Microsoft endpoints and an injected clipboard writer. Assert stdout contains only the verification URI/user code/status and never the refresh token. Assert the clipboard writer receives the refresh token exactly once and no token-bearing file exists after exit.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/graph-device-login.test.mjs && npx tsx --test tests/api-worker.test.ts && node --test tests/validation-bindings.test.mjs`

Expected: FAIL because wiring and helper do not exist.

- [ ] **Step 4: Wire one provider through the Worker**

Construct `D1GraphTokenStore`, Graph adapter, Resend adapter, and `createTransactionalMailer()` once per cached app. Inject the selected mailer into waiver receipts and both account managers. Add every provider setting to the cache signature. Preserve `CAMPAIGN_BASE_URL` validation isolation.

- [ ] **Step 5: Implement one-time device login without token output**

The helper:

1. requests a device code for `offline_access https://graph.microsoft.com/Mail.Send`;
2. prints Microsoft's verification URI and short user code;
3. polls at the instructed interval;
4. writes the returned refresh token to the Windows clipboard through child stdin, never a command-line argument;
5. tells Murphy to paste it into the Cloudflare Pages **Preview** secret named `GRAPH_REFRESH_TOKEN_BOOTSTRAP`;
6. clears the in-memory token reference and exits;
7. never prints response JSON, access tokens, refresh tokens, or command lines containing them.

Do not use `wrangler pages secret put` for this value: the installed Wrangler command has no Preview-environment selector and could target production.

- [ ] **Step 6: Document exact Preview variables and recovery procedure**

Document that Graph is active only when explicitly selected, Casey is the shared Reply-To, D1 stores only encrypted rotations, and a revoked/expired delegated grant requires rerunning the device helper. Do not put IDs or credential values in tracked docs.

- [ ] **Step 7: Run wiring tests and commit**

Run: `node --test tests/graph-device-login.test.mjs tests/validation-bindings.test.mjs && npx tsx --test tests/api-worker.test.ts && npm run typecheck`

Expected: PASS.

```powershell
git add src/worker.ts src/server/types.ts scripts/graph-device-login.mjs tests/graph-device-login.test.mjs tests/api-worker.test.ts tests/validation-bindings.test.mjs .env.example README.md
git commit -m "feat: wire Graph mail in validation"
```

### Task 8: Full verification, validation deployment, and provider preparation

**Files:**
- Modify: `docs/qa/2026-07-14-waiver-guardian-receipt-verification.md`
- Modify: `STATUS.md`
- Append the sanitized operational outcome to private operational history outside this public repository.

- [ ] **Step 1: Run the complete local quality gate**

Run:

```powershell
npm run legal:verify
npm test
npm run typecheck
npm run build
npm run verify:waiver-qa
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: legal artifacts unchanged; all static/contract and TypeScript tests PASS; typecheck/build/QA PASS; zero high/critical audit findings; diff check clean.

- [ ] **Step 2: Apply migration 0010 to isolated validation D1 only**

Back up validation D1 first. Apply `0010_graph_transactional_email.sql` through the same atomic raw-file path recorded for migrations `0006`–`0009` if Wrangler parsing remains incompatible. Verify the migration ledger, `oauth_provider_state` schema, provider-reference columns, validation sentinel, 12-waypoint seed, and zero personal/legal rows. Do not touch production D1.

- [ ] **Step 3: Configure Preview-only non-token settings**

Set Graph provider, tenant/client IDs, sender name/address, Casey Reply-To, encryption key/version, and validation campaign origin as encrypted Preview values where appropriate. Never echo secret values. Confirm `RESEND_API_KEY_SEBAHUB_PENDING` remains encrypted and unconsumed.

- [ ] **Step 4: Complete Microsoft device authorization with Murphy**

Run the helper and tap Murphy in only for the Microsoft verification page. Confirm the displayed account is exactly `tech@sebahub.com` and the requested permission is delegated `Mail.Send`; decline and stop on any broader or unexpected consent. After success, Murphy pastes the clipboard value into the Cloudflare Pages **Preview-only** `GRAPH_REFRESH_TOKEN_BOOTSTRAP` secret while the authenticated dashboard is open. Confirm the secret is saved, immediately clear the clipboard, and verify no local token file exists. Never use Wrangler's environment-ambiguous Pages secret command for this credential.

- [ ] **Step 5: Deploy only the validation branch and verify isolation**

Push `codex/tim-lost-hunter-platform`, deploy the new commit to the stable `codex-validation` alias, and record deployment/source IDs. Confirm `/api/v1/status`, `/waiver`, and `/privacy` return 200 with `X-Robots-Tag: noindex, nofollow`. Re-query Cloudflare to prove the production deployment ID/source commit, custom domains, and production D1 remain unchanged.

- [ ] **Step 6: Send one controlled Graph test to the sender mailbox**

Trigger one transactional test addressed only to `tech@sebahub.com`. Verify in Outlook:

- visible From is `Tim Lost Something? by SebaHub <tech@sebahub.com>`;
- Reply-To is `casey@sebahub.com`;
- plain and HTML legal content are complete;
- Sent Items contains the correlation header/reference;
- D1 contains encrypted rotated token state and one private provider-acceptance reference;
- no credential, body, recipient, provider reference, or legal evidence appears publicly.

Do not create a public hunter account or campaign submission for this provider test.

- [ ] **Step 7: Prepare dormant SebaHub Resend domain if authorized zone access is present**

Use the already encrypted pending credential to add `sebahub.com` in the intended Resend account. Add only Resend's exact non-web verification/authentication records to the authoritative `sebahub.com` Cloudflare zone. Do not change MX, Pages routes, `timlostsomething.com`, or the selected Graph provider. Confirm verification without sending mail. If zone/account scope is uncertain, stop without mutation and report the exact block.

- [ ] **Step 8: Record evidence and handoff-ready state**

Update QA and STATUS with test counts, migration/deployment IDs, Graph provider state, controlled-send outcome, Resend domain readiness, production-unchanged evidence, disposable-data/reset requirements, and the required user-owned Resend key rotation. Append only a sanitized operational note to AIOS History; never record credential values, token contents, provider references, or recipient-specific evidence.

- [ ] **Step 9: Commit and push documentation**

```powershell
git add docs/qa/2026-07-14-waiver-guardian-receipt-verification.md STATUS.md
git commit -m "docs: record Graph validation rollout"
git push origin codex/tim-lost-hunter-platform
```

Expected: branch push succeeds; `.superpowers/` remains untracked and untouched; production remains unchanged.
