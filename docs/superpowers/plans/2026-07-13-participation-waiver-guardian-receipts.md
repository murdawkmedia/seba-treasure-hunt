# Participation Waiver, Guardian Flow, and Receipt Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and activate waiver version `2026.1`, record adult/guardian/minor acceptance snapshots, unlock the existing hunter tools, and deliver an auditable full-text receipt to the adult's verified email.

**Architecture:** One structured legal source generates the public waiver page and Worker document module. D1 stores append-only review, acceptance-participant, and delivery events; the existing notification outbox prevents duplicate automatic receipts. Clerk remains the identity provider, Resend delivers transactional receipts, and email failure never rolls back a valid acceptance.

**Tech Stack:** TypeScript 7, Hono, Cloudflare Pages Workers, D1, Clerk, Resend HTTP API, esbuild, Node test runner, Miniflare, Playwright, axe-core.

---

## File map

**Create**

- `legal/participation-waiver-2026.1.json` — sole editable source for waiver copy, acceptance statements, version, and effective date.
- `scripts/generate-waiver.mjs` — deterministic generator/checker for `waiver.html` and the Worker module.
- `src/generated/participation-waiver.ts` — generated legal data and SHA-256; never hand-edit.
- `src/generated/privacy-media.ts` — generated Privacy Policy version/hash; never hand-edit.
- `waiver.html` — generated accessible and printable public page; never hand-edit.
- `src/client/waiver.ts` — public-page print control with no inline script.
- `migrations/0006_participation_waiver_and_receipts.sql` — review events, participant snapshots, delivery events, and outbox uniqueness.
- `src/server/waiver-receipts.ts` — receipt text/HTML rendering, Resend transport, and delivery orchestration.
- `tests/waiver-document.test.mjs` — generated-document, route, copy, and hash contracts.
- `tests/waiver-store.test.ts` — D1 store and outbox unit tests.
- `tests/waiver-api.test.ts` — authenticated review, acceptance, access, and resend tests.
- `tests/waiver-receipts.test.ts` — rendering, escaping, provider, and failure tests.
- `tests/waiver-ui-client.test.ts` — guardian draft validation and payload tests.
- `tests/waiver-ui-page.test.mjs` — accessible onboarding and public-page contracts.
- `scripts/verify-waiver-qa.mjs` — read-only Playwright/axe evidence runner with local provider mocks.
- `tests/waiver-qa-contract.test.mjs` — durable QA-runner safety and coverage contract.

**Modify**

- `package.json` — deterministic legal generation/verification scripts.
- `scripts/build.mjs` — require generated legal artifacts and publish `/waiver`.
- `src/server/legal-documents.ts` — activate waiver `2026.1` and privacy/media `2026.2`.
- `privacy.html` — disclose guardian/minor data and transactional legal receipts; publish version `2026.2`.
- `src/server/types.ts` — waiver, participant, outbox, sender, environment, and store interfaces.
- `src/server/d1-store.ts` — review/acceptance/outbox persistence and current access calculation.
- `src/server/app.ts` — clean route, legal APIs, validation, idempotency, and participation gates.
- `src/worker.ts` — construct the Resend receipt service from environment variables.
- `dashboard.html` — active waiver, guardian rows, receipt state, and corrected communication labels.
- `src/client/dashboard.ts` — review/accept/resend flow and dynamic minor controls.
- `css/hunter.css` — waiver, guardian, receipt, and print-safe responsive styles.
- `ops.html`, `src/client/ops.ts`, `css/ops.css` — authorized legal detail and receipt retry without minor export.
- `tests/api-test-kit.ts`, `tests/api-auth.test.ts`, `tests/api-player-lifecycle.test.ts`, `tests/api-store.test.ts`, `tests/api-store-integration.test.ts` — new interfaces and access expectations.
- `tests/hunter-account-contract.test.mjs`, `tests/hunter-ui-pages.test.mjs`, `tests/hunter-ui-client.test.ts`, `tests/public-content-safety.test.mjs`, `tests/api-environment-guard.test.ts` — replace pending-waiver contracts with active-waiver contracts.
- `README.md`, `STATUS.md`, `sitemap.xml`, and public footers — active legal state, route discovery, and rollout gates.

## Task 1: Canonical waiver source and deterministic public page

**Files:**
- Create: `legal/participation-waiver-2026.1.json`
- Create: `scripts/generate-waiver.mjs`
- Create: `src/generated/participation-waiver.ts`
- Create: `waiver.html`
- Create: `src/client/waiver.ts`
- Create: `tests/waiver-document.test.mjs`
- Modify: `package.json`
- Modify: `scripts/build.mjs`
- Modify: `src/server/app.ts`
- Modify: `src/server/legal-documents.ts`
- Modify: `scripts/generate-waiver.mjs`
- Create: `src/generated/privacy-media.ts`

- [ ] **Step 1: Write the failing legal-generation contract**

Create `tests/waiver-document.test.mjs` with assertions that run the generator in check mode and inspect the generated files:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("waiver 2026.1 is generated from one approved source", () => {
  execFileSync(process.execPath, ["scripts/generate-waiver.mjs", "--check"], { stdio: "pipe" });
  const html = readFileSync("waiver.html", "utf8");
  const generated = readFileSync("src/generated/participation-waiver.ts", "utf8");
  assert.match(html, /SebaHub Tim Lost Something\? Participant Acknowledgement, Waiver and Release/);
  assert.match(html, /Effective July 13, 2026/);
  assert.match(html, /In an emergency, I will call 911\./);
  assert.match(html, /official website form or another contact method published on the campaign website/);
  assert.doesNotMatch(html, /Lost Wallet Mystery|campaign hotline|\[what is/i);
  assert.match(generated, /version: "2026\.1"/);
  assert.match(generated, /hash: "[a-f0-9]{64}"/);
});
```

- [ ] **Step 2: Run the contract and witness RED**

Run: `node --test tests/waiver-document.test.mjs`

Expected: FAIL because `scripts/generate-waiver.mjs` and generated artifacts do not exist.

- [ ] **Step 3: Add the exact structured legal source**

Create `legal/participation-waiver-2026.1.json` with this shape and the complete Appendix A text from the approved design, preserving every paragraph and bullet:

```json
{
  "type": "participation_waiver",
  "version": "2026.1",
  "effectiveDate": "2026-07-13",
  "effectiveDateLabel": "July 13, 2026",
  "title": "SebaHub Tim Lost Something? Participant Acknowledgement, Waiver and Release",
  "intro": "By registering for and participating in Tim Lost Something?, I confirm and agree that:",
  "acceptanceStatement": "I have read and agree to the Tim Lost Something? Participation Waiver, Release and Rules. I understand that participation involves outdoor risks, that I must search only in approved areas, and that I participate voluntarily and at my own risk.",
  "guardianStatement": "I confirm that I am the parent or legal guardian of each minor listed, that the information is accurate, and that I accept this agreement on their behalf. I will directly supervise them throughout their participation.",
  "sections": [
    {
      "number": 1,
      "slug": "voluntary-participation",
      "title": "Voluntary participation",
      "blocks": [
        { "kind": "paragraph", "text": "I am choosing to participate voluntarily. I understand that participation may involve walking outdoors on trails, grass, sand and uneven ground and may include exposure to weather, insects, vegetation, water, other visitors and changing property conditions." }
      ]
    },
    {
      "number": 2,
      "slug": "eligibility-and-minors",
      "title": "Eligibility and minors",
      "blocks": [
        { "kind": "paragraph", "text": "I confirm that I am at least 18 years old." },
        { "kind": "paragraph", "text": "A participant under 18 may participate only while directly supervised by a parent or legal guardian who has registered and accepted this agreement on the minor's behalf." }
      ]
    },
    {
      "number": 3,
      "slug": "approved-areas-only",
      "title": "Approved areas only",
      "blocks": [
        { "kind": "paragraph", "text": "I will search only during posted hunt hours and only in areas marked as approved on the official search map or by SebaHub staff." },
        { "kind": "paragraph", "text": "I will not enter:" },
        { "kind": "list", "items": ["Private homes or neighbouring properties", "Guest accommodations or occupied campsites", "Event spaces during private bookings", "Farmyard or animal enclosures", "Construction, maintenance or storage areas", "Fenced, locked or signed restricted areas", "Water, shorelines marked as restricted, steep slopes or cliff-edge areas", "Any location closed by SebaHub staff"] },
        { "kind": "paragraph", "text": "I understand that appearing on Tim's original route does not automatically mean that a location is open for public searching." }
      ]
    },
    {
      "number": 4,
      "slug": "prohibited-conduct",
      "title": "Prohibited conduct",
      "blocks": [
        { "kind": "paragraph", "text": "I will not:" },
        { "kind": "list", "items": ["Dig, cut trees or remove vegetation", "Climb buildings, fences, trees or structures", "Move heavy objects or damage landscaping", "Enter locked, closed or restricted areas", "Start fires", "Use vehicles, machinery, drones or excavation equipment to search", "Disturb guests, residents, staff or private events", "Feed, touch, chase or otherwise pester the Farmyard Friends", "Leave garbage or damage any part of the village"] },
        { "kind": "paragraph", "text": "I will follow all signs and staff instructions immediately." }
      ]
    },
    {
      "number": 5,
      "slug": "assumption-of-risk",
      "title": "Assumption of risk",
      "blocks": [
        { "kind": "paragraph", "text": "I understand that outdoor participation carries risks, including slips, trips, falls, uneven surfaces, weather, insects, water hazards, natural obstacles and the actions of other people." },
        { "kind": "paragraph", "text": "I voluntarily accept the ordinary risks associated with participating in the activity." }
      ]
    },
    {
      "number": 6,
      "slug": "release-and-responsibility",
      "title": "Release and responsibility",
      "blocks": [
        { "kind": "paragraph", "text": "To the fullest extent permitted by law, I release and hold harmless SebaHub, the participating property owners and operators, and their directors, employees, contractors, volunteers and representatives from claims arising from my participation, including claims connected with personal injury, property loss or property damage." },
        { "kind": "paragraph", "text": "This release is not intended to exclude liability that cannot legally be excluded." },
        { "kind": "paragraph", "text": "I understand that I remain responsible for my own conduct, safety and belongings." }
      ]
    },
    {
      "number": 7,
      "slug": "reporting-finds-and-clues",
      "title": "Reporting finds and clues",
      "blocks": [
        { "kind": "paragraph", "text": "I will report any potential find through the official website form or another contact method published on the campaign website." },
        { "kind": "paragraph", "text": "I will not publish photographs or identifying details from Tim's ID or other personal documents." },
        { "kind": "paragraph", "text": "I understand that a reported find may need to be photographed, documented and verified before it is confirmed." }
      ]
    },
    {
      "number": 8,
      "slug": "clue-coin",
      "title": "Clue coin",
      "blocks": [
        { "kind": "paragraph", "text": "After completing registration, I may be asked to show my confirmation to receive a SebaHub clue coin." },
        { "kind": "paragraph", "text": "The coin identifies me as a registered participant for clue access. It does not grant access to restricted areas and does not replace my responsibility to follow the rules." }
      ]
    },
    {
      "number": 9,
      "slug": "removal-from-the-activity",
      "title": "Removal from the activity",
      "blocks": [
        { "kind": "paragraph", "text": "I understand that SebaHub may remove or disqualify anyone who:" },
        { "kind": "list", "items": ["Enters restricted areas", "Damages property", "Disturbs animals, guests or residents", "Creates a safety concern", "Ignores staff instructions", "Provides false registration information"] }
      ]
    },
    {
      "number": 10,
      "slug": "emergency-acknowledgement",
      "title": "Emergency acknowledgement",
      "blocks": [
        { "kind": "paragraph", "text": "I understand that campaign contact methods are not an emergency service. In an emergency, I will call 911." }
      ]
    },
    {
      "number": 11,
      "slug": "electronic-agreement",
      "title": "Electronic agreement",
      "blocks": [
        { "kind": "paragraph", "text": "By checking the required box and submitting the form, I confirm that:" },
        { "kind": "list", "items": ["I have read and understood this agreement", "I have had the opportunity to ask questions", "The name and contact information entered belong to me", "I agree to be bound by this acknowledgement, waiver, release and the official hunt rules"] }
      ]
    }
  ]
}
```

- [ ] **Step 4: Implement deterministic generation and check mode**

Create `scripts/generate-waiver.mjs` with stable JSON serialization, SHA-256, HTML escaping, semantic section rendering, shared campaign chrome, and byte comparison in `--check` mode:

```js
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL("../legal/participation-waiver-2026.1.json", import.meta.url);
const modulePath = new URL("../src/generated/participation-waiver.ts", import.meta.url);
const pagePath = new URL("../waiver.html", import.meta.url);
const sourceText = await readFile(sourcePath, "utf8");
const source = JSON.parse(sourceText);
const canonical = `${JSON.stringify(source)}\n`;
const hash = createHash("sha256").update(canonical).digest("hex");
const escape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const generatedModule = `// Generated by scripts/generate-waiver.mjs. Do not edit.\n` +
  `export const generatedParticipationWaiver = Object.freeze(${JSON.stringify({ ...source, hash }, null, 2)} as const);\n`;

const renderBlock = (block) => block.kind === "list"
  ? `<ul>${block.items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`
  : `<p>${escape(block.text)}</p>`;
const body = source.sections.map((section) =>
  `<section class="policy-section" id="${escape(section.slug)}"><h2>${section.number}. ${escape(section.title)}</h2>${section.blocks.map(renderBlock).join("")}</section>`
).join("");
const generatedPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow"><meta name="description" content="Read the current Tim Lost Something? participation acknowledgement, waiver and release.">
<link rel="canonical" href="https://www.timlostsomething.com/waiver"><title>${escape(source.title)} | Tim Lost Something?</title>
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/hunter.css">
</head><body><a class="skip-link" href="#main">Skip to the waiver</a>
<header class="hunter-topbar"><a class="hunter-brand" href="/">Tim Lost Something?<span>This year: Tim lost his ID</span></a><nav aria-label="Campaign"><a href="/start">Start</a><a href="/route">Route</a><a href="/updates">Updates</a><a href="/rules">Rules</a><a href="/sponsors">Sponsors</a></nav></header>
<main id="main"><article class="legal-page"><p class="field-label">Participation legal document</p><h1>${escape(source.title)}</h1><p class="legal-updated">Version ${escape(source.version)} · Effective ${escape(source.effectiveDateLabel)}</p><p>${escape(source.intro)}</p>${body}<div class="action-row waiver-print-action"><button class="hunter-button" type="button" data-print-waiver>Print this waiver</button><a class="hunter-button hunter-button--quiet" href="/dashboard#waiver">Return to registration</a></div></article></main>
<footer class="hunter-footer"><div class="hunter-footer__inner"><p><strong>Tim Lost Something?</strong><br>The 2026 Seba Beach Treasure Hunt</p><nav aria-label="Legal and safety"><a href="/privacy">Privacy</a><a href="/waiver" aria-current="page">Waiver</a><a href="/rules">Current rules</a></nav></div></footer>
<script type="module" src="/assets/app/waiver.js"></script></body></html>\n`;

const check = process.argv.includes("--check");
for (const [path, expected] of [[modulePath, generatedModule], [pagePath, generatedPage]]) {
  if (check) {
    const actual = await readFile(path, "utf8").catch(() => "");
    if (actual !== expected) throw new Error(`${path.pathname} is stale; run npm run legal:generate`);
  } else {
    await writeFile(path, expected, "utf8");
  }
}
```

Create `src/client/waiver.ts` so printing remains a deliberate user action without inline JavaScript:

```ts
document.querySelector<HTMLButtonElement>("[data-print-waiver]")
  ?.addEventListener("click", () => window.print());

export {};
```

- [ ] **Step 5: Wire generation into package and build contracts**

Add scripts:

```json
{
  "legal:generate": "node scripts/generate-waiver.mjs",
  "legal:verify": "node scripts/generate-waiver.mjs --check"
}
```

Run `npm run legal:generate`, add `waiver.html` to `staticFiles`, add `/waiver` to `cleanRoutes`, and import `generatedParticipationWaiver` in `src/server/legal-documents.ts`:

```ts
import { generatedParticipationWaiver } from "../generated/participation-waiver";

export const participationWaiverDocument = generatedParticipationWaiver;

export const publicLegalState = () => ({
  privacyMediaVersion: privacyMediaDocument.version,
  privacyMediaHash: privacyMediaDocument.hash,
  waiverStatus: "active" as const,
  waiverVersion: participationWaiverDocument.version,
  waiverHash: participationWaiverDocument.hash,
  waiverEffectiveDate: participationWaiverDocument.effectiveDate
});
```

Make `npm run build` call `npm run legal:verify` before esbuild so stale generated legal output cannot deploy.

- [ ] **Step 6: Run GREEN checks**

Run:

```powershell
npm run legal:verify
node --test tests/waiver-document.test.mjs
npm run build
```

Expected: all commands exit 0; `dist/waiver.html` exists and contains the generated version/hash-backed legal body.

- [ ] **Step 7: Commit Task 1**

```powershell
git add legal/participation-waiver-2026.1.json scripts/generate-waiver.mjs src/generated/participation-waiver.ts waiver.html src/client/waiver.ts tests/waiver-document.test.mjs package.json scripts/build.mjs src/server/app.ts src/server/legal-documents.ts
git commit -m "feat: publish versioned participation waiver"
```

## Task 2: Privacy Policy `2026.2`

**Files:**
- Modify: `privacy.html`
- Modify: `src/server/legal-documents.ts`
- Modify: `tests/hunter-account-contract.test.mjs`
- Modify: `tests/public-content-safety.test.mjs`

- [ ] **Step 1: Write failing disclosure and reacceptance tests**

Add assertions:

```js
assert.match(privacy, /Version 2026\.2|version `?2026\.2/i);
assert.match(privacy, /supervised minor[^.]*full name[^.]*birth year/is);
assert.match(privacy, /waiver receipt[^.]*verified email/is);
assert.match(privacy, /transactional[^.]*not[^.]*marketing consent/is);
assert.match(legalDocuments, /version: "2026\.2"/);
```

- [ ] **Step 2: Run tests and witness RED**

Run: `node --test tests/hunter-account-contract.test.mjs tests/public-content-safety.test.mjs`

Expected: FAIL because the active privacy document is still `2026.1`.

- [ ] **Step 3: Update the policy without changing media rights**

Change the visible version/effective label to `2026.2` / July 13, 2026. Add campaign-specific paragraphs that disclose:

```html
<p>When an adult registers supervised minors, SebaHub collects each minor's full name and birth year only to identify who is covered by the adult's participation-waiver acceptance. SebaHub does not create child accounts or collect a minor's email address, phone number, exact birth date, photograph, public handle or separate route-progress record.</p>
<p>After a participation waiver is accepted, SebaHub sends the adult a transactional legal receipt at the account's verified email through its configured email service provider. This receipt and any deliberate resend are essential legal communications and do not grant or change permission for hunt updates or SebaHub marketing.</p>
<p>Minor participant snapshots and waiver-receipt delivery events are restricted legal records. They are never public, never included in player exports, and follow the legal-acceptance retention and deletion rules below.</p>
```

Preserve all existing private-evidence exclusions and media language unchanged.

- [ ] **Step 4: Generate the privacy version/hash from the published policy**

Extend `scripts/generate-waiver.mjs` with the same decorative-asset exclusion already enforced by `tests/hunter-account-contract.test.mjs`:

```js
const privacyPath = new URL("../privacy.html", import.meta.url);
const privacyModulePath = new URL("../src/generated/privacy-media.ts", import.meta.url);
const privacyHtml = await readFile(privacyPath, "utf8");
const canonicalPrivacy = privacyHtml.replace(
  /^.*(?:\/favicon\.ico|\/assets\/favicon(?:-32x32)?\.(?:svg|png)|\/assets\/apple-touch-icon\.png|\/site\.webmanifest).*\r?\n/gm,
  "",
);
const privacyHash = createHash("sha256").update(canonicalPrivacy).digest("hex");
const privacyModule = `// Generated by scripts/generate-waiver.mjs. Do not edit.\n` +
  `export const generatedPrivacyMediaDocument = Object.freeze({ type: "privacy_media" as const, version: "2026.2", hash: "${privacyHash}" });\n`;
```

Add `privacyModulePath/privacyModule` to the generator's write/check loop and import `generatedPrivacyMediaDocument` from `src/server/legal-documents.ts`. Do not retain a hand-edited hash constant or reuse the waiver hash.

- [ ] **Step 5: Run GREEN checks and commit**

```powershell
node --test tests/hunter-account-contract.test.mjs tests/public-content-safety.test.mjs
git add privacy.html scripts/generate-waiver.mjs src/generated/privacy-media.ts src/server/legal-documents.ts tests/hunter-account-contract.test.mjs tests/public-content-safety.test.mjs
git commit -m "feat: disclose guardian and waiver receipt data"
```

Expected: both test files pass and the computed policy hash matches the published body.

## Task 3: D1 waiver and receipt ledger migration

**Files:**
- Create: `migrations/0006_participation_waiver_and_receipts.sql`
- Modify: `tests/api-schema.test.ts`
- Modify: `tests/api-store-integration.test.ts`

- [ ] **Step 1: Write failing schema contracts**

Assert the migration creates the three ledgers and uniqueness boundary:

```ts
assert.match(sql, /CREATE TABLE IF NOT EXISTS legal_document_review_events/i);
assert.match(sql, /CREATE TABLE IF NOT EXISTS waiver_acceptance_participants/i);
assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_delivery_events/i);
assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_job_target/i);
assert.match(sql, /participant_role TEXT NOT NULL CHECK \(participant_role IN \('adult', 'minor'\)\)/i);
```

- [ ] **Step 2: Run schema tests and witness RED**

Run: `npm run test:unit -- --test-name-pattern="waiver ledger schema"`

Expected: FAIL because migration `0006` is absent.

- [ ] **Step 3: Add the idempotent migration**

Create:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legal_document_review_events (
  id TEXT PRIMARY KEY,
  hunter_subject TEXT NOT NULL REFERENCES player_accounts(subject) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type = 'participation_waiver'),
  document_version TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_legal_review_subject
  ON legal_document_review_events(hunter_subject, document_version, reviewed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS waiver_acceptance_participants (
  id TEXT PRIMARY KEY,
  acceptance_event_id TEXT NOT NULL REFERENCES legal_acceptance_events(id) ON DELETE CASCADE,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('adult', 'minor')),
  full_name TEXT NOT NULL,
  birth_year INTEGER,
  guardian_attested INTEGER NOT NULL DEFAULT 0 CHECK (guardian_attested IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK ((participant_role = 'adult' AND birth_year IS NULL AND guardian_attested = 0)
      OR (participant_role = 'minor' AND birth_year IS NOT NULL AND guardian_attested = 1))
);

CREATE INDEX IF NOT EXISTS idx_waiver_participants_acceptance
  ON waiver_acceptance_participants(acceptance_event_id, participant_role, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_job_target
  ON notification_jobs(kind, target_record_id);

CREATE TABLE IF NOT EXISTS notification_delivery_events (
  id TEXT PRIMARY KEY,
  notification_job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('queued', 'attempted', 'sent', 'failed', 'requeued')),
  provider TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_job
  ON notification_delivery_events(notification_job_id, occurred_at DESC, id DESC);
```

- [ ] **Step 4: Test a clean migration and idempotent replay**

Extend Miniflare integration setup to apply `0001` through `0006` twice. Insert one player, review, acceptance, adult, two minors, job, and delivery event; assert counts `1/1/3/1/1`. Assert a second `waiver_receipt` job for the same acceptance fails the unique index.

- [ ] **Step 5: Run GREEN checks and commit**

```powershell
npm run test:unit -- --test-name-pattern="waiver ledger schema|waiver migration"
git add migrations/0006_participation_waiver_and_receipts.sql tests/api-schema.test.ts tests/api-store-integration.test.ts
git commit -m "feat: add waiver and receipt ledgers"
```

## Task 4: Domain types, store interface, and test kit

**Files:**
- Modify: `src/server/types.ts`
- Modify: `tests/api-test-kit.ts`
- Create: `tests/waiver-store.test.ts`

- [ ] **Step 1: Add failing interface-level tests**

Create representative values and assert review, acceptance, participants, and receipt status survive the fake store:

```ts
const accepted = await store.acceptParticipationWaiver("hunter-1", {
  reviewEventId: "review-1",
  idempotencyKey: "accept-1",
  adultName: "Alex Hunter",
  minors: [{ fullName: "Sam Hunter", birthYear: 2014 }],
  guardianAttested: true,
  documentVersion: "2026.1",
  documentHash: "a".repeat(64)
});
assert.equal(accepted.replayed, false);
assert.equal(accepted.value.participants.length, 2);
assert.equal(accepted.value.receipt.status, "pending");
```

- [ ] **Step 2: Run and witness TypeScript RED**

Run: `npx tsx --test tests/waiver-store.test.ts`

Expected: compilation failure because waiver interfaces and store methods are absent.

- [ ] **Step 3: Add explicit domain types**

Add:

```ts
export interface WaiverMinorInput { fullName: string; birthYear: number }
export interface WaiverParticipantSnapshot {
  role: "adult" | "minor";
  fullName: string;
  birthYear: number | null;
  guardianAttested: boolean;
}
export interface WaiverReceiptState {
  jobId: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  sentAt: string | null;
}
export interface WaiverAcceptanceRecord {
  id: string;
  subject: string;
  documentVersion: string;
  documentHash: string;
  acceptedAt: string;
  referenceCode: string;
  participants: WaiverParticipantSnapshot[];
  receipt: WaiverReceiptState;
}
export interface LegalReceiptSender {
  deliver(acceptanceId: string): Promise<{ status: "sent" | "failed" }>;
}
```

Add `recordWaiverReview`, `getWaiverReview`, `acceptParticipationWaiver`, `getParticipationWaiver`, `queueWaiverReceiptResend`, `claimWaiverReceiptJob`, `getWaiverReceiptEnvelope`, `completeWaiverReceiptJob`, and staff legal-detail methods to `DataStore`. Add `waiverReceipts?: LegalReceiptSender` to `ApiDependencies`; add `LEGAL_RECEIPT_EMAIL_FROM` and `LEGAL_RECEIPT_EMAIL_REPLY_TO` to `PagesEnv`.

- [ ] **Step 4: Implement the fake store with deterministic clocks and IDs**

Keep review events keyed by ID, acceptance idempotency keyed by subject/key, participant snapshots immutable, and one receipt job per acceptance. The fake sender records calls but never sends network traffic.

- [ ] **Step 5: Run GREEN checks and commit**

```powershell
npx tsx --test tests/waiver-store.test.ts
npm run typecheck:worker
git add src/server/types.ts tests/api-test-kit.ts tests/waiver-store.test.ts
git commit -m "feat: define waiver acceptance contracts"
```

## Task 5: D1 review, acceptance, current access, and outbox store

**Files:**
- Modify: `src/server/d1-store.ts`
- Modify: `tests/api-store.test.ts`
- Modify: `tests/api-store-integration.test.ts`
- Modify: `tests/api-player-lifecycle.test.ts`

- [ ] **Step 1: Write failing store behavior tests**

Cover:

```ts
assert.equal((await store.getPlayerAccess("hunter-1")).waiverStatus, "required");
const review = await store.recordWaiverReview("hunter-1", waiverDocument);
const first = await store.acceptParticipationWaiver("hunter-1", input(review.id, "same-key"));
const replay = await store.acceptParticipationWaiver("hunter-1", input(review.id, "same-key"));
assert.equal(first.replayed, false);
assert.equal(replay.replayed, true);
assert.equal(replay.value.id, first.value.id);
assert.equal((await store.getPlayerAccess("hunter-1")).participationUnlocked, true);
```

Also assert a stale version/hash never unlocks access, minor snapshots do not appear in `listPlayers`, and player deletion does not leak them into public projections.

- [ ] **Step 2: Run targeted store tests and witness RED**

Run: `npx tsx --test tests/api-store.test.ts tests/api-store-integration.test.ts tests/api-player-lifecycle.test.ts --test-name-pattern="waiver|participation"`

Expected: FAIL on missing methods/current document logic.

- [ ] **Step 3: Implement review and acceptance persistence**

Use the existing `id()`/`now()` helpers. Acceptance must:

1. resolve the same-subject active-version review event;
2. return the stored record when the `waiver_acceptance` idempotency key already exists;
3. batch one `legal_acceptance_events` row, adult/minor snapshot rows, one `notification_jobs` row, one queued delivery event, one idempotency row, and the account timestamp update;
4. read back the complete record;
5. catch only the unique-idempotency race and return the winning record.

Use a non-guessable display reference derived from the acceptance ID, such as `TLS-W-${acceptanceId.slice(0, 8).toUpperCase()}`; never use email or subject in the reference.

- [ ] **Step 4: Activate current waiver access**

Update `getPlayerAccess` to query the active waiver version/hash exactly:

```sql
(SELECT action FROM legal_acceptance_events l
 WHERE l.hunter_subject = a.subject
   AND l.document_type = 'participation_waiver'
   AND l.document_version = ? AND l.document_hash = ?
 ORDER BY l.accepted_at DESC, l.id DESC LIMIT 1) AS waiver_action
```

Return `waiverStatus: "required"` when the document exists but current acceptance is absent, `accepted` only for the exact active version/hash, and `participationUnlocked` only when account/profile/privacy/current waiver are all valid.

- [ ] **Step 5: Implement safe job claiming and completion**

Claim only `pending`/`failed` jobs whose `next_attempt_at` is absent or due. Atomically increment attempts and lease the row by setting `next_attempt_at` five minutes ahead. Completion marks `sent` or `failed`, records only an error code, and appends the corresponding delivery event. Deliberate resend appends `requeued`, clears the due time, and never creates another acceptance.

- [ ] **Step 6: Run GREEN checks and commit**

```powershell
npx tsx --test tests/api-store.test.ts tests/api-store-integration.test.ts tests/api-player-lifecycle.test.ts --test-name-pattern="waiver|participation|receipt"
git add src/server/d1-store.ts tests/api-store.test.ts tests/api-store-integration.test.ts tests/api-player-lifecycle.test.ts
git commit -m "feat: persist waiver acceptance and receipt jobs"
```

## Task 6: Full-text transactional receipt service

**Files:**
- Create: `src/server/waiver-receipts.ts`
- Create: `tests/waiver-receipts.test.ts`
- Modify: `src/server/types.ts`
- Modify: `src/worker.ts`

- [ ] **Step 1: Write failing renderer and provider tests**

Use a fake fetch and assert:

```ts
assert.match(message.text, /SebaHub Tim Lost Something\?/);
assert.match(message.text, /Alex Hunter/);
assert.match(message.text, /Sam Hunter \(birth year 2014\)/);
assert.match(message.text, /In an emergency, I will call 911\./);
assert.match(message.html, /Alex &amp; Hunter/);
assert.doesNotMatch(message.html, /<script|exactUrl|report evidence/i);
assert.equal(request.to[0], "hunter@example.test");
```

Cover missing configuration, non-2xx Resend, malformed provider JSON, provider success, job lease suppression, and a resend after success.

- [ ] **Step 2: Run and witness RED**

Run: `npx tsx --test tests/waiver-receipts.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement pure rendering**

Export `renderWaiverReceipt(envelope)` returning `{ subject, text, html }`. Build all waiver sections from `generatedParticipationWaiver`; escape `& < > " '` in participant-controlled values; include the adult verified email, covered participants, version, effective date, accepted-at time, reference, acceptance statements, complete legal body, `/waiver`, `/rules`, and the registration reminder.

- [ ] **Step 4: Implement Resend delivery orchestration**

Create `ManagedWaiverReceipts` with injected `fetch`, store, API key, from, reply-to, and canonical origin. `deliver(acceptanceId)` must:

1. claim the job;
2. return without network if no claim is available;
3. load the private receipt envelope;
4. POST to `https://api.resend.com/emails` with HTML and text;
5. capture only Resend's message ID;
6. mark sent on 2xx; and
7. mark failed with `provider_unavailable`, `provider_rejected`, or `provider_response_invalid` without throwing private provider output into logs/API responses.

- [ ] **Step 5: Wire environment-driven construction**

Add the three receipt variables to the Worker cache signature and construct:

```ts
const store = env.DB ? new D1DataStore(env.DB) : unavailableStore;

waiverReceipts: new ManagedWaiverReceipts(store, {
  apiKey: env.RESEND_API_KEY ?? null,
  from: env.LEGAL_RECEIPT_EMAIL_FROM ?? null,
  replyTo: env.LEGAL_RECEIPT_EMAIL_REPLY_TO ?? null,
  canonicalOrigin
})
```

Share the existing store instance rather than constructing two stores. Do not fall back to `RECOVERY_EMAIL_FROM`; missing dedicated sender configuration must produce a retryable failed receipt.

- [ ] **Step 6: Run GREEN checks and commit**

```powershell
npx tsx --test tests/waiver-receipts.test.ts
npm run typecheck:worker
git add src/server/waiver-receipts.ts tests/waiver-receipts.test.ts src/server/types.ts src/worker.ts
git commit -m "feat: email complete waiver receipts"
```

## Task 7: Legal review, acceptance, receipt, and access APIs

**Files:**
- Create: `tests/waiver-api.test.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/api-auth.test.ts`
- Modify: `tests/api-environment-guard.test.ts`

- [ ] **Step 1: Write failing API tests**

Test public metadata, authenticated review, stale documents, guardian validation, idempotency, resend ownership, and access:

```ts
const review = await app.request("/api/v1/me/waiver/review", {
  method: "POST", headers: hunterHeaders, body: JSON.stringify({ version: "2026.1", hash })
});
assert.equal(review.status, 201);

const accepted = await app.request("/api/v1/me/waiver/accept", {
  method: "POST",
  headers: { ...hunterHeaders, "idempotency-key": "accept-one" },
  body: JSON.stringify({
    reviewEventId,
    version: "2026.1",
    hash,
    waiverAccepted: true,
    guardianAttested: true,
    minors: [{ fullName: "Sam Hunter", birthYear: 2014 }]
  })
});
assert.equal(accepted.status, 201);
assert.equal((await accepted.json()).data.participationUnlocked, true);
```

Assert 422 for missing/invalid names, future/implausible birth years, more than ten minors, guardian false with minors, acceptance false, and missing matching review. Assert 409 for stale version/hash and 401 for other-player receipt access.

- [ ] **Step 2: Run and witness RED**

Run: `npx tsx --test tests/waiver-api.test.ts`

Expected: route-not-found failures.

- [ ] **Step 3: Add validation helpers and rate limits**

Add `waiver_review`, `waiver_accept`, and `waiver_receipt` rules. Validate minors with trimmed names of 1–100 characters, integer birth years from current Edmonton year minus 18 through current year, array length 0–10, and guardian confirmation whenever length is nonzero.

- [ ] **Step 4: Add routes**

Implement:

```ts
app.get("/api/v1/legal/waiver", (c) => success(c, publicWaiverProjection()));
app.post("/api/v1/me/waiver/review", reviewHandler);
app.post("/api/v1/me/waiver/accept", acceptHandler);
app.get("/api/v1/me/waiver", currentWaiverHandler);
app.post("/api/v1/me/waiver/receipt", resendHandler);
```

All player writes require same-origin, authentication, rate limits, and `environment.assertWritable()`. Acceptance requires an active account, verified email, completed profile, current privacy `2026.2`, matching review event, and an idempotency key. Return acceptance success even when the background receipt attempt later fails.

Schedule `deps.waiverReceipts?.deliver(acceptance.id)` with `c.executionCtx.waitUntil`. In direct unit contexts where no execution context exists, attach a caught promise without turning email failure into an API error.

- [ ] **Step 5: Update participation error semantics**

Replace `participation_waiver_pending` with `participation_waiver_required` when the active document exists but is not accepted. Keep profile, inactive-account, privacy, case-state, zone-state, and feature-flag checks unchanged and authoritative.

- [ ] **Step 6: Run GREEN checks and commit**

```powershell
npx tsx --test tests/waiver-api.test.ts tests/api-auth.test.ts tests/api-environment-guard.test.ts
npm run typecheck:worker
git add src/server/app.ts tests/waiver-api.test.ts tests/api-auth.test.ts tests/api-environment-guard.test.ts
git commit -m "feat: activate waiver-gated hunter access"
```

## Task 8: Dashboard guardian and receipt experience

**Files:**
- Modify: `dashboard.html`
- Modify: `src/client/dashboard.ts`
- Modify: `css/hunter.css`
- Create: `tests/waiver-ui-client.test.ts`
- Create: `tests/waiver-ui-page.test.mjs`
- Modify: `tests/hunter-ui-client.test.ts`
- Modify: `tests/hunter-ui-pages.test.mjs`

- [ ] **Step 1: Write failing pure client tests**

Define and test:

```ts
const draft = {
  reviewEventId: "review-1",
  version: "2026.1",
  hash: "a".repeat(64),
  waiverAccepted: true,
  guardianAttested: true,
  minors: [{ fullName: " Sam Hunter ", birthYear: "2014" }]
};
assert.deepEqual(validateWaiverDraft(draft), {});
assert.deepEqual(buildWaiverPayload(draft).minors, [{ fullName: "Sam Hunter", birthYear: 2014 }]);
```

Add failures for locked review, blank minor name, invalid year, guardian false, and eleven minors.

- [ ] **Step 2: Write failing static accessibility contracts**

Assert `dashboard.html` has a real `/waiver` link with `aria-expanded`/`aria-controls`, a disabled waiver checkbox before review, minor fieldset/template, guardian confirmation, receipt status live region, view/print/resend controls, and two separate unchecked communication permissions.

- [ ] **Step 3: Run and witness RED**

Run:

```powershell
npx tsx --test tests/waiver-ui-client.test.ts tests/hunter-ui-client.test.ts
node --test tests/waiver-ui-page.test.mjs tests/hunter-ui-pages.test.mjs
```

Expected: missing waiver UI/functions.

- [ ] **Step 4: Activate the separate waiver flow**

Keep the profile form separate. Update labels to:

```html
<label class="check-row"><input name="huntEmail" type="checkbox"> Email me Tim Lost Something? clue and hunt updates.</label>
<label class="check-row"><input name="marketing" type="checkbox"> Email me other SebaHub news and offers.</label>
```

Change `buildProfilePayload` to submit `privacyMediaVersion: "2026.2"`, and render the privacy checkbox unchecked whenever the dashboard reports `privacyMediaRequired: true`. Do not silently carry a `2026.1` acceptance forward.

Add a dedicated waiver panel after profile completion. The `/waiver` anchor must progressively enhance: without JavaScript it navigates to the public page; with JavaScript it prevents default, fetches the public legal projection, expands the legal body, posts the review event, sets `aria-expanded="true"`, and only then enables the acceptance checkbox.

- [ ] **Step 5: Implement guardian rows and acceptance**

Use DOM creation with `textContent`, not `innerHTML`, for minor-controlled content. Add/remove controls maintain 0–10 rows. The submission sends the review ID, active version/hash, exact acceptance booleans, normalized minors, and a fresh `crypto.randomUUID()` idempotency key retained for retry until success.

- [ ] **Step 6: Implement status, print, and resend**

Render pending/sent/failed receipt status from `GET /api/v1/me/waiver`. **View accepted waiver** expands the exact accepted version; **Print** invokes `window.print()` only from a user click; **Email my receipt again** posts to the authenticated resend route, is rate-limited server-side, disables while pending, and announces the result in a polite live region.

Show this success copy only after stored acceptance:

```text
You're registered.
Save this confirmation and show it at the official clue station to receive your first clue. Registration does not permit entry into private, restricted or unsafe areas. Always follow the official map, posted signs and staff directions.
```

- [ ] **Step 7: Add responsive and print styles**

Use existing form tokens. At 390px, minor rows stack; remove buttons retain a 44px target; legal text remains at least 16px; focus is visible. Print hides navigation/actions and prints title, version, acceptance details, participants, and complete legal text in black on white.

- [ ] **Step 8: Run GREEN checks and commit**

```powershell
npx tsx --test tests/waiver-ui-client.test.ts tests/hunter-ui-client.test.ts
node --test tests/waiver-ui-page.test.mjs tests/hunter-ui-pages.test.mjs
npm run typecheck:client
git add dashboard.html src/client/dashboard.ts css/hunter.css tests/waiver-ui-client.test.ts tests/waiver-ui-page.test.mjs tests/hunter-ui-client.test.ts tests/hunter-ui-pages.test.mjs
git commit -m "feat: add guardian waiver onboarding"
```

## Task 9: Authorized Ops legal detail and receipt retry

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `src/server/app.ts`
- Modify: `ops.html`
- Modify: `src/client/ops.ts`
- Modify: `css/ops.css`
- Modify: `tests/api-auth.test.ts`
- Modify: `tests/ops-board-ui-contract.test.mjs`
- Modify: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing authorization and projection tests**

Assert unauthenticated and hunter access returns 401/403 with no legal data. Assert the player list returns only `waiverVersion`, `acceptedAt`, `minorCount`, and `receiptStatus`; it must not contain `minorName`, `birthYear`, or participant arrays. Assert the deliberate staff detail route returns the snapshot and staff retry appends an audit action.

- [ ] **Step 2: Run and witness RED**

Run: `npx tsx --test tests/api-auth.test.ts tests/ops-board-ui-behavior.test.ts && node --test tests/ops-board-ui-contract.test.mjs`

Expected: missing detail/retry behavior.

- [ ] **Step 3: Add staff-only routes and safe store projections**

Add:

```ts
GET  /api/v1/ops/players/:subject/waiver
POST /api/v1/ops/players/:subject/waiver/receipt
```

Require active staff authorization for both. The list query returns a count only. Detail returns exact legal data for one deliberately selected player. Retry validates the target's current acceptance, requeues the existing job, triggers delivery, and records actor, action, target acceptance, and timestamp without storing participant names in `audit_events.metadata_json`.

- [ ] **Step 4: Add a deliberate Ops detail panel**

Add **Review legal record** per player. Load detail only after activation; show adult/minors, version/hash, accepted time/reference, and receipt attempts/status. Do not add these fields to CSV export, bulk download, search indexing, global client state, or console logs. Add **Retry receipt** with confirmation and live result.

- [ ] **Step 5: Run GREEN checks and commit**

```powershell
npx tsx --test tests/api-auth.test.ts tests/ops-board-ui-behavior.test.ts
node --test tests/ops-board-ui-contract.test.mjs
git add src/server/types.ts src/server/d1-store.ts src/server/app.ts ops.html src/client/ops.ts css/ops.css tests/api-auth.test.ts tests/ops-board-ui-contract.test.mjs tests/ops-board-ui-behavior.test.ts
git commit -m "feat: add private waiver operations"
```

## Task 10: Prove the existing hunter toolkit unlocks safely

**Files:**
- Modify: `tests/api-auth.test.ts`
- Modify: `tests/api-public.test.ts`
- Modify: `tests/api-store-integration.test.ts`
- Modify: `tests/ops-board-ui-behavior.test.ts`
- Modify: `tests/public-content-safety.test.mjs`

- [ ] **Step 1: Add an end-to-end authorization matrix**

For one verified/profile-complete/privacy-accepted player, assert before waiver:

```text
progress write: 423 participation_waiver_required
exact waypoint: 423 participation_waiver_required
Field Note: 423 participation_waiver_required
reply: 423 participation_waiver_required
flag: allowed only under its existing rule
private report: remains account-optional and private
```

After current waiver acceptance, assert progress, exact waypoint, Field Note, reply, and image metadata creation succeed only when the case, zone, feature flags, Turnstile, and upload checks independently pass.

- [ ] **Step 2: Add privacy assertions**

Scan every public API response and built public surface for the adult verified email, minor names, birth years, acceptance IDs, receipt job IDs, provider message IDs, exact locations, and private report evidence. Assert zero matches. Assert the public clue board contains only approved derivatives and a potential find never auto-publishes.

- [ ] **Step 3: Run the matrix and fix only waiver-related regressions**

Run:

```powershell
npx tsx --test tests/api-auth.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts
node --test tests/public-content-safety.test.mjs
```

Expected: all pass. Do not loosen case/zone/moderation/human-verification rules to make waiver tests green.

- [ ] **Step 4: Commit Task 10**

```powershell
git add tests/api-auth.test.ts tests/api-public.test.ts tests/api-store-integration.test.ts tests/ops-board-ui-behavior.test.ts tests/public-content-safety.test.mjs
git commit -m "test: verify waiver-gated hunter tools"
```

## Task 11: Public navigation, SEO, docs, and handoff

**Files:**
- Modify: public HTML footers
- Modify: `sitemap.xml`
- Modify: `README.md`
- Modify: `STATUS.md`
- Modify: `tests/seo-surface.test.mjs`
- Modify: `tests/hunter-ui-pages.test.mjs`

- [ ] **Step 1: Write failing route/disclosure contracts**

Assert `/waiver` is in the sitemap, privacy/rules/dashboard footers, Worker clean routes, build allowlist, and README product table. Assert README no longer says waiver pending and documents `LEGAL_RECEIPT_EMAIL_FROM`/`LEGAL_RECEIPT_EMAIL_REPLY_TO` by name only.

- [ ] **Step 2: Run and witness RED**

Run: `node --test tests/seo-surface.test.mjs tests/hunter-ui-pages.test.mjs tests/public-content-safety.test.mjs`

- [ ] **Step 3: Update public navigation and structured discovery**

Add `/waiver` to legal footers and sitemap with canonical `https://www.timlostsomething.com/waiver`. Use normal WebPage metadata; do not fabricate Event, Offer, review, participation count, or legal-enforceability claims.

- [ ] **Step 4: Update operational documentation**

README must describe the active waiver/guardian/receipt architecture, separate marketing permissions, exact environment variable names, and local commands. STATUS must record source commits, tests, that no real email was sent, migration `0006` is local-only until explicitly approved, validation data is disposable, and production is unchanged.

- [ ] **Step 5: Run GREEN checks and commit**

```powershell
node --test tests/seo-surface.test.mjs tests/hunter-ui-pages.test.mjs tests/public-content-safety.test.mjs
git add *.html sitemap.xml README.md STATUS.md tests/seo-surface.test.mjs tests/hunter-ui-pages.test.mjs
git commit -m "docs: hand off active hunter waiver flow"
```

## Task 12: Full verification and validation-safe release gate

**Files:**
- Modify: `STATUS.md`
- Create: `docs/qa/2026-07-13-waiver-guardian-receipt-verification.md`
- Create: `scripts/verify-waiver-qa.mjs`
- Create: `tests/waiver-qa-contract.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Run the complete automated suite**

```powershell
npm run legal:verify
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: legal artifacts current; all tests/typechecks/build pass; zero high/critical production dependency findings; moderate findings are documented rather than force-downgraded.

- [ ] **Step 2: Run local browser QA with mocked providers**

At 1440×1000, 390×844, and 720×500 verify:

- `/waiver` reading and print layout;
- dashboard sign-in unavailable state remains truthful without keys;
- test-only authenticated fixture can open/expand the waiver and unlock its checkbox;
- 0, 1, and 10 minor rows remain usable;
- guardian validation and focus routing;
- acceptance success/reference/receipt pending/sent/failed states;
- participant resend and Ops retry;
- progress, note, reply, find report, and upload boundaries; and
- no horizontal overflow, console errors, or axe WCAG 2.1 A/AA violations.

Mock Resend and Clerk only inside the test harness. Record that no external email or provider write occurred.

Implement `scripts/verify-waiver-qa.mjs` with a hard read-only network boundary: abort any request whose method is not `GET`/`HEAD` unless it targets the locally spawned test server and is one of the explicitly mocked review/accept/resend endpoints. Count every mocked write and assert no request reaches Clerk, Resend, Cloudflare APIs, the validation alias, or production. Add `npm run verify:waiver-qa` and make `tests/waiver-qa-contract.test.mjs` assert the runner covers `/waiver`, dashboard, Ops, three viewports, axe, print CSS, 0/1/10 minors, receipt states, and the zero-external-write boundary.

Use this guard before every browser scenario:

```js
const mockedWrites = [];
const allowedMockWrites = new Set([
  "/api/v1/me/waiver/review",
  "/api/v1/me/waiver/accept",
  "/api/v1/me/waiver/receipt",
  "/api/v1/ops/players/hunter-1/waiver/receipt",
]);
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (["GET", "HEAD"].includes(request.method())) return route.continue();
  if (url.origin === localOrigin && allowedMockWrites.has(url.pathname)) {
    mockedWrites.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
  }
  throw new Error(`Blocked external write: ${request.method()} ${url.origin}${url.pathname}`);
});
```

- [ ] **Step 3: Run privacy-output checks**

Scan source and rendered public output for fixture emails, minor names, birth years, acceptance IDs, receipt job/provider IDs, credentials, exact coordinates, private notes, and report evidence. Inspect server/Ops bundle matches separately from actually served public surfaces; do not label a raw bundle grep as a public leak scan.

- [ ] **Step 4: Record the external-action gates**

Document that these are not performed without a new explicit approval:

1. reconcile/apply validation migrations `0001`–`0006`;
2. open or use Clerk/Resend/Cloudflare credentials;
3. configure preview-only identity, Turnstile, sender, or secrets;
4. send a controlled real waiver receipt;
5. deploy the waiver build to validation;
6. migrate/deploy production or change DNS/domains.

- [ ] **Step 5: Commit verification evidence**

```powershell
git add STATUS.md docs/qa/2026-07-13-waiver-guardian-receipt-verification.md scripts/verify-waiver-qa.mjs tests/waiver-qa-contract.test.mjs package.json
git commit -m "docs: verify waiver guardian receipt flow"
```

## Task 13: Optional validation activation after explicit approval

This task is intentionally not authorized by approval of the implementation plan alone.

- [ ] **Step 1: Obtain explicit external-action approval**

Approval must separately name validation D1 migration, credential/session access or user-managed OAuth/configuration, real email testing, and validation deployment. Production requires another later approval.

- [ ] **Step 2: Reconcile the disposable validation database**

Use the approved migration approach. Verify the `validation` sentinel before and after, confirm `0001`–`0006` ledger rows, empty personal/legal/receipt tables before testing, and no production binding resolution.

- [ ] **Step 3: Configure preview-only providers**

Verify Clerk allowed origins/redirects/webhook/password recovery, Turnstile host/action, Resend verified sender, and preview-only secrets without printing values. Do not use a command that defaults to production when preview selection is unavailable.

- [ ] **Step 4: Run one controlled disposable acceptance**

Use an owner-controlled inbox. Confirm account verification, privacy `2026.2`, waiver review, guardian/minor snapshot, tool unlock, one complete receipt, dashboard status, one deliberate resend, Ops detail/retry, and zero public disclosure. Delete disposable validation identity/data after acceptance testing while retaining only the test evidence permitted by the privacy plan.

- [ ] **Step 5: Deploy validation only and smoke test**

Build allowlisted `dist/`, deploy only to `codex-validation`, verify noindex/disposable notice, routes, headers, fail-closed behavior, D1 sentinel, and unchanged production deployment/source/domains.

---

## Completion criteria

- Waiver `2026.1` and privacy/media `2026.2` have deterministic, verified hashes.
- One adult may accept for self and up to ten directly supervised minors using only name and birth year.
- Current acceptance unlocks existing hunter tools without weakening safety, moderation, Turnstile, case, or zone controls.
- Acceptance is append-only, idempotent, and separate from privacy and communication permissions.
- A complete HTML/plain-text receipt is queued automatically and can be deliberately resent without duplicate acceptance.
- Minor identity and legal delivery details remain private, absent from exports and public output.
- Local implementation and validation-safe mocks pass; real providers, validation migrations/deployment, and all production actions remain separately approval-gated.
