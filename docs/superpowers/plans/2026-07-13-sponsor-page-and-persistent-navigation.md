# Sponsor Page and Persistent Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a campaign-specific `/sponsors` page with a protected inquiry form, private Ops workflow, and persistent sitewide Sponsors navigation, then deploy and test it only in the disposable validation environment.

**Architecture:** Add a focused sponsor-inquiry vertical slice to the existing Cloudflare Pages Worker: D1 owns private inquiries and append-only events, Hono exposes one public write endpoint and staff-only ledger endpoints, and a dedicated browser client renders the public form. Static HTML/CSS stays consistent with the existing forest/parchment/gold design; the current case-status API remains the sole live-status source, and the environment sentinel, Turnstile, KV rate limiting, idempotency, and staff authorization remain mandatory boundaries.

**Tech Stack:** Static HTML/CSS, TypeScript browser clients bundled by esbuild, Hono on Cloudflare Pages Workers, Cloudflare D1, Turnstile, KV rate limiting, Node test runner, tsx, TypeScript, Playwright, axe-core, Wrangler.

---

## File map

### New files

- `DESIGN.md` — durable site design source covering the approved stacked header and sponsor-page components.
- `sponsors.html` — indexable public sponsor-conversion page and accessible inquiry form.
- `css/sponsors.css` — sponsor-page layout and responsive styling only.
- `src/client/sponsors.ts` — client validation, Turnstile setup, idempotent submission, and success/error focus behavior.
- `migrations/0005_sponsor_inquiries.sql` — private sponsor inquiries and append-only inquiry events.
- `tests/sponsor-page.test.mjs` — static route, content, SEO/AEO, navigation, footer, and public-safety contracts.
- `tests/sponsor-client.test.ts` — public form normalization, validation, and safe payload tests.
- `tests/sponsor-api.test.ts` — public intake and private Ops API behavior.

### Modified files

- `scripts/build.mjs` — include `sponsors.html` in the allowlisted static build.
- `src/server/types.ts` — add sponsor inquiry domain types and DataStore methods.
- `src/server/d1-store.ts` — persist, list, and transition inquiries transactionally.
- `src/server/app.ts` — register `/sponsors` and sponsor API routes; add sponsor rate-limit policy.
- `src/client/ops.ts` — normalize, render, load, filter, and transition private sponsor leads.
- `ops.html` — add the Sponsors ledger navigation, metrics, table, filters, detail text, and private note controls.
- `css/ops.css` — style sponsor workflow states and responsive controls.
- `index.html` — add the highlighted Sponsors navigation item, replace the old sponsor pitch with a teaser, and update the footer link.
- `route.html`, `interview.html` — add the sitewide Sponsors navigation/footer destination.
- `start.html`, `dashboard.html`, `updates.html`, `report.html`, `rules.html`, `privacy.html`, `community-guidelines.html`, `clue-board.html` — add Sponsors to public navigation/footer and the collapsible mobile navigation pattern.
- `css/style.css`, `css/hunter.css`, `js/site.js` — implement the approved stacked sticky desktop header, compact mobile menu, anchor offsets, active Sponsors style, and non-sticky validation notice.
- `privacy.html` — disclose private sponsor-inquiry collection without adding marketing consent.
- `sitemap.xml` — include the canonical production sponsor URL.
- `tests/api-test-kit.ts` — add an in-memory sponsor-inquiry fake matching DataStore.
- `tests/api-schema.test.ts`, `tests/api-auth.test.ts`, `tests/api-environment-guard.test.ts`, `tests/api-rate-limit.test.ts`, `tests/api-security.test.ts` — cover schema, authorization, fail-closed writes, abuse controls, and public-data exclusion.
- `tests/homepage-actions.test.mjs`, `tests/seo-surface.test.mjs`, `tests/ops-board-ui-contract.test.mjs`, `tests/ops-board-ui-behavior.test.ts`, `tests/public-content-safety.test.mjs` — extend existing contracts.
- `README.md`, `STATUS.md` — record the new route, validation-only data model, checks, and production boundary.

## Domain contract

Use these names consistently across migration, DataStore, API, client, and tests:

```ts
export type SponsorSupportType = "community" | "lead" | "prize_in_kind" | "other";
export type SponsorContributionRange =
  | "not_sure"
  | "under_1000"
  | "1000_2499"
  | "2500_4999"
  | "5000_plus"
  | "prefer_to_discuss";
export type SponsorInquiryState = "new" | "contacted" | "qualified" | "accepted" | "closed";

export interface SponsorInquiryInput {
  contactName: string;
  organization: string;
  email: string;
  phone: string | null;
  supportType: SponsorSupportType;
  contributionRange: SponsorContributionRange | null;
  desiredOutcome: string;
  acknowledgementVersion: string;
}

export interface SponsorInquiryRecord extends SponsorInquiryInput {
  id: string;
  referenceCode: string;
  state: SponsorInquiryState;
  createdAt: string;
  updatedAt: string;
}
```

Public responses expose `referenceCode`, `state: "received"`, `createdAt`, and `replayed` only. They never expose the D1 primary key, contact data, proposal text, staff notes, or other inquiries.

### Task 1: Lock the design source and failing public-surface contracts

**Files:**
- Create: `DESIGN.md`
- Create: `tests/sponsor-page.test.mjs`
- Modify: `tests/homepage-actions.test.mjs`
- Modify: `tests/seo-surface.test.mjs`

- [ ] **Step 1: Create the durable design source**

Write `DESIGN.md` with the following project-specific rules:

```markdown
# Tim Lost Something? Design System

## Reader and outcome

Public hunters must find case status and hunt actions immediately. Sponsor prospects must reach a qualified inquiry without the site implying an agreement, guaranteed reach, or an unapproved partner.

## Direction

Use a playful Seba Beach mystery aesthetic: dark forest, parchment, treasure gold, the Sunny Pirate Mystery Chest, restrained pirate language, and real campaign imagery. Keep forms and operational states plain enough to scan once.

## Tokens

- Forest: `#14261c`, `#1c3527`, `#234331`
- Gold: `#e0a01e`, `#eab63f`, `#f2cd6a`
- Parchment: `#f6efdd`, `#efe4c6`, `#e5d5ac`
- Ink: `#241b0f`, `#3a2e1c`
- Rust accent: `#a6452a`
- Display: Pirata One with Georgia fallback
- Body: IM Fell English with Georgia fallback
- Operational/meta: Special Elite with Courier fallback
- Radius: 8–16px; cards use visible borders and restrained shadows

## Persistent header

Desktop uses two sticky rows: the authoritative case strip at top 0 and the navigation row directly below it. Mobile keeps the compact case strip and collapses navigation behind an explicit menu button. Sponsors is gold-highlighted; current page uses `aria-current="page"`. Anchor and focus scrolling clear both rows.

## Sponsor page

Order: campaign hero, three-point trust strip, three opportunity cards, recognition boundary, qualified inquiry, FAQ, footer. Lead Sponsor is visually featured. No fixed public prices, audience claims, media promises, exclusivity, or unapproved logos.

## Media

Use existing campaign-safe treasure and mystery assets. Do not generate fake sponsors, crowds, prize evidence, or media coverage. Decorative imagery never communicates a factual benefit.

## Forms

Always show labels, required marks, hints, field errors, Turnstile state, a summary alert, and a focusable success region. Never rely on color alone.

## Mobile and motion

Verify 390px without horizontal overflow. Do not keep two desktop-height rows on mobile. Respect reduced motion and 200% zoom.
```

- [ ] **Step 2: Write the failing sponsor page contract**

Create `tests/sponsor-page.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("the sponsor page is a canonical, indexable conversion surface", () => {
  const html = read("sponsors.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.timlostsomething\.com\/sponsors"/);
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.match(html, /Put your name inside the mystery/i);
  assert.match(html, /Community Sponsor/);
  assert.match(html, /Lead Sponsor/);
  assert.match(html, /Prize (?:&amp;|&) In-Kind Partner/);
  assert.match(html, /data-sponsor-form/);
  assert.match(html, /data-sponsor-turnstile/);
  assert.match(html, /Submitting.*does not create.*agreement/is);
  assert.match(html, /FAQPage/);
  assert.doesNotMatch(html, /\$\d|CFCW|guaranteed reach|exclusive sponsor/i);
});

test("every public page reaches Sponsors from navigation and footer", () => {
  for (const name of [
    "index.html", "route.html", "interview.html", "start.html", "dashboard.html",
    "updates.html", "report.html", "rules.html", "privacy.html",
    "community-guidelines.html", "clue-board.html", "sponsors.html"
  ]) {
    const html = read(name);
    assert.match(html, /href=["'](?:\/sponsors|sponsors\.html)["']/i, name + " sponsor link");
    assert.match(html, /Sponsors/i, name + " sponsor label");
  }
});

test("the sponsor page contains no public lead data or invented partner claim", () => {
  const html = read("sponsors.html");
  assert.doesNotMatch(html, /@sebahub\.com|@businessasaforceforgood\.ca/i);
  assert.doesNotMatch(html, /sponsor_inquiries|private note|staff_subject/i);
  assert.doesNotMatch(html, /radio partner|media partner|impressions|audience size/i);
});
```

- [ ] **Step 3: Extend existing navigation and SEO tests**

Add `"sponsors.html"` to the expected homepage targets in `tests/homepage-actions.test.mjs`. Add `"/sponsors"` to the indexable routes and keep it out of the private-route loop in `tests/seo-surface.test.mjs`:

```js
assert.match(html, /href=["']sponsors\.html["']/i);

for (const route of [
  "/", "/route", "/interview", "/updates", "/rules", "/privacy",
  "/community-guidelines", "/clue-board", "/sponsors"
]) {
  assert.match(sitemap, new RegExp("<loc>https://www\\.timlostsomething\\.com" + route.replaceAll("/", "\\/") + "</loc>"));
}
```

- [ ] **Step 4: Run the contracts to verify they fail**

Run:

```powershell
node --test tests/sponsor-page.test.mjs tests/homepage-actions.test.mjs tests/seo-surface.test.mjs
```

Expected: FAIL because `sponsors.html` and its links do not exist.

- [ ] **Step 5: Commit the design source and red tests**

```powershell
git add DESIGN.md tests/sponsor-page.test.mjs tests/homepage-actions.test.mjs tests/seo-surface.test.mjs
git commit -m "test: define sponsor page and navigation contracts"
```

### Task 2: Add the private D1 sponsor-inquiry ledger

**Files:**
- Create: `migrations/0005_sponsor_inquiries.sql`
- Modify: `tests/api-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Append to `tests/api-schema.test.ts`:

```ts
test("the sponsor migration keeps inquiries private and events append-only", async () => {
  const sql = await readFile(path.resolve("migrations", "0005_sponsor_inquiries.sql"), "utf8");
  for (const table of ["sponsor_inquiries", "sponsor_inquiry_events"]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + table + "\\b", "i"));
  }
  assert.match(sql, /UNIQUE\s*\(reference_code\)/i);
  assert.match(sql, /UNIQUE\s*\(idempotency_key\)/i);
  assert.match(sql, /CHECK\s*\(state IN \('new', 'contacted', 'qualified', 'accepted', 'closed'\)\)/i);
  assert.match(sql, /FOREIGN KEY\s*\(inquiry_id\).*ON DELETE CASCADE/is);
  assert.doesNotMatch(sql, /ip_address|fingerprint|turnstile_token/i);
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run: `tsx --test tests/api-schema.test.ts`
Expected: FAIL with `ENOENT` for migration 0005.

- [ ] **Step 3: Create the migration**

Create `migrations/0005_sponsor_inquiries.sql`:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sponsor_inquiries (
  id TEXT PRIMARY KEY,
  reference_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  organization TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  support_type TEXT NOT NULL CHECK (support_type IN ('community', 'lead', 'prize_in_kind', 'other')),
  contribution_range TEXT CHECK (
    contribution_range IS NULL OR contribution_range IN (
      'not_sure', 'under_1000', '1000_2499', '2500_4999', '5000_plus', 'prefer_to_discuss'
    )
  ),
  desired_outcome TEXT NOT NULL,
  acknowledgement_version TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new'
    CHECK (state IN ('new', 'contacted', 'qualified', 'accepted', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (reference_code),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_inquiries_queue
  ON sponsor_inquiries(state, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sponsor_inquiries_organization
  ON sponsor_inquiries(organization COLLATE NOCASE, created_at DESC);

CREATE TABLE IF NOT EXISTS sponsor_inquiry_events (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL,
  actor_subject TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('submitted', 'state_changed', 'note_added')),
  from_state TEXT,
  to_state TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (inquiry_id) REFERENCES sponsor_inquiries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sponsor_inquiry_events_ledger
  ON sponsor_inquiry_events(inquiry_id, created_at DESC, id DESC);
```

- [ ] **Step 4: Run the schema test**

Run: `tsx --test tests/api-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate the migration against a disposable local D1**

Run:

```powershell
npx wrangler d1 migrations apply tim-lost-hunter-platform --local
npx wrangler d1 execute tim-lost-hunter-platform --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sponsor_%' ORDER BY name"
```

Expected: migration 0005 applies and both sponsor tables are returned.

- [ ] **Step 6: Commit**

```powershell
git add migrations/0005_sponsor_inquiries.sql tests/api-schema.test.ts
git commit -m "feat: add private sponsor inquiry ledger"
```

### Task 3: Implement typed D1 sponsor storage

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/d1-store.ts`
- Modify: `tests/api-test-kit.ts`
- Modify: `tests/api-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Add focused tests to `tests/api-store.test.ts` using the file's existing D1 statement fake:

```ts
test("sponsor inquiry creation returns the same record on idempotent replay", async () => {
  const database = new RecordingDatabase();
  database.firstResults.push(null);
  database.batchResults.push([
    { results: [] },
    { results: [] },
  ]);
  database.firstResults.push({
    id: "sponsor-1",
    reference_code: "SP-AB12CD34",
    contact_name: "Alex Sponsor",
    organization: "Example Ltd.",
    email: "alex@example.test",
    phone: null,
    support_type: "lead",
    contribution_range: "prefer_to_discuss",
    desired_outcome: "Discuss a useful local activation.",
    acknowledgement_version: "2026.1",
    state: "new",
    created_at: "2026-07-13T20:00:00.000Z",
    updated_at: "2026-07-13T20:00:00.000Z",
  });
  const store = new D1DataStore(database as never);
  const created = await store.createSponsorInquiry({
    contactName: "Alex Sponsor",
    organization: "Example Ltd.",
    email: "alex@example.test",
    phone: null,
    supportType: "lead",
    contributionRange: "prefer_to_discuss",
    desiredOutcome: "Discuss a useful local activation.",
    acknowledgementVersion: "2026.1",
  }, "sponsor-key-1");
  assert.equal(created.replayed, false);
  assert.equal(created.value.referenceCode, "SP-AB12CD34");
  assert.equal(database.batchCalls.length, 1);
});
```

Also add a test proving `updateSponsorInquiry` writes a state-change event in the same batch and rejects an unknown inquiry with `null`.

- [ ] **Step 2: Run the store test to verify it fails**

Run: `tsx --test tests/api-store.test.ts`
Expected: FAIL because sponsor DataStore methods do not exist.

- [ ] **Step 3: Add sponsor types and DataStore methods**

Add the domain contract from the top of this plan to `src/server/types.ts` and extend `DataStore`:

```ts
getSponsorInquiryByIdempotencyKey(idempotencyKey: string): Promise<SponsorInquiryRecord | null>;
createSponsorInquiry(
  input: SponsorInquiryInput,
  idempotencyKey: string,
): Promise<{ value: SponsorInquiryRecord; replayed: boolean }>;
listSponsorInquiries(options?: {
  limit?: number;
  cursor?: string | null;
  state?: SponsorInquiryState | null;
  supportType?: SponsorSupportType | null;
  query?: string | null;
}): Promise<Page<SponsorInquiryRecord>>;
updateSponsorInquiry(
  id: string,
  input: { state: SponsorInquiryState; note: string | null },
  actorSubject: string,
): Promise<SponsorInquiryRecord | null>;
```

- [ ] **Step 4: Implement row projection and idempotent creation**

In `src/server/d1-store.ts` add a `sponsorFromRow` projector and the four methods. Creation uses a generated reference such as `SP-AB12CD34`, performs the inquiry insert and initial `submitted` event in one `db.batch` call, then reads the created row. Catch a unique idempotency conflict by rereading the existing record; do not swallow other D1 errors.

```ts
const sponsorFromRow = (row: Row): SponsorInquiryRecord => ({
  id: value(row.id),
  referenceCode: value(row.reference_code),
  contactName: value(row.contact_name),
  organization: value(row.organization),
  email: value(row.email),
  phone: nullable(row.phone),
  supportType: row.support_type as SponsorSupportType,
  contributionRange: nullable(row.contribution_range) as SponsorContributionRange | null,
  desiredOutcome: value(row.desired_outcome),
  acknowledgementVersion: value(row.acknowledgement_version),
  state: row.state as SponsorInquiryState,
  createdAt: value(row.created_at),
  updatedAt: value(row.updated_at),
});

const sponsorReference = () =>
  "SP-" + crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
```

`listSponsorInquiries` must parameterize every filter, cap the page at 50, escape `%` and `_` in search text, and return an opaque cursor derived from `created_at` plus `id`. `updateSponsorInquiry` reads the current state, batches the update and event, and returns the updated projection.

- [ ] **Step 5: Extend FakeStore with deterministic sponsor behavior**

In `tests/api-test-kit.ts` add an in-memory map keyed by D1 ID, an idempotency map, and methods with exactly the same signatures. Generate deterministic test references:

```ts
private sponsorInquiries = new Map<string, SponsorInquiryRecord>();
private sponsorInquiryIds = new Map<string, string>();

async getSponsorInquiryByIdempotencyKey(key: string) {
  const inquiryId = this.sponsorInquiryIds.get(key);
  return inquiryId ? this.sponsorInquiries.get(inquiryId) ?? null : null;
}
```

The fake list method filters by state, support type, and a case-insensitive organization/contact query. The fake update method returns `null` for an unknown ID.

- [ ] **Step 6: Run store and type checks**

Run:

```powershell
tsx --test tests/api-store.test.ts
npm run typecheck:worker
npm run typecheck:tests
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/server/types.ts src/server/d1-store.ts tests/api-test-kit.ts tests/api-store.test.ts
git commit -m "feat: persist sponsor inquiries and events"
```

### Task 4: Add the protected public inquiry API

**Files:**
- Create: `tests/sponsor-api.test.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/api-rate-limit.test.ts`
- Modify: `tests/api-environment-guard.test.ts`
- Modify: `tests/api-security.test.ts`

- [ ] **Step 1: Write failing public intake tests**

Create `tests/sponsor-api.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import {
  FakeEnvironment, FakeIdentity, FakeRateLimits, FakeStore,
  FakeTurnstile, FakeUploads, json, responseJson,
} from "./api-test-kit";

const valid = {
  contactName: "Alex Sponsor",
  organization: "Example Ltd.",
  email: "alex@example.test",
  phone: "",
  supportType: "lead",
  contributionRange: "prefer_to_discuss",
  desiredOutcome: "Discuss a useful local campaign activation.",
  acknowledgementAccepted: true,
  acknowledgementVersion: "2026.1",
  cfTurnstileResponse: "human-token",
};

const makeApp = () => {
  const store = new FakeStore();
  const rateLimits = new FakeRateLimits();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    rateLimits,
    environment: new FakeEnvironment(),
  });
  return { app, store, rateLimits };
};

test("a valid sponsor inquiry returns only a safe reference", async () => {
  const { app, rateLimits } = makeApp();
  const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    ...json(valid, {
      origin: "https://www.timlostsomething.com",
      "idempotency-key": "sponsor-key-1",
    }),
  });
  assert.equal(response.status, 201);
  const payload = await responseJson(response);
  assert.match(payload.data.referenceCode, /^SP-[A-Z0-9]{8}$/);
  assert.equal(payload.data.state, "received");
  assert.equal(payload.data.replayed, false);
  assert.equal(payload.data.email, undefined);
  assert.equal(payload.data.desiredOutcome, undefined);
  assert.deepEqual(rateLimits.seen.map((entry) => entry.scope), ["sponsor_inquiry"]);
});

test("an idempotent retry returns the original sponsor reference", async () => {
  const { app } = makeApp();
  const request = () => app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    ...json(valid, {
      origin: "https://www.timlostsomething.com",
      "idempotency-key": "sponsor-key-2",
    }),
  });
  const first = await request();
  const second = await request();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((await responseJson(first)).data.referenceCode, (await responseJson(second)).data.referenceCode);
});

test("sponsor intake rejects missing acknowledgement, invalid enums, and failed human verification", async () => {
  const { app } = makeApp();
  for (const body of [
    { ...valid, acknowledgementAccepted: false },
    { ...valid, supportType: "radio_partner" },
    { ...valid, cfTurnstileResponse: "wrong-token" },
  ]) {
    const response = await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
      method: "POST",
      ...json(body, {
        origin: "https://www.timlostsomething.com",
        "idempotency-key": crypto.randomUUID(),
      }),
    });
    assert.ok(response.status >= 400);
  }
});
```

- [ ] **Step 2: Run the API test to verify it fails**

Run: `tsx --test tests/sponsor-api.test.ts`
Expected: FAIL with 404 for the new route.

- [ ] **Step 3: Add the rate-limit policy and clean route**

In `src/server/app.ts`:

```ts
const cleanRoutes = new Map([
  ["/", "/index.html"],
  ["/route", "/route.html"],
  ["/interview", "/interview.html"],
  ["/start", "/start.html"],
  ["/dashboard", "/dashboard.html"],
  ["/updates", "/updates.html"],
  ["/report", "/report.html"],
  ["/rules", "/rules.html"],
  ["/privacy", "/privacy.html"],
  ["/community-guidelines", "/community-guidelines.html"],
  ["/clue-board", "/clue-board.html"],
  ["/sponsors", "/sponsors.html"],
  ["/ops", "/ops.html"],
]);

const rateLimitRules = {
  // retain existing scopes
  sponsor_inquiry: { limit: 3, windowSeconds: 600 },
} as const;
```

Keep `/sponsors` inside `appPaths` so the Pages fallback redirects to the canonical host in production.

- [ ] **Step 4: Add strict request validation and the route**

Add enumerated sets and a safe public response helper:

```ts
const validSponsorSupportTypes = new Set<SponsorSupportType>([
  "community", "lead", "prize_in_kind", "other",
]);
const validSponsorContributionRanges = new Set<SponsorContributionRange>([
  "not_sure", "under_1000", "1000_2499", "2500_4999",
  "5000_plus", "prefer_to_discuss",
]);

const safeSponsorSubmission = (record: SponsorInquiryRecord, replayed: boolean) => ({
  referenceCode: record.referenceCode,
  state: "received",
  createdAt: record.createdAt,
  replayed,
});
```

Register before the catch-all API route:

```ts
app.post("/api/v1/sponsors/inquiries", async (c) => {
  sameOrigin(c.req.raw);
  const key = idempotencyKey(c.req.raw);
  const existing = await deps.store.getSponsorInquiryByIdempotencyKey(key);
  if (existing) return success(c, safeSponsorSubmission(existing, true));
  await applyRateLimit(deps, c.req.raw, "sponsor_inquiry", null);
  const { body, files } = await requestBody(c.req.raw);
  if (files.length) throw new ApiError(415, "unsupported_media_type", "Sponsor inquiries cannot include files.");
  await verifyHuman(deps, c.req.raw, body, "sponsor_inquiry");
  if (body.acknowledgementAccepted !== true) {
    throw new ApiError(422, "acknowledgement_required", "Accept the privacy acknowledgement to submit.", {
      field: "acknowledgementAccepted",
    });
  }
  if (body.acknowledgementVersion !== privacyMediaDocument.version) {
    throw new ApiError(409, "privacy_version_outdated", "Review the current Privacy Policy & Media Notice.");
  }
  const supportType = requiredString(body, "supportType", { max: 30 }) as SponsorSupportType;
  if (!validSponsorSupportTypes.has(supportType)) {
    throw new ApiError(422, "validation_failed", "Choose a valid support type.", { field: "supportType" });
  }
  const rawRange = optionalString(body, "contributionRange", 30) as SponsorContributionRange | null;
  if (rawRange && !validSponsorContributionRanges.has(rawRange)) {
    throw new ApiError(422, "validation_failed", "Choose a valid contribution range.", {
      field: "contributionRange",
    });
  }
  const capture = await deps.store.createSponsorInquiry({
    contactName: requiredString(body, "contactName", { max: 100, label: "Contact name" }),
    organization: requiredString(body, "organization", { max: 160, label: "Organization" }),
    email: email(body, "email"),
    phone: optionalString(body, "phone", 40),
    supportType,
    contributionRange: rawRange,
    desiredOutcome: requiredString(body, "desiredOutcome", {
      min: 10, max: 3000, label: "Partnership idea",
    }),
    acknowledgementVersion: privacyMediaDocument.version,
  }, key);
  return success(c, safeSponsorSubmission(capture.value, capture.replayed), capture.replayed ? 200 : 201);
});
```

- [ ] **Step 5: Extend fail-closed and security tests**

In `tests/api-environment-guard.test.ts` add a sponsor POST to the existing mismatched-environment table and assert `503 environment_mismatch` with no FakeStore inquiry. In `tests/api-rate-limit.test.ts` assert the fourth unique sponsor inquiry within 600 seconds returns 429. In `tests/api-security.test.ts` assert no public GET route can enumerate `/api/v1/sponsors/inquiries` and the POST response excludes contact/proposal fields.

- [ ] **Step 6: Run focused API checks**

Run:

```powershell
tsx --test tests/sponsor-api.test.ts tests/api-rate-limit.test.ts tests/api-environment-guard.test.ts tests/api-security.test.ts
npm run typecheck:worker
npm run typecheck:tests
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/server/app.ts tests/sponsor-api.test.ts tests/api-rate-limit.test.ts tests/api-environment-guard.test.ts tests/api-security.test.ts
git commit -m "feat: accept protected sponsor inquiries"
```

### Task 5: Build and test the accessible sponsor form client

**Files:**
- Create: `src/client/sponsors.ts`
- Create: `tests/sponsor-client.test.ts`

- [ ] **Step 1: Write failing client-unit tests**

Create `tests/sponsor-client.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSponsorPayload,
  validateSponsorDraft,
  type SponsorDraft,
} from "../src/client/sponsors";

const valid: SponsorDraft = {
  contactName: "Alex Sponsor",
  organization: "Example Ltd.",
  email: "alex@example.test",
  phone: "",
  supportType: "lead",
  contributionRange: "prefer_to_discuss",
  desiredOutcome: "Discuss a useful local campaign activation.",
  acknowledgementAccepted: true,
  acknowledgementVersion: "2026.1",
  turnstileToken: "verified-token",
};

test("sponsor validation accepts the approved minimum disclosure", () => {
  assert.deepEqual(validateSponsorDraft(valid), {});
});

test("sponsor validation rejects missing identity, idea, privacy, and human proof", () => {
  const errors = validateSponsorDraft({
    ...valid,
    contactName: "",
    organization: "",
    email: "bad",
    desiredOutcome: "short",
    acknowledgementAccepted: false,
    turnstileToken: "",
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    "acknowledgementAccepted", "contactName", "desiredOutcome",
    "email", "organization", "turnstileToken",
  ]);
});

test("the sponsor payload trims text and omits an empty phone", () => {
  assert.deepEqual(buildSponsorPayload({ ...valid, organization: "  Example Ltd.  " }), {
    contactName: "Alex Sponsor",
    organization: "Example Ltd.",
    email: "alex@example.test",
    supportType: "lead",
    contributionRange: "prefer_to_discuss",
    desiredOutcome: "Discuss a useful local campaign activation.",
    acknowledgementAccepted: true,
    acknowledgementVersion: "2026.1",
    cfTurnstileResponse: "verified-token",
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `tsx --test tests/sponsor-client.test.ts`
Expected: FAIL because `src/client/sponsors.ts` does not exist.

- [ ] **Step 3: Implement the pure client contract**

Create `src/client/sponsors.ts` with exported `SponsorDraft`, `SponsorErrors`, `validateSponsorDraft`, and `buildSponsorPayload`. Use the same enum values and maximum lengths as the server. Never include arbitrary form keys.

```ts
export function buildSponsorPayload(draft: SponsorDraft): Record<string, unknown> {
  return {
    contactName: draft.contactName.trim(),
    organization: draft.organization.trim(),
    email: draft.email.trim().toLowerCase(),
    ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
    supportType: draft.supportType,
    ...(draft.contributionRange ? { contributionRange: draft.contributionRange } : {}),
    desiredOutcome: draft.desiredOutcome.trim(),
    acknowledgementAccepted: draft.acknowledgementAccepted,
    acknowledgementVersion: draft.acknowledgementVersion,
    cfTurnstileResponse: draft.turnstileToken,
  };
}
```

- [ ] **Step 4: Implement Turnstile and idempotent submission**

Follow `src/client/report.ts` without importing it. Use action `sponsor_inquiry`, fetch `/api/v1/config`, disable submission when configuration is unavailable, keep one `pendingIdempotencyKey` across network retries, and clear it only after success or user input.

Submit JSON to `/api/v1/sponsors/inquiries` with:

```ts
const response = await fetch("/api/v1/sponsors/inquiries", {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": pendingIdempotencyKey,
  },
  body: JSON.stringify(buildSponsorPayload(draft)),
  credentials: "same-origin",
  signal: AbortSignal.timeout(20_000),
});
```

On success, reset the form and Turnstile, then focus a `role="status"` region containing:

```ts
result.textContent =
  "Inquiry " + referenceCode +
  " was received privately. Submission does not create a sponsorship agreement.";
result.focus();
```

Map 429, 409, 422, Turnstile failure, environment mismatch, and generic network failure to neutral, non-confirming error copy.

- [ ] **Step 5: Implement accessible field errors**

Use `data-error-for` elements and `aria-invalid` exactly as `src/client/report.ts` does. Focus the first invalid field after a failed client validation. Keep the summary in `role="alert"` and do not inject server text as HTML.

- [ ] **Step 6: Run client tests and type checks**

Run:

```powershell
tsx --test tests/sponsor-client.test.ts
npm run typecheck:client
npm run typecheck:tests
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/client/sponsors.ts tests/sponsor-client.test.ts
git commit -m "feat: add accessible sponsor inquiry client"
```

### Task 6: Build the sponsor page, SEO/AEO, and homepage teaser

**Files:**
- Create: `sponsors.html`
- Create: `css/sponsors.css`
- Modify: `scripts/build.mjs`
- Modify: `sitemap.xml`
- Modify: `index.html`
- Modify: `tests/sponsor-page.test.mjs`
- Modify: `tests/public-content-safety.test.mjs`

- [ ] **Step 1: Add the static build route and sitemap entry**

Add `"sponsors.html"` to `staticFiles` in `scripts/build.mjs`. Add:

```xml
<url>
  <loc>https://www.timlostsomething.com/sponsors</loc>
</url>
```

to `sitemap.xml` beside the other indexable campaign surfaces.

- [ ] **Step 2: Create the semantic sponsor page**

Create `sponsors.html` using the same favicon, font, `css/style.css`, case-strip, topbar, validation decoration compatibility, and status client as `index.html`. Include:

```html
<main id="main" tabindex="-1">
  <section class="sponsor-hero" aria-labelledby="sponsor-title">
    <div class="wrap sponsor-hero__grid">
      <div>
        <p class="sponsor-kicker">Sponsor the Seba Beach Treasure Hunt</p>
        <h1 id="sponsor-title">Put your name inside the mystery.</h1>
        <p>Help turn a local search into a memorable Seba Beach experience—and tell us what kind of support makes sense for your organization.</p>
        <p class="sponsor-actions">
          <a class="btn" href="#inquiry">Start a sponsorship inquiry</a>
          <a class="btn btn--ghost" href="#opportunities">See ways to participate</a>
        </p>
      </div>
      <img src="/assets/favicon.svg" alt="" width="260" height="260" />
    </div>
  </section>

  <section class="sponsor-trust" aria-label="Sponsorship principles">
    <div class="wrap sponsor-trust__grid">
      <article><h2>A real local story</h2><p>Connected to the current Tim Lost Something? campaign.</p></article>
      <article><h2>Flexible support</h2><p>Cash, prizes, services, or a practical campaign contribution.</p></article>
      <article><h2>Clear approval</h2><p>Recognition is agreed before any sponsor name or logo is published.</p></article>
    </div>
  </section>

  <section class="sponsor-opportunities" id="opportunities" aria-labelledby="opportunities-title">
    <div class="wrap">
      <p class="sponsor-kicker">Ways to join the hunt</p>
      <h2 id="opportunities-title">Start with the fit, not a rigid package.</h2>
      <div class="sponsor-cards">
        <article><h3>Community Sponsor</h3><p>A straightforward local presence shaped with the campaign team.</p></article>
        <article class="sponsor-card--featured"><h3>Lead Sponsor</h3><p>A larger tailored role, subject to campaign-fit and safety review.</p></article>
        <article><h3>Prize &amp; In-Kind Partner</h3><p>Useful goods, services, prizes, printing, or operational support.</p></article>
      </div>
      <p class="sponsor-boundary"><strong>Clear expectations:</strong> Audience size, media coverage, exclusivity, social reach, and placements are not guaranteed unless formally agreed.</p>
    </div>
  </section>
</main>
```

Then add this form before the FAQ:

```html
<section class="sponsor-inquiry" id="inquiry" aria-labelledby="inquiry-title">
  <div class="wrap sponsor-inquiry__grid">
    <div>
      <p class="sponsor-kicker">Qualified inquiry</p>
      <h2 id="inquiry-title">Tell us what you have in mind.</h2>
      <p>The campaign team reviews each inquiry privately. No organization is published as a sponsor without a separate agreement.</p>
    </div>
    <div class="form-shell">
      <div class="system-message" data-sponsor-result role="status" aria-live="polite" tabindex="-1" hidden></div>
      <div class="system-message" data-sponsor-errors role="alert" tabindex="-1" hidden></div>
      <form data-sponsor-form novalidate>
        <input name="acknowledgementVersion" type="hidden" value="2026.1" />
        <div class="form-grid">
          <div class="form-field">
            <label for="sponsor-contact">Contact name <span class="required-mark" aria-hidden="true">*</span></label>
            <input id="sponsor-contact" name="contactName" type="text" autocomplete="name" maxlength="100" required aria-describedby="sponsor-contact-error" />
            <span class="field-error" id="sponsor-contact-error" data-error-for="contactName"></span>
          </div>
          <div class="form-field">
            <label for="sponsor-organization">Organization <span class="required-mark" aria-hidden="true">*</span></label>
            <input id="sponsor-organization" name="organization" type="text" autocomplete="organization" maxlength="160" required aria-describedby="sponsor-organization-error" />
            <span class="field-error" id="sponsor-organization-error" data-error-for="organization"></span>
          </div>
          <div class="form-field">
            <label for="sponsor-email">Work email <span class="required-mark" aria-hidden="true">*</span></label>
            <input id="sponsor-email" name="email" type="email" autocomplete="email" maxlength="254" required aria-describedby="sponsor-email-error" />
            <span class="field-error" id="sponsor-email-error" data-error-for="email"></span>
          </div>
          <div class="form-field">
            <label for="sponsor-phone">Callback phone (optional)</label>
            <input id="sponsor-phone" name="phone" type="tel" autocomplete="tel" maxlength="40" />
          </div>
          <div class="form-field">
            <label for="sponsor-support">Support type <span class="required-mark" aria-hidden="true">*</span></label>
            <select id="sponsor-support" name="supportType" required aria-describedby="sponsor-support-error">
              <option value="">Choose one</option>
              <option value="community">Community sponsorship</option>
              <option value="lead">Lead sponsorship</option>
              <option value="prize_in_kind">Prize or in-kind support</option>
              <option value="other">Another useful idea</option>
            </select>
            <span class="field-error" id="sponsor-support-error" data-error-for="supportType"></span>
          </div>
          <div class="form-field">
            <label for="sponsor-range">Estimated contribution range (optional)</label>
            <select id="sponsor-range" name="contributionRange">
              <option value="">Choose one</option>
              <option value="not_sure">Not sure yet</option>
              <option value="under_1000">Under $1,000</option>
              <option value="1000_2499">$1,000–$2,499</option>
              <option value="2500_4999">$2,500–$4,999</option>
              <option value="5000_plus">$5,000+</option>
              <option value="prefer_to_discuss">Prefer to discuss</option>
            </select>
          </div>
          <div class="form-field form-field--full">
            <label for="sponsor-outcome">What would make this partnership worthwhile? <span class="required-mark" aria-hidden="true">*</span></label>
            <textarea id="sponsor-outcome" name="desiredOutcome" minlength="10" maxlength="3000" required aria-describedby="sponsor-outcome-error"></textarea>
            <span class="field-error" id="sponsor-outcome-error" data-error-for="desiredOutcome"></span>
          </div>
          <div class="form-field form-field--full">
            <label>Prove you're human <span class="required-mark" aria-hidden="true">*</span></label>
            <div class="turnstile-shell" data-sponsor-turnstile aria-describedby="sponsor-turnstile-error">
              <span data-sponsor-turnstile-state>Preparing the human check…</span>
            </div>
            <span class="field-error" id="sponsor-turnstile-error" data-error-for="turnstileToken"></span>
          </div>
          <div class="form-field form-field--full">
            <label for="sponsor-acknowledgement">
              <input id="sponsor-acknowledgement" name="acknowledgementAccepted" type="checkbox" required aria-describedby="sponsor-acknowledgement-error" />
              I confirm this inquiry is accurate and may be reviewed privately by the campaign team under the <a href="/privacy">Privacy Policy &amp; Media Notice</a>.
            </label>
            <span class="field-error" id="sponsor-acknowledgement-error" data-error-for="acknowledgementAccepted"></span>
          </div>
        </div>
        <p><button class="btn" type="submit" data-sponsor-submit>Send sponsorship inquiry</button></p>
        <p class="field-hint">Submitting does not create a sponsorship agreement, subscribe you to marketing, or authorize publication of your organization.</p>
      </form>
    </div>
  </div>
</section>
```

Load `/assets/app/status.js`, `/js/site.js`, and `/assets/app/sponsors.js` after the footer.

- [ ] **Step 3: Add exact FAQ structured data**

Add one `FAQPage` JSON-LD script whose questions and answers exactly match the rendered FAQ:

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Can we contribute products or services instead of cash?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Useful prizes, printing, services, and practical campaign support can be proposed through the inquiry form."
      }
    },
    {
      "@type": "Question",
      "name": "Does submitting an inquiry create a sponsorship agreement?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "No. The campaign team reviews each inquiry privately. Recognition, deliverables, and publication require a separate agreement."
      }
    }
  ]
}
```

Render those two questions verbatim, plus plain rendered answers for package flexibility, publication timing, and follow-up.

- [ ] **Step 4: Create focused page CSS**

Create `css/sponsors.css` using existing tokens. Implement:

```css
.sponsor-hero {
  color: var(--cream-100);
  background:
    radial-gradient(circle at 78% 28%, rgba(242, 205, 106, .18), transparent 24rem),
    linear-gradient(135deg, var(--green-800), var(--green-950));
  padding: clamp(54px, 8vw, 96px) 0;
}
.sponsor-hero__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(220px, .65fr);
  align-items: center;
  gap: 42px;
}
.sponsor-trust__grid,
.sponsor-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.sponsor-card--featured {
  border-color: var(--gold-500);
  background: #fff5d8;
  transform: translateY(-6px);
}
.sponsor-inquiry {
  color: var(--cream-100);
  background: var(--green-900);
}
@media (max-width: 760px) {
  .sponsor-hero__grid,
  .sponsor-trust__grid,
  .sponsor-cards,
  .sponsor-inquiry__grid {
    grid-template-columns: 1fr;
  }
  .sponsor-hero__grid img { display: none; }
  .sponsor-card--featured { transform: none; }
}
```

Reuse `hunter.css` form classes where they already meet the design; add sponsor-only layout names instead of duplicating field primitives.

- [ ] **Step 5: Replace the old homepage sponsor section with a teaser**

Keep `id="sponsor"` for old deep links. Remove the public tier amounts and external generic contact button. Use:

```html
<section class="sponsor" id="sponsor" aria-labelledby="home-sponsor-title">
  <div class="wrap center">
    <p class="eyebrow">Support the hunt</p>
    <h2 class="section-title" id="home-sponsor-title">Put your name inside the mystery.</h2>
    <p class="section-lead">Cash, prizes, services, and practical in-kind support can all start with one private conversation.</p>
    <p class="sponsor-cta"><a class="btn" href="sponsors.html">Explore sponsorship opportunities</a></p>
    <small class="sponsor-note">Submitting an inquiry does not create an agreement or publish your organization.</small>
  </div>
</section>
```

- [ ] **Step 6: Run static contracts and build**

Run:

```powershell
node --test tests/sponsor-page.test.mjs tests/homepage-actions.test.mjs tests/seo-surface.test.mjs tests/public-content-safety.test.mjs
npm run build
Test-Path dist\sponsors.html
```

Expected: all tests PASS, build succeeds, and `Test-Path` returns `True`.

- [ ] **Step 7: Commit**

```powershell
git add sponsors.html css/sponsors.css scripts/build.mjs sitemap.xml index.html tests/sponsor-page.test.mjs tests/public-content-safety.test.mjs
git commit -m "feat: add sponsor conversion page"
```

### Task 7: Implement the approved sitewide stacked navigation

**Files:**
- Modify: `index.html`, `route.html`, `interview.html`
- Modify: `start.html`, `dashboard.html`, `updates.html`, `report.html`, `rules.html`
- Modify: `privacy.html`, `community-guidelines.html`, `clue-board.html`, `sponsors.html`
- Modify: `css/style.css`, `css/hunter.css`, `js/site.js`
- Modify: `tests/sponsor-page.test.mjs`
- Modify: `tests/hunter-ui-pages.test.mjs`

- [ ] **Step 1: Add failing sticky/mobile-navigation contracts**

Extend `tests/sponsor-page.test.mjs`:

```js
test("desktop uses the approved stacked sticky header and mobile menus remain explicit", () => {
  const style = read("css/style.css");
  const hunter = read("css/hunter.css");
  assert.match(style, /\.case-strip\s*\{[^}]*position:\s*sticky/s);
  assert.match(style, /\.case-strip\s*\+\s*\.topbar\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--case-strip-height\)/s);
  assert.match(hunter, /\.hunter-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--case-strip-height\)/s);
  assert.match(style, /scroll-padding-top:\s*var\(--stacked-header-height\)/);
  assert.match(style, /\.validation-environment-notice\s*\{[^}]*position:\s*relative/s);
  for (const name of ["start.html", "dashboard.html", "updates.html", "report.html", "rules.html", "privacy.html", "community-guidelines.html"]) {
    const html = read(name);
    assert.match(html, /class="menu-toggle"/);
    assert.match(html, /aria-controls="nav"/);
    assert.match(html, /id="nav"/);
  }
});
```

- [ ] **Step 2: Run the contract to verify it fails**

Run: `node --test tests/sponsor-page.test.mjs tests/hunter-ui-pages.test.mjs`
Expected: FAIL because the second row is not sticky and hunter-page menus are not collapsible.

- [ ] **Step 3: Apply the desktop sticky geometry**

In both CSS files define:

```css
:root {
  --case-strip-height: 54px;
  --campaign-nav-height: 66px;
  --stacked-header-height: calc(var(--case-strip-height) + var(--campaign-nav-height));
}
html { scroll-padding-top: var(--stacked-header-height); }
.validation-environment-notice { position: relative; }
.case-strip { top: 0; min-height: var(--case-strip-height); }
.case-strip + .topbar,
.hunter-header {
  position: sticky;
  z-index: 1100;
  top: var(--case-strip-height);
}
```

Remove the current `position: relative; top: auto` override. Use `scroll-margin-top: var(--stacked-header-height)` on `[id]` targets that can receive navigation. Confirm z-index ordering: skip link, modal and validation alert remain above headers.

- [ ] **Step 4: Add Sponsors and current-page state to every header/footer**

Use root-relative `/sponsors` on hunter pages and `sponsors.html` on the three classic pages. Add `aria-current="page"` only in `sponsors.html`. Add class `nav-sponsors`:

```html
<a class="nav-sponsors" href="/sponsors">Sponsors</a>
```

Use the same destination in each footer. Retain `/#sponsor` only as a backwards-compatible homepage teaser target; no footer should use it as the primary Sponsors destination.

- [ ] **Step 5: Add the mobile menu button to hunter headers**

Change hunter-page headers to:

```html
<a class="hunter-brand" href="/">Tim Lost Something?<span>This year: Tim lost his ID</span></a>
<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav">
  <span class="sr-only">Toggle campaign menu</span><span aria-hidden="true">☰</span>
</button>
<nav class="hunter-nav" id="nav" aria-label="Campaign">
  <a href="/start">Start</a>
  <a href="/route">12-waypoint route</a>
  <a href="/updates">Updates</a>
  <a href="/report">Report</a>
  <a class="nav-sponsors" href="/sponsors">Sponsors</a>
</nav>
```

Retain page-specific Clue board, Rules, and Dashboard items where present. Load `/js/site.js` after the markup.

- [ ] **Step 6: Harden the existing menu behavior**

Update `js/site.js` so Escape closes the menu, outside focus is not trapped, and `aria-expanded` is always synchronized:

```js
function closeNav(toggle, nav) {
  nav.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
}

function initNav() {
  var toggle = document.querySelector(".menu-toggle");
  var nav = document.getElementById("nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.addEventListener("click", function (event) {
    if (event.target instanceof HTMLAnchorElement) closeNav(toggle, nav);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      closeNav(toggle, nav);
      toggle.focus();
    }
  });
}
```

- [ ] **Step 7: Add responsive and active-state CSS**

```css
.nav-sponsors {
  padding: 8px 12px;
  color: var(--ink-900) !important;
  background: var(--gold-400);
  border: 1px solid var(--gold-300);
  border-radius: 8px;
  font-weight: 700;
}
.nav-sponsors[aria-current="page"] { box-shadow: inset 0 0 0 2px var(--ink-900); }
@media (max-width: 720px) {
  :root {
    --case-strip-height: 76px;
    --campaign-nav-height: 58px;
  }
  .case-strip__detail { display: none; }
  .hunter-header__inner { flex-flow: row wrap; align-items: center; }
  .hunter-nav { display: none; flex-basis: 100%; }
  .hunter-nav.open { display: flex; }
  .menu-toggle { display: inline-flex; margin-left: auto; }
  .nav-sponsors { border-radius: 0; }
}
```

The mobile visual test must assert that the rendered case strip height is no more than 76px and that the navigation header's computed `top` equals that rendered height. A failure is a defect in the compact copy or CSS and blocks the task.

- [ ] **Step 8: Run contracts and build**

Run:

```powershell
node --test tests/sponsor-page.test.mjs tests/homepage-actions.test.mjs tests/hunter-ui-pages.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add index.html route.html interview.html start.html dashboard.html updates.html report.html rules.html privacy.html community-guidelines.html clue-board.html sponsors.html css/style.css css/hunter.css js/site.js tests/sponsor-page.test.mjs tests/hunter-ui-pages.test.mjs
git commit -m "feat: make case and sponsor navigation persistent"
```

### Task 8: Add the staff-only Sponsors ledger

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/client/ops.ts`
- Modify: `ops.html`
- Modify: `css/ops.css`
- Modify: `tests/sponsor-api.test.ts`
- Modify: `tests/api-auth.test.ts`
- Modify: `tests/ops-board-ui-contract.test.mjs`
- Modify: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing staff API tests**

Add to `tests/sponsor-api.test.ts`:

```ts
test("only active staff can list and transition sponsor inquiries", async () => {
  const { app } = makeApp();
  await app.request("https://www.timlostsomething.com/api/v1/sponsors/inquiries", {
    method: "POST",
    ...json(valid, {
      origin: "https://www.timlostsomething.com",
      "idempotency-key": "sponsor-ops-1",
    }),
  });
  const unauthenticated = await app.request("https://www.timlostsomething.com/api/v1/ops/sponsors");
  assert.equal(unauthenticated.status, 401);

  const headers = { authorization: "Bearer staff-token" };
  const list = await app.request("https://www.timlostsomething.com/api/v1/ops/sponsors", { headers });
  assert.equal(list.status, 200);
  const items = (await responseJson(list)).data;
  assert.equal(items.length, 1);
  assert.equal(items[0].email, "alex@example.test");

  const changed = await app.request(
    "https://www.timlostsomething.com/api/v1/ops/sponsors/" + items[0].id,
    {
      method: "PATCH",
      headers: {
        ...headers,
        origin: "https://www.timlostsomething.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ state: "qualified", note: "Good local fit; schedule a call." }),
    },
  );
  assert.equal(changed.status, 200);
  assert.equal((await responseJson(changed)).data.state, "qualified");
});
```

- [ ] **Step 2: Run the staff API test to verify it fails**

Run: `tsx --test tests/sponsor-api.test.ts tests/api-auth.test.ts`
Expected: FAIL with 404 for the Ops sponsors route.

- [ ] **Step 3: Add staff-only list and transition routes**

In `src/server/app.ts`:

```ts
app.get("/api/v1/ops/sponsors", async (c) => {
  await requireStaff(deps, c.req.raw);
  const state = optionalSponsorState(c.req.query("state"));
  const supportType = optionalSponsorSupportType(c.req.query("supportType"));
  const result = await deps.store.listSponsorInquiries({
    limit: queryLimit(c.req.query("limit")),
    cursor: c.req.query("cursor") ?? null,
    state,
    supportType,
    query: c.req.query("q")?.trim().slice(0, 100) || null,
  });
  return success(c, result.items, 200, { nextCursor: result.nextCursor });
});

app.patch("/api/v1/ops/sponsors/:id", async (c) => {
  sameOrigin(c.req.raw);
  const staff = await requireStaff(deps, c.req.raw);
  const { body, files } = await requestBody(c.req.raw);
  if (files.length) throw new ApiError(415, "unsupported_media_type", "Sponsor notes cannot include files.");
  const state = requiredString(body, "state", { max: 20 }) as SponsorInquiryState;
  if (!validSponsorStates.has(state)) {
    throw new ApiError(422, "validation_failed", "Choose a valid sponsor state.", { field: "state" });
  }
  const inquiry = await deps.store.updateSponsorInquiry(
    c.req.param("id"),
    { state, note: optionalString(body, "note", 2000) },
    staff.subject,
  );
  if (!inquiry) throw new ApiError(404, "sponsor_inquiry_not_found", "Sponsor inquiry not found.");
  return success(c, inquiry);
});
```

- [ ] **Step 4: Write failing Ops UI contracts**

Extend `tests/ops-board-ui-contract.test.mjs` to require `Sponsors`, `id="sponsors-table"`, filters, status region, and no public email strings. Extend `tests/ops-board-ui-behavior.test.ts` to import and test:

```ts
const html = renderSponsorRows([{
  id: "sponsor-1",
  referenceCode: "SP-AB12CD34",
  contactName: "<script>alert(1)</script>",
  organization: "=Example Ltd.",
  email: "alex@example.test",
  phone: null,
  supportType: "lead",
  contributionRange: "prefer_to_discuss",
  desiredOutcome: "<img src=x onerror=alert(1)>",
  acknowledgementVersion: "2026.1",
  state: "new",
  createdAt: "2026-07-13T20:00:00.000Z",
  updatedAt: "2026-07-13T20:00:00.000Z",
}]);
assert.doesNotMatch(html, /<script>|<img/);
assert.match(html, /&lt;script&gt;/);
assert.match(html, /SP-AB12CD34/);
```

- [ ] **Step 5: Add the Ops Sponsors view**

Add `"sponsors"` to `OpsView` and hash resolution. In `ops.html` insert Sponsors between Private Reports and Moderation, renumber later visual labels, and add:

```html
<section class="ops-view" data-view-panel="sponsors" aria-labelledby="sponsors-title" hidden>
  <header class="ops-view__header">
    <div><p class="ops-kicker">Private partnership pipeline</p><h1 id="sponsors-title">Sponsors</h1></div>
    <p>Inquiry is not an agreement</p>
  </header>
  <div class="ops-metrics" aria-label="Sponsor inquiry totals">
    <article><span>New</span><strong id="sponsor-new-count">--</strong><small>Awaiting review</small></article>
    <article><span>Contacted</span><strong id="sponsor-contacted-count">--</strong><small>Follow-up started</small></article>
    <article><span>Qualified</span><strong id="sponsor-qualified-count">--</strong><small>Potential fit</small></article>
    <article><span>Accepted</span><strong id="sponsor-accepted-count">--</strong><small>Internal pipeline state</small></article>
  </div>
  <section class="ops-panel">
    <div class="ops-toolbar">
      <label for="sponsor-state-filter">State</label>
      <select id="sponsor-state-filter"><option value="">All states</option></select>
      <label for="sponsor-search">Search</label>
      <input id="sponsor-search" type="search" maxlength="100" />
      <button class="ops-button ops-button--quiet" id="refresh-sponsors" type="button">Refresh</button>
    </div>
    <p id="sponsors-state" role="status" aria-live="polite">Open this ledger to load private inquiries.</p>
    <div class="ops-table-wrap">
      <table>
        <thead><tr><th>Received</th><th>Reference</th><th>Organization</th><th>Contact</th><th>Support</th><th>State</th><th>Action</th></tr></thead>
        <tbody id="sponsors-table"><tr><td colspan="7"><span class="ops-table-empty">No sponsor records loaded.</span></td></tr></tbody>
      </table>
    </div>
  </section>
</section>
```

- [ ] **Step 6: Implement Ops normalization, rendering, loading, and state changes**

In `src/client/ops.ts` add exported `normalizeOpsSponsors` and `renderSponsorRows`. Reuse the existing `escapeHtml` helper for every text value. Load only when the Sponsors view opens, apply encoded filters, and render private fields in the authorized table.

State buttons open a deliberate prompt for a private note, then PATCH:

```ts
const { response, payload } = await opsRequest(
  "/api/v1/ops/sponsors/" + encodeURIComponent(inquiryId),
  {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: nextState, note }),
  },
);
```

Accepted must display this reminder: “Accepted is an internal pipeline state. It does not publish a sponsor.” Do not add client-side CSV export in this pass; YAGNI and the design makes export conditional on a separate privacy review.

- [ ] **Step 7: Style sponsor states without color-only meaning**

In `css/ops.css` use text labels plus existing chip styles. Add support for narrow screens so the toolbar wraps and the table remains inside `.ops-table-wrap`.

- [ ] **Step 8: Run staff API and UI checks**

Run:

```powershell
tsx --test tests/sponsor-api.test.ts tests/api-auth.test.ts tests/ops-board-ui-behavior.test.ts
node --test tests/ops-board-ui-contract.test.mjs
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/server/app.ts src/client/ops.ts ops.html css/ops.css tests/sponsor-api.test.ts tests/api-auth.test.ts tests/ops-board-ui-contract.test.mjs tests/ops-board-ui-behavior.test.ts
git commit -m "feat: add private sponsor operations ledger"
```

### Task 9: Update privacy, public safety, and project documentation

**Files:**
- Modify: `privacy.html`
- Modify: `tests/public-content-safety.test.mjs`
- Modify: `README.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Write the failing privacy/public-output contract**

Add to `tests/public-content-safety.test.mjs`:

```js
test("sponsor inquiry handling is disclosed but private records never enter public files", () => {
  const privacy = read("privacy.html");
  assert.match(privacy, /sponsorship inquir/i);
  assert.match(privacy, /organization.*contact.*proposal/is);
  const publicSources = publicFiles.map(read).join("\n");
  assert.doesNotMatch(publicSources, /alex@example\.test|Good local fit|staff_subject/i);
  assert.doesNotMatch(publicSources, /CFCW/i);
});
```

- [ ] **Step 2: Run the contract to verify it fails**

Run: `node --test tests/public-content-safety.test.mjs`
Expected: FAIL because sponsor inquiry handling is not yet disclosed.

- [ ] **Step 3: Add a narrow privacy disclosure**

In `privacy.html`, add to the account/report/community collection section:

```html
<h3>Sponsorship inquiries</h3>
<p>When you submit a sponsorship inquiry, we collect your contact name, organization, work email, optional callback phone, proposed support type, optional contribution range, and the partnership outcome you describe. We use this information to assess and follow up on the inquiry, maintain a private partnership pipeline, prevent abuse, and document any later agreement.</p>
<p>Submitting an inquiry does not subscribe you to hunt updates or SebaHub marketing, create a sponsorship agreement, or authorize us to publish your organization’s name or logo.</p>
```

Do not change Privacy Policy & Media Notice version `2026.1` unless legal review concludes this is a material purpose change. If it is material, stop and require a separately approved version/hash update rather than silently editing the legal body.

- [ ] **Step 4: Update project docs**

Add `/sponsors` and its purpose to the README route table. Add architecture bullets for sponsor inquiries, the private event ledger, and no email automation. In `STATUS.md` record:

- the implementation commit;
- local test/build evidence;
- whether validation migration 0005 is applied;
- whether Turnstile permits action `sponsor_inquiry`;
- that production migration, deployment, DNS, and data remain unchanged;
- that validation inquiries are disposable.

- [ ] **Step 5: Run privacy and content tests**

Run:

```powershell
node --test tests/public-content-safety.test.mjs tests/sponsor-page.test.mjs
rg -n -i "CFCW|guaranteed reach|exclusive sponsor|radio partner" --glob "!docs/**" --glob "!.superpowers/**" .
```

Expected: tests PASS and `rg` returns no result.

- [ ] **Step 6: Commit**

```powershell
git add privacy.html tests/public-content-safety.test.mjs README.md STATUS.md
git commit -m "docs: disclose private sponsor inquiry handling"
```

### Task 10: Full local verification and visual QA

**Files:**
- Modify only if a failing check identifies a defect in files already listed
- Record final evidence in: `STATUS.md`

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Expected: all tests and type checks PASS; both Worker builds succeed; no high or critical production dependency finding.

- [ ] **Step 2: Start the local Pages runtime**

Run in a background terminal:

```powershell
npm run dev
```

Expected: Wrangler serves the built site and reports the local URL.

- [ ] **Step 3: Run route and privacy smoke checks**

Against the reported local URL, verify:

```powershell
curl.exe -I http://127.0.0.1:8788/sponsors
curl.exe http://127.0.0.1:8788/api/v1/status
curl.exe -i http://127.0.0.1:8788/api/v1/ops/sponsors
```

Expected: sponsor page 200, status API returns its normal local result, and unauthenticated Ops sponsors returns 401 without inquiry details.

- [ ] **Step 4: Perform desktop visual and accessibility QA**

Use Playwright at 1440×1000. Verify:

- both header rows stay visible after scrolling through hero, cards, form, FAQ, and footer;
- Sponsors remains gold-highlighted;
- skip link and anchor targets clear both rows;
- there is no overlap at 200% zoom;
- form errors focus the first invalid control;
- Turnstile-unavailable state disables submission rather than pretending success;
- axe-core reports no WCAG 2.1 A/AA violations.

Save screenshots to a temporary QA folder outside the repository; do not commit them.

- [ ] **Step 5: Perform mobile visual and accessibility QA**

Use Playwright at 390×844. Verify:

- no horizontal overflow;
- the case strip is compact;
- the menu opens, closes on link activation, closes with Escape, and restores focus;
- Sponsors is present in the menu;
- cards stack without artificial heights;
- the form, privacy checkbox, Turnstile shell, and success region remain readable;
- axe-core reports no WCAG 2.1 A/AA violations.

- [ ] **Step 6: Inspect built public output**

Run:

```powershell
rg -n -i "sponsor_inquiries|sponsor_inquiry_events|private note|@sebahub\.com|@businessasaforceforgood\.ca|CFCW" dist
rg -n "sponsors.html|/sponsors" dist\sitemap.xml dist\index.html dist\sponsors.html
```

Expected: the first command returns no private schema, notes, private addresses, or CFCW references; the second confirms the public route and links.

- [ ] **Step 7: Record verification evidence and commit**

Update `STATUS.md` with exact counts and commands, then:

```powershell
git add STATUS.md
git commit -m "docs: record sponsor feature verification"
```

### Task 11: Deploy only to disposable validation and battle-test

**Files:**
- Modify only: `STATUS.md` after verified external results

- [ ] **Step 1: Verify the deployment target before any write**

Run the existing environment check:

```powershell
node scripts/verify-environment.mjs validation
```

Expected: `DEPLOYMENT_ENV=validation`, validation-suffixed D1/R2/KV/Queue bindings, and the validation D1 sentinel. Stop if any production resource is selected.

- [ ] **Step 2: Apply migration 0005 to validation D1 only**

Use the exact validation database name from `docs/validation-resource-manifest.md`:

```powershell
npx wrangler d1 migrations apply tim-lost-hunter-platform-validation --remote
```

Expected: migration 0005 applies to validation. Do not run against the production database.

- [ ] **Step 3: Verify validation Turnstile and rate-limit configuration**

Confirm through the already-authorized Cloudflare configuration that the validation hostname is allowed and the server accepts the action `sponsor_inquiry`. Do not display secret values. If Turnstile write access or keys are unavailable, stop deployment testing with the public form correctly failing closed.

- [ ] **Step 4: Deploy the allowlisted build to the validation branch**

Build from the tested commit and deploy `dist/` only to the validation branch:

```powershell
npm run build
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch codex-validation
```

Never upload the worktree and never promote the production branch.

Expected: `https://codex-validation.seba-treasure-hunt.pages.dev/sponsors` returns 200 with `X-Robots-Tag: noindex, nofollow` and the disposable-data notice.

- [ ] **Step 5: Submit one synthetic validation inquiry**

Use a clearly synthetic organization and `example.test` email through the rendered browser form. Confirm:

- Turnstile succeeds;
- one reference code is returned;
- retrying the same request does not create a second inquiry;
- no automatic email is sent;
- the record appears only in the authorized Ops Sponsors ledger;
- state transitions create events;
- Accepted does not create any public sponsor output.

- [ ] **Step 6: Run live validation checks**

Verify:

- `/sponsors`, homepage teaser, all navigation links, and all footers;
- desktop stacked sticky behavior and 390px mobile menu;
- public POST validation errors and 429 behavior;
- unauthenticated Ops list and transition denial;
- authorized filtering and state transitions;
- no lead data in HTML, sitemap, structured data, status API, or public board;
- validation notice and noindex header;
- production site and database remain unchanged.

- [ ] **Step 7: Purge the synthetic validation inquiry**

Use the approved validation-only purge guard. Verify the validation environment value, validation D1 sentinel, and validation resource name before deleting the synthetic inquiry and cascaded events. Record before/after counts. Do not run any deletion against production.

- [ ] **Step 8: Update STATUS and commit**

Record the validation deployment URL, deployment ID, migration state, test reference prefix, purge counts, blockers, and the explicit statement that production is unchanged:

```powershell
git add STATUS.md
git commit -m "docs: record sponsor validation battle test"
```

## Final acceptance checklist

- [ ] `/sponsors` matches the approved visual and content hierarchy.
- [ ] The case strip and navigation remain stacked and sticky on desktop.
- [ ] Mobile uses a compact status row and accessible collapsible navigation.
- [ ] Sponsors is present in every public header and footer.
- [ ] The homepage keeps `#sponsor` as a concise teaser and removes public fixed tiers.
- [ ] Public inquiry submission requires same-origin, environment guard, idempotency, KV rate limit, Turnstile, current privacy version, and strict server validation.
- [ ] Public responses return only a safe reference and receipt state.
- [ ] Sponsor contact data, proposals, notes, and events remain private.
- [ ] Staff list and transition routes repeat staff authorization.
- [ ] Accepted never auto-publishes a sponsor.
- [ ] No automatic email, SMS, marketing consent, or waiver acceptance is introduced.
- [ ] No CFCW or other unconfirmed partner/media claim appears.
- [ ] SEO/AEO matches rendered content and validation remains noindex.
- [ ] Automated, TypeScript, build, accessibility, mobile, privacy-output, and live validation checks pass.
- [ ] Validation inquiries are purged after the battle test.
- [ ] Production code, domains, DNS, bindings, migration state, and data remain unchanged.
