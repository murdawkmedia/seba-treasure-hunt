# Fresh Drops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-item public Fresh Drops teaser and a complete authenticated hunter gallery for the July 31 evidence set without changing the established 13 places or exposing hunter-only media.

**Architecture:** Extend the existing versioned `case_items` system with collection, placement, audience, reportability, media-audience and source-hash fields. Public item APIs return only public placements and public media; a participation-gated hunter endpoint returns the complete Fresh Drops collection and an authenticated media endpoint. The existing Ops item editor remains the authoring surface, while a guarded local importer makes the supplied batch repeatable and idempotent.

**Tech Stack:** Cloudflare Pages/Workers, Hono, D1, R2, Cloudflare Queues and Images, Clerk hunter/staff authentication, TypeScript, esbuild, Sharp, Node test runner, Miniflare, accessible HTML/CSS.

---

## Scope and file map

### New files

- `migrations/0017_fresh_drops_hunter_gallery.sql` — additive audience, collection, media and report-association schema; existing camera and Apple Watch records are repositioned without exposing new records.
- `src/shared/case-items.ts` — shared item audience, collection and placement types and guards.
- `src/client/fresh-drops.ts` — authenticated gallery normalization, private-media hydration, rendering and report links.
- `css/fresh-drops.css` — public teaser, desktop evidence board, mobile cards and media states.
- `scripts/fresh-drops-manifest.mjs` — canonical mapping from the supplied filenames to stable item records and alt text.
- `scripts/import-fresh-drops.mjs` — guarded, idempotent validation/production importer using existing Ops APIs.
- `tests/fresh-drops-manifest.test.mjs` — exact source reconciliation and grouping.
- `tests/fresh-drops-api.test.ts` — audience, authentication, media and report-association API contracts.
- `tests/fresh-drops-client.test.ts` — gallery normalization, rendering and report-link behavior.
- `tests/fresh-drops-ui.test.mjs` — static public/dashboard/Ops accessibility and build contracts.
- `docs/operations/2026-07-31-fresh-drops-validation.md` — immutable validation evidence and owner checklist.

### Existing files to modify

- `src/server/types.ts` — item input, media selection, stored hash and datastore interfaces.
- `src/server/d1-store.ts` — public/hunter/Ops projections, private media authorization, item lookup and report snapshots.
- `src/server/app.ts` — validation, hunter Fresh Drops routes, private media route and report-item handling.
- `src/server/uploads.ts` — SHA-256 calculation for case-item uploads.
- `src/client/items.ts` — public teaser projection alongside the existing item board.
- `src/client/dashboard.ts` — authenticated Fresh Drops loading and post-signup return.
- `src/client/report.ts` — signed-in item prefill and private payload.
- `src/client/ops-items.ts` — audience, placement, reportability and per-image visibility controls.
- `src/client/ops.ts` — selected-item detail in Private Reports.
- `index.html` — compact public teaser shell.
- `dashboard.html` — signed-in Fresh Drops section and viewer stylesheet.
- `report.html` — selected-item context and hidden stable item identifier.
- `ops.html` — plain-language placement guidance and create-item controls.
- `css/hunter.css` — My Hunt integration details only.
- `css/ops.css` — responsive placement and media-audience controls.
- `scripts/build.mjs` — copy the new stylesheet and bundle the imported client module through `dashboard.ts`.
- `tests/api-test-kit.ts` — fake-store support for new datastore methods and fields.
- `tests/api-store-integration.test.ts` — migration list and real-D1 coverage.
- `tests/case-items.test.ts` — existing public/Ops item regression expectations.
- `tests/unhinged-evidence-wall.test.mjs` — public board and My Hunt preservation contracts.
- `tests/public-output-privacy-scan.test.mjs` and `tests/build-isolation.test.mjs` — hunter-media and local-path non-disclosure.
- `STATUS.md` — dated validation checkpoint after the candidate is frozen.

## Decisions fixed by this plan

- `collection` is `case` or `fresh_drops`.
- `audience` is `public` or `hunter_only`.
- `showOnBoard` controls the main public evidence board.
- `teaserOrder` is `1`, `2` or `null`; it is a placement, not a separate audience.
- `reportable` controls whether **I found this** is available.
- Item media has its own `public` or `hunter_only` audience.
- Existing items default to `case`, `public`, `showOnBoard = true`, `reportable = true`.
- Camera remains public on the evidence board and occupies teaser slot 1.
- Toy car occupies teaser slot 2 but does not join the main evidence board.
- Apple Watch remains a public case fact, joins the Fresh Drops collection, and receives hunter-only media.
- The forest story is a non-reportable hunter-only item record rendered as the gallery introduction.
- New object records start as Draft. The importer changes them to Out there only after their derivatives are ready and selected.
- No usable GPS was found in this batch. Do not infer or publish a location; keep the forest sequence as visual evidence only.
- Every browser derivative must be generated without EXIF, XMP, IPTC, GPS or source filename metadata.
- No source photograph or unprocessed original enters Git, `dist`, public HTML or a public R2 path.

---

### Task 1: Freeze and reconcile the private source batch

**Files:**
- Create locally, Git-ignored: `source-media/fresh-drops-2026-07-31/*`
- Create: `scripts/fresh-drops-manifest.mjs`
- Test: `tests/fresh-drops-manifest.test.mjs`

- [ ] **Step 1: Copy the source set into the existing private source-media area**

Run from the repository root:

```powershell
$source = '<local Fresh Drops source directory>'
$target = Join-Path (Get-Location) 'source-media\fresh-drops-2026-07-31'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $target -Force
Get-ChildItem -LiteralPath $target -File | Sort-Object Name | Select-Object Name,Length
```

Expected: 21 JPEGs plus `CONTEXT.md`. `git status --short` must remain empty because `source-media/` is ignored.

- [ ] **Step 2: Write the failing manifest reconciliation test**

Create `tests/fresh-drops-manifest.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { freshDropManifest, omittedFreshDropSources } from "../scripts/fresh-drops-manifest.mjs";

test("the July 31 manifest reconciles every JPEG exactly once", () => {
  const used = freshDropManifest.flatMap((item) => item.media.map((media) => media.source));
  const reconciled = [...used, ...omittedFreshDropSources].sort();
  const expected = [
    "01-IMG_5645.jpg", "02-IMG_5646.jpg", "03-IMG_5647.jpg", "04-IMG_5630.jpg",
    "05-IMG_5629.jpg", "06-IMG_5628.jpg", "07-IMG_5627.jpg", "08-IMG_5625.jpg",
    "09-IMG_5622.jpg", "10-IMG_5621.jpg", "11-IMG_5620.jpg", "12-IMG_5619.jpg",
    "13-IMG_5618.jpg", "14-IMG_5617.jpg", "15-IMG_5616.jpg", "16-IMG_5615.jpg",
    "17-IMG_5613.jpg", "18-IMG_5614.jpg", "19-IMG_5612.jpg", "20-IMG_5610.jpg",
    "21-image000001.jpg",
  ];
  assert.deepEqual(reconciled, expected.sort());
  assert.deepEqual(omittedFreshDropSources, ["02-IMG_5646.jpg"]);
});

test("only the camera and toy car are public teaser media", () => {
  const teaser = freshDropManifest
    .filter((item) => item.teaserOrder !== null)
    .map((item) => [item.id, item.teaserOrder, item.media.map((media) => media.audience)]);
  assert.deepEqual(teaser, [
    ["case-item-camera", 1, ["public"]],
    ["case-item-toy-car", 2, ["public"]],
  ]);
});
```

- [ ] **Step 3: Run the manifest test and verify it fails**

Run:

```powershell
node --test tests/fresh-drops-manifest.test.mjs
```

Expected: FAIL because `scripts/fresh-drops-manifest.mjs` does not exist.

- [ ] **Step 4: Create the canonical manifest**

Create `scripts/fresh-drops-manifest.mjs` with these stable records:

```js
const media = (source, alt, audience = "hunter_only", caption = null) =>
  Object.freeze({ source, alt, audience, caption });

export const omittedFreshDropSources = Object.freeze(["02-IMG_5646.jpg"]);

export const freshDropManifest = Object.freeze([
  { id: "case-item-fresh-drops-story", slug: "fresh-drops-story", owner: "tim", category: "story_evidence", title: "Tim went looking again.", description: "An elastic appears to have broken while Tim retraced his steps. More cash may have fallen out, but these photographs do not reveal a location.", finderKeeps: false, reportable: false, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 0, media: [
    media("01-IMG_5645.jpg", "A pink elastic lying among leaves and forest debris"),
    media("03-IMG_5647.jpg", "Canadian cash and a pink elastic among leaves on the forest floor"),
    media("21-image000001.jpg", "Tim lying among leaves while retracing his route"),
  ] },
  { id: "case-item-camera", slug: "camera", owner: "tim", category: "prize", title: "A camera", description: "A camera is now somewhere in the search area. The finder keeps it.", finderKeeps: true, reportable: true, audience: "public", showOnBoard: true, teaserOrder: 1, collectionOrder: 1, media: [
    media("16-IMG_5615.jpg", "A compact instant camera photographed before it was hidden", "public"),
  ] },
  { id: "case-item-watch", slug: "apple-watch", owner: "tim", category: "prize", title: "An Apple Watch", description: "An Apple Watch is now somewhere in the search area. The finder keeps it.", finderKeeps: true, reportable: true, audience: "public", showOnBoard: true, teaserOrder: null, collectionOrder: 2, media: [
    media("12-IMG_5619.jpg", "A smartwatch with its charging cable photographed before it was hidden"),
  ] },
  { id: "case-item-toy-car", slug: "toy-car", owner: "tim", category: "object", title: "A tiny toy car", description: "A very small car has joined the growing pile of things out there.", finderKeeps: false, reportable: true, audience: "public", showOnBoard: false, teaserOrder: 2, collectionOrder: 3, media: [
    media("06-IMG_5628.jpg", "A small toy car held between two fingers", "public"),
  ] },
  { id: "case-item-jewellery-assortment", slug: "jewellery-assortment", owner: "tim", category: "jewellery", title: "A jewellery assortment", description: "Several pieces of jewellery are pictured together. The exact contents are part of the mystery.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 4, media: [media("04-IMG_5630.jpg", "An assortment of jewellery photographed together")] },
  { id: "case-item-packaged-miniatures", slug: "packaged-miniatures", owner: "tim", category: "collectible", title: "Packaged miniature figures", description: "A small packaged group of figures is out there.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 5, media: [media("05-IMG_5629.jpg", "Small miniature figures in retail packaging")] },
  { id: "case-item-boxed-collectible", slug: "boxed-collectible", owner: "tim", category: "collectible", title: "A boxed collectible", description: "A boxed collectible is among the latest drops.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 6, media: [media("07-IMG_5627.jpg", "A collectible item in a display box")] },
  { id: "case-item-wallet", slug: "wallet", owner: "tim", category: "accessory", title: "A wallet", description: "Yes, there is a wallet out there too.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 7, media: [media("08-IMG_5625.jpg", "A dark wallet photographed before it was hidden")] },
  { id: "case-item-beaded-mystery", slug: "beaded-mystery-item", owner: "tim", category: "mystery", title: "A beaded mystery item", description: "It is beaded. Beyond that, the mystery can do some work.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 8, media: [media("09-IMG_5622.jpg", "A small beaded item held for the camera")] },
  { id: "case-item-gold-tone-jewellery", slug: "gold-tone-jewellery", owner: "tim", category: "jewellery", title: "Gold-tone jewellery", description: "Another jewellery item is somewhere in the search area.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 9, media: [media("10-IMG_5621.jpg", "Gold-tone jewellery photographed before it was hidden")] },
  { id: "case-item-spider-brooch", slug: "spider-brooch", owner: "tim", category: "jewellery", title: "A spider brooch", description: "A spider-shaped brooch has joined the evidence file.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 10, media: [media("11-IMG_5620.jpg", "A decorative spider-shaped brooch")] },
  { id: "case-item-analog-watch", slug: "analog-watch", owner: "tim", category: "watch", title: "An analog wristwatch", description: "A second watch is pictured among the latest drops.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 11, media: [media("13-IMG_5618.jpg", "An analog wristwatch photographed before it was hidden")] },
  { id: "case-item-sunglasses", slug: "sunglasses-and-case", owner: "tim", category: "accessory", title: "Sunglasses and a case", description: "Two photographs show the same sunglasses-and-case set.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 12, media: [
    media("14-IMG_5617.jpg", "Sunglasses resting beside their case"),
    media("19-IMG_5612.jpg", "A second view of the sunglasses and case"),
  ] },
  { id: "case-item-mystery-box", slug: "mystery-box", owner: "tim", category: "mystery", title: "A boxed mystery item", description: "The box is clear enough. What it contains can remain a mystery.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 13, media: [media("15-IMG_5616.jpg", "A boxed item whose exact contents are unclear")] },
  { id: "case-item-games-media", slug: "games-and-media", owner: "tim", category: "media", title: "A stack of games and media", description: "Two views show one assorted stack.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 14, media: [
    media("17-IMG_5613.jpg", "An assorted stack of games and media"),
    media("18-IMG_5614.jpg", "A second view of the same games and media stack"),
  ] },
  { id: "case-item-assorted-mystery", slug: "assorted-mystery-items", owner: "tim", category: "mystery", title: "Assorted mystery items", description: "Several more objects are pictured together. Hunters can decide what they think they see.", finderKeeps: false, reportable: true, audience: "hunter_only", showOnBoard: false, teaserOrder: null, collectionOrder: 15, media: [media("20-IMG_5610.jpg", "Several assorted items photographed together")] },
]);
```

- [ ] **Step 5: Run the reconciled manifest contract**

Run:

```powershell
node --test tests/fresh-drops-manifest.test.mjs
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit the manifest contract**

```powershell
git add scripts/fresh-drops-manifest.mjs tests/fresh-drops-manifest.test.mjs
git commit -m "test: define Fresh Drops source manifest"
```

---

### Task 2: Add the additive Fresh Drops schema

**Files:**
- Create: `migrations/0017_fresh_drops_hunter_gallery.sql`
- Create: `src/shared/case-items.ts`
- Modify: `src/server/types.ts:22-45,277-283,307-440`
- Modify: `tests/api-store-integration.test.ts:250-270`
- Modify: `tests/case-items.test.ts:20-50`

- [ ] **Step 1: Write failing migration and type-contract tests**

Add to `tests/case-items.test.ts`:

```ts
test("Fresh Drops migration separates collection, placement and media audience", async () => {
  const sql = await readFile(path.resolve("migrations", "0017_fresh_drops_hunter_gallery.sql"), "utf8");
  assert.match(sql, /ADD COLUMN collection TEXT NOT NULL DEFAULT 'case'/i);
  assert.match(sql, /ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'/i);
  assert.match(sql, /ADD COLUMN show_on_board INTEGER NOT NULL DEFAULT 1/i);
  assert.match(sql, /ADD COLUMN teaser_order INTEGER/i);
  assert.match(sql, /ADD COLUMN reportable INTEGER NOT NULL DEFAULT 1/i);
  assert.match(sql, /ALTER TABLE case_item_media ADD COLUMN audience/i);
  assert.match(sql, /ALTER TABLE case_item_uploads ADD COLUMN source_sha256/i);
  assert.match(sql, /ALTER TABLE private_reports ADD COLUMN case_item_id/i);
  assert.match(sql, /WHERE id = 'case-item-camera'/i);
  assert.match(sql, /WHERE id = 'case-item-watch'/i);
  assert.doesNotMatch(sql, /INSERT[^;]+INTO case_items/is);
});
```

Append `"0017_fresh_drops_hunter_gallery.sql"` after migration `0016` in the real-D1 migration list in `tests/api-store-integration.test.ts`.

- [ ] **Step 2: Run focused tests and verify they fail**

```powershell
npx tsx --test tests/case-items.test.ts
```

Expected: FAIL because migration `0017` is missing.

- [ ] **Step 3: Create shared types and guards**

Create `src/shared/case-items.ts`:

```ts
export const caseItemCollections = ["case", "fresh_drops"] as const;
export const caseItemAudiences = ["public", "hunter_only"] as const;
export const caseItemMediaAudiences = ["public", "hunter_only"] as const;

export type CaseItemCollection = typeof caseItemCollections[number];
export type CaseItemAudience = typeof caseItemAudiences[number];
export type CaseItemMediaAudience = typeof caseItemMediaAudiences[number];

export const isCaseItemCollection = (value: unknown): value is CaseItemCollection =>
  typeof value === "string" && caseItemCollections.includes(value as CaseItemCollection);
export const isCaseItemAudience = (value: unknown): value is CaseItemAudience =>
  typeof value === "string" && caseItemAudiences.includes(value as CaseItemAudience);
export const isCaseItemMediaAudience = (value: unknown): value is CaseItemMediaAudience =>
  typeof value === "string" && caseItemMediaAudiences.includes(value as CaseItemMediaAudience);
```

- [ ] **Step 4: Create migration `0017`**

Use additive columns and fail-closed placement triggers:

```sql
PRAGMA foreign_keys = ON;

ALTER TABLE case_items ADD COLUMN collection TEXT NOT NULL DEFAULT 'case'
  CHECK (collection IN ('case', 'fresh_drops'));
ALTER TABLE case_items ADD COLUMN collection_order INTEGER
  CHECK (collection_order IS NULL OR collection_order BETWEEN 0 AND 999);
ALTER TABLE case_items ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'
  CHECK (audience IN ('public', 'hunter_only'));
ALTER TABLE case_items ADD COLUMN show_on_board INTEGER NOT NULL DEFAULT 1
  CHECK (show_on_board IN (0, 1));
ALTER TABLE case_items ADD COLUMN teaser_order INTEGER
  CHECK (teaser_order IS NULL OR teaser_order IN (1, 2));
ALTER TABLE case_items ADD COLUMN reportable INTEGER NOT NULL DEFAULT 1
  CHECK (reportable IN (0, 1));

ALTER TABLE case_item_media ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'
  CHECK (audience IN ('public', 'hunter_only'));
ALTER TABLE case_item_uploads ADD COLUMN source_sha256 TEXT
  CHECK (source_sha256 IS NULL OR length(source_sha256) = 64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_item_upload_source
  ON case_item_uploads(item_id, source_sha256) WHERE source_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_item_teaser_order
  ON case_items(teaser_order) WHERE teaser_order IS NOT NULL;

ALTER TABLE private_reports ADD COLUMN case_item_id TEXT
  REFERENCES case_items(id) ON DELETE RESTRICT;
ALTER TABLE private_reports ADD COLUMN case_item_title_snapshot TEXT;

CREATE TRIGGER IF NOT EXISTS trg_case_item_private_placement_insert
BEFORE INSERT ON case_items
WHEN NEW.audience != 'public' AND (NEW.show_on_board = 1 OR NEW.teaser_order IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'hunter-only items cannot have public placement'); END;

CREATE TRIGGER IF NOT EXISTS trg_case_item_private_placement_update
BEFORE UPDATE OF audience, show_on_board, teaser_order ON case_items
WHEN NEW.audience != 'public' AND (NEW.show_on_board = 1 OR NEW.teaser_order IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'hunter-only items cannot have public placement'); END;

UPDATE case_items
SET collection = 'fresh_drops', collection_order = 1,
    audience = 'public', show_on_board = 1, teaser_order = 1
WHERE id = 'case-item-camera';
UPDATE case_items
SET collection = 'fresh_drops', collection_order = 2,
    audience = 'public', show_on_board = 1, teaser_order = NULL
WHERE id = 'case-item-watch';

```

Migration `0017` must not seed any new Fresh Drops record. The guarded importer in Task 8 creates every missing record from the exact manifest as Draft, uploads and verifies its media, then activates it. This keeps a schema-only deployment harmless to the older application and prevents a half-seeded gallery after a failed media import.

- [ ] **Step 5: Extend server types**

Import shared types and extend the authoritative interfaces in `src/server/types.ts`:

```ts
import type {
  CaseItemAudience,
  CaseItemCollection,
  CaseItemMediaAudience,
} from "../shared/case-items";

export interface CaseItemMediaSelection {
  id: string;
  altText: string;
  caption: string | null;
  audience: CaseItemMediaAudience;
}

export interface CaseItemInput {
  slug: string;
  owner: CaseItemOwner;
  category: string;
  title: string;
  description: string;
  finderKeeps: boolean;
  status: CaseItemStatus;
  displayOrder: number;
  collection: CaseItemCollection;
  collectionOrder: number | null;
  audience: CaseItemAudience;
  showOnBoard: boolean;
  teaserOrder: 1 | 2 | null;
  reportable: boolean;
}

export interface StoredMedia {
  id: string;
  key: string;
  contentType?: string;
  size?: number;
  sourceSha256?: string;
  status: "processing" | "ready" | "quarantined";
}
```

Add these methods to `DataStore`:

```ts
listHunterFreshDrops(): Promise<Record<string, unknown>[]>;
getHunterCaseItemMedia(mediaId: string): Promise<{ key: string; contentType: string } | null>;
getReportableFreshDrop(id: string): Promise<{ id: string; title: string } | null>;
```

- [ ] **Step 6: Run schema and type tests**

```powershell
npx tsx --test tests/case-items.test.ts
npx tsx --test --test-name-pattern "case items" tests/api-store-integration.test.ts
```

Expected: both migration tests PASS. Run worker typechecking after Task 3 extends the real and fake stores together.

- [ ] **Step 7: Commit the schema boundary**

```powershell
git add migrations/0017_fresh_drops_hunter_gallery.sql src/shared/case-items.ts src/server/types.ts tests/case-items.test.ts tests/api-store-integration.test.ts
git commit -m "feat: add Fresh Drops audience schema"
```

---

### Task 3: Enforce public and hunter projections server-side

**Files:**
- Modify: `src/server/d1-store.ts:78-100,459-504,720-780,2205-2318,3219-3400,5828-5881`
- Modify: `src/server/app.ts:367-430,1049-1068,1216-1235,1595-1597,1744-1834`
- Modify: `src/server/uploads.ts:8-42`
- Modify: `tests/api-test-kit.ts:375-500`
- Create: `tests/fresh-drops-api.test.ts`
- Modify: `tests/api-store-integration.test.ts:282-360`

- [ ] **Step 1: Write failing API privacy tests**

Create `tests/fresh-drops-api.test.ts` using `createApiFixture` from `tests/api-test-kit.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createApiFixture, responseJson } from "./api-test-kit";

const origin = "https://www.timlostsomething.com";

test("public items exclude hunter-only records and media", async () => {
  const { app, store } = createApiFixture();
  store.caseItems.push(
    { id: "public", slug: "camera", audience: "public", showOnBoard: true, teaserOrder: 1, status: "out_there", media: [{ id: "public-media", audience: "public" }] },
    { id: "private", slug: "wallet", audience: "hunter_only", showOnBoard: false, teaserOrder: null, status: "out_there", media: [{ id: "private-media", audience: "hunter_only" }] },
  );
  const response = await app.request(`${origin}/api/v1/items`);
  const body = await responseJson(response);
  assert.deepEqual(body.data.map((item: { id: string }) => item.id), ["public"]);
  assert.doesNotMatch(JSON.stringify(body), /private-media|wallet/);
});

test("Fresh Drops requires an unlocked hunter", async () => {
  const { app, hunterHeaders } = createApiFixture();
  assert.equal((await app.request(`${origin}/api/v1/me/fresh-drops`)).status, 401);
  const locked = await app.request(`${origin}/api/v1/me/fresh-drops`, { headers: hunterHeaders });
  assert.equal(locked.status, 403);
  assert.equal((await responseJson(locked)).error.code, "participation_locked");
});

test("hunter media cannot be read through the public media endpoint", async () => {
  const { app } = createApiFixture();
  assert.equal((await app.request(`${origin}/api/v1/media/private-media`)).status, 404);
});
```

- [ ] **Step 2: Run the API tests and verify they fail**

```powershell
npx tsx --test tests/fresh-drops-api.test.ts
```

Expected: FAIL because the fake store and hunter routes do not implement audience separation.

- [ ] **Step 3: Compute a case-item source hash without changing other upload behavior**

In `src/server/uploads.ts`, calculate SHA-256 only for case-item uploads:

```ts
const sha256 = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

// Inside the existing save loop, before bucket.put:
const sourceSha256 = context.kind === "case_item" ? await sha256(file) : undefined;
await this.bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
saved.push({ id, key, contentType: file.type, size: file.size, status: "processing", ...(sourceSha256 ? { sourceSha256 } : {}) });
```

Keep report, Field Note and Official Update upload schemas unchanged.

- [ ] **Step 4: Extend row projections and mutations**

Update `caseItemFromRow` to return the new fields:

```ts
collection: value(row.collection),
collectionOrder: numberOrNull(row.collection_order),
audience: value(row.audience),
showOnBoard: row.show_on_board === 1,
teaserOrder: numberOrNull(row.teaser_order),
reportable: row.reportable === 1,
```

Update `caseItemUploads()` and `case_item_media` queries to include
`upload.source_sha256` and `selected.audience`. Update create/update SQL and
`case_item_events.details_json` to include collection, audience, placement,
reportability and selected media audiences.

Before a mutation, enforce:

```ts
if (input.audience === "hunter_only" && (input.showOnBoard || input.teaserOrder !== null)) {
  throw new ApiError(422, "case_item_private_placement", "Hunter-only items cannot appear on a public surface.");
}
if (input.mediaSelections.some((selection) => selection.audience === "public") && input.audience !== "public") {
  throw new ApiError(422, "case_item_media_audience", "Public images require a public item.");
}
```

Bind `sourceSha256` in `addCaseItemUploads()` and translate a unique hash conflict to an idempotent reload of the existing item rather than a duplicate upload record.

Before assigning a non-null teaser slot, query for a different item already in
that slot. Return `409 teaser_slot_occupied` with only the occupying item's
public-safe ID and title. Do not silently replace it and do not rely on a raw
SQLite uniqueness error for the operator message.

- [ ] **Step 5: Implement separate public and hunter projections**

Change `listPublicCaseItems()` to require `item.audience = 'public'` and select only `case_item_media.audience = 'public'`. Include `showOnBoard` and `teaserOrder` in the safe output, but never return `collectionOrder`, source hashes or object keys.

Add `listHunterFreshDrops()`:

```ts
async listHunterFreshDrops(): Promise<Record<string, unknown>[]> {
  const rows = await this.db.prepare(
    `SELECT id, slug, owner, category, title, description, finder_keeps, status,
            collection, collection_order, audience, show_on_board, teaser_order, reportable
     FROM case_items
     WHERE collection = 'fresh_drops' AND status IN ('out_there', 'found', 'paused')
     ORDER BY collection_order, id`
  ).all<Row>();
  const ids = rows.results.map((row) => value(row.id));
  const mediaByItem = await this.selectedCaseItemMedia(ids, "hunter");
  return rows.results.map((row) => ({
    ...caseItemFromRow(row, mediaByItem.get(value(row.id)) ?? [], false),
    reportable: row.reportable === 1,
  }));
}
```

Extract `selectedCaseItemMedia(ids, projection)` so the public path returns only public media and the hunter path returns both audiences with URLs shaped as `/api/v1/me/fresh-drops/media/:mediaId`.

Add:

```ts
async getHunterCaseItemMedia(mediaId: string) {
  const row = await this.db.prepare(
    `SELECT upload.derivative_object_key, upload.content_type
     FROM case_item_uploads upload
     JOIN case_item_media selected ON selected.upload_id = upload.id
     JOIN case_items item ON item.id = selected.item_id
     WHERE upload.id = ? AND upload.status = 'ready'
       AND upload.derivative_object_key IS NOT NULL
       AND item.collection = 'fresh_drops'
       AND item.status IN ('out_there', 'found', 'paused')
     LIMIT 1`
  ).bind(mediaId).first<Row>();
  const key = value(row?.derivative_object_key);
  return row && key.startsWith("derivatives/") ? { key, contentType: value(row.content_type) } : null;
}
```

Also change `getPublicMedia()` so the `case_item` union requires both
`item.audience = 'public'` and `selected.audience = 'public'`.

- [ ] **Step 6: Add participation-gated routes**

Add to `src/server/app.ts`:

```ts
const requireUnlockedHunter = async (request: Request) => {
  const hunter = await requireHunter(deps, request);
  const access = await deps.store.getPlayerAccess(hunter.subject);
  if (!access.participationUnlocked) {
    throw new ApiError(403, "participation_locked", "Complete your profile and current legal steps to open Fresh Drops.");
  }
  return hunter;
};

app.get("/api/v1/me/fresh-drops", async (c) => {
  await requireUnlockedHunter(c.req.raw);
  return success(c, await deps.store.listHunterFreshDrops());
});

app.get("/api/v1/me/fresh-drops/media/:mediaId", async (c) => {
  await requireUnlockedHunter(c.req.raw);
  const authorized = await deps.store.getHunterCaseItemMedia(c.req.param("mediaId"));
  if (!authorized) throw new ApiError(404, "case_item_media_not_found", "Item image not found.");
  const object = await deps.uploads.read(authorized.key);
  if (!object || !validImageTypes.has(object.contentType)) {
    throw new ApiError(404, "case_item_media_not_found", "Item image not found.");
  }
  return new Response(object.body, { headers: {
    "content-type": object.contentType,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
  }});
});
```

Use a local helper scoped inside `createApi` so it can access `deps` without exporting auth internals.

- [ ] **Step 7: Update input validation and the fake store**

Extend `caseItemInput()` to allow and validate `collection`, `collectionOrder`,
`audience`, `showOnBoard`, `teaserOrder`, `reportable` and each media
selection's `audience`. Mirror the authoritative behavior in
`tests/api-test-kit.ts`; do not make the fake more permissive than D1.

- [ ] **Step 8: Run focused API and real-D1 tests**

```powershell
npx tsx --test tests/fresh-drops-api.test.ts tests/case-items.test.ts
npx tsx --test --test-name-pattern "Fresh Drops|case items" tests/api-store-integration.test.ts
npm run typecheck:worker
```

Expected: all focused tests PASS.

- [ ] **Step 9: Commit the server boundary**

```powershell
git add src/shared/case-items.ts src/server/types.ts src/server/d1-store.ts src/server/app.ts src/server/uploads.ts tests/api-test-kit.ts tests/fresh-drops-api.test.ts tests/api-store-integration.test.ts tests/case-items.test.ts
git commit -m "feat: protect signed-in Fresh Drops data"
```

---

### Task 4: Add explicit Ops audience and media controls

**Files:**
- Modify: `ops.html:189-212`
- Modify: `src/client/ops-items.ts:1-365`
- Modify: `css/ops.css`
- Create: `tests/ops-items.test.ts`
- Modify: `tests/fresh-drops-ui.test.mjs`

- [ ] **Step 1: Write failing Ops normalization and payload tests**

Export `normalizeItem`, `itemPayload` and a pure `itemPlacementModel` from
`src/client/ops-items.ts`, then create `tests/ops-items.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeItem, itemPlacementModel } from "../src/client/ops-items";

test("Ops preserves item and media audiences", () => {
  const item = normalizeItem({
    id: "case-item-wallet", slug: "wallet", owner: "tim", category: "accessory",
    title: "A wallet", description: "Out there", finderKeeps: false,
    status: "out_there", displayOrder: 24, version: 2,
    collection: "fresh_drops", collectionOrder: 7, audience: "hunter_only",
    showOnBoard: false, teaserOrder: null, reportable: true,
    uploads: [{ id: "media-wallet", status: "ready", audience: "hunter_only", position: 0, altText: "A wallet" }],
  });
  assert.equal(item?.audience, "hunter_only");
  assert.equal(item?.uploads[0]?.audience, "hunter_only");
});

test("hunter-only placement disables public controls", () => {
  assert.deepEqual(itemPlacementModel("hunter_only", false, null), {
    showOnBoardEnabled: false,
    teaserEnabled: false,
    explanation: "Visible only to participation-unlocked hunters.",
  });
});

test("an occupied teaser slot requires an explicit replacement choice", () => {
  assert.deepEqual(itemPlacementModel("public", false, 1, { id: "case-item-camera", title: "A camera" }), {
    showOnBoardEnabled: true,
    teaserEnabled: true,
    explanation: "Teaser slot 1 currently shows A camera. Choose Replace to move it.",
  });
});
```

- [ ] **Step 2: Run the Ops test and verify it fails**

```powershell
npx tsx --test tests/ops-items.test.ts
```

Expected: FAIL because audience fields and pure helpers are absent.

- [ ] **Step 3: Extend Ops types and normalization**

Add `collection`, `collectionOrder`, `audience`, `showOnBoard`, `teaserOrder`
and `reportable` to `OpsCaseItem`, and `audience` plus `sourceSha256` to
`ItemUpload`. Normalize only the exact allowed values.

Render these controls in each item form:

```html
<label>Collection
  <select name="collection" required>
    <option value="case">Main case</option>
    <option value="fresh_drops">Fresh Drops</option>
  </select>
</label>
<label>Who can see this item?
  <select name="audience" required>
    <option value="hunter_only">Signed-in hunters only</option>
    <option value="public">Public</option>
  </select>
</label>
<label><input name="showOnBoard" type="checkbox" /> Show on the main public evidence board</label>
<label>Homepage teaser slot
  <select name="teaserOrder"><option value="">Not in teaser</option><option value="1">Slot 1</option><option value="2">Slot 2</option></select>
</label>
<label><input name="reportable" type="checkbox" /> Hunters can report finding this item</label>
```

For each selected upload, replace **Show this image publicly** with:

```html
<label><input type="checkbox" data-item-media-selected /> Use this image on the item</label>
<label>Image visibility
  <select data-item-media-audience>
    <option value="hunter_only">Signed-in hunter file only</option>
    <option value="public">Public</option>
  </select>
</label>
```

`itemPayload()` must include all placement fields and each selected image's
audience. When the item audience becomes hunter-only, clear public placement
locally and explain the change before sending.

If save returns `409 teaser_slot_occupied`, show the current occupant and two
plain actions: **Keep current teaser** and **Replace it**. Replacement performs
two version-checked Ops updates in order: clear the old item's slot, then save
the new item. If either update conflicts, stop, reload both item versions and
ask the operator to choose again; never leave the UI claiming replacement
succeeded when either request failed.

- [ ] **Step 4: Add plain-language Ops guidance**

In `ops.html`, add this explanation above the editor:

```html
<div class="ops-notice">
  <strong>Choose who can see it, then choose where it appears.</strong>
  Hunter-only items stay inside My Hunt. Public items may also appear on the main board or in one of the two homepage teaser slots. Saving never creates Latest News.
</div>
```

The item card must show visible badges for **Public**, **Hunter only**,
**Main board**, **Teaser 1/2** and **Reportable/Story only**.

Below the controls, render two read-only previews from the unsaved form state:
**Public preview** includes only facts and selected images that would be public
and clearly says **Not public** when the item has no public placement;
**Signed-in hunter preview** includes all selected media. Both previews use the
same containment and alt text that their final surfaces use.

- [ ] **Step 5: Add responsive styles**

In `css/ops.css`, keep placement controls in a two-column grid above 900px and
one column below it. Use native form controls, a 44px minimum control height,
visible focus, text badges and no horizontally scrolling action row.

- [ ] **Step 6: Run focused Ops and responsive contracts**

```powershell
npx tsx --test tests/ops-items.test.ts tests/ops-board-ui-behavior.test.ts
node --test tests/fresh-drops-ui.test.mjs tests/unhinged-evidence-wall.test.mjs
npm run typecheck:client
```

Expected: all PASS.

- [ ] **Step 7: Commit the Ops controls**

```powershell
git add ops.html src/client/ops-items.ts css/ops.css tests/ops-items.test.ts tests/fresh-drops-ui.test.mjs
git commit -m "feat: add Fresh Drops Ops placement controls"
```

---

### Task 5: Build the authenticated Fresh Drops gallery

**Files:**
- Create: `src/client/fresh-drops.ts`
- Create: `tests/fresh-drops-client.test.ts`
- Modify: `dashboard.html:12-27,159-198,356`
- Modify: `src/client/dashboard.ts:1-30,1231-1250,2275-2287,2612-2634`
- Create: `css/fresh-drops.css`
- Modify: `css/hunter.css`
- Modify: `tests/fresh-drops-ui.test.mjs`

- [ ] **Step 1: Write failing gallery normalization and report-link tests**

Create `tests/fresh-drops-client.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { freshDropReportHref, normalizeFreshDrops } from "../src/client/fresh-drops";

test("Fresh Drops keeps story first and accepts only authenticated media URLs", () => {
  const items = normalizeFreshDrops([
    { id: "item", slug: "wallet", category: "accessory", title: "A wallet", description: "Out there", owner: "tim", status: "out_there", reportable: true, collectionOrder: 7, media: [{ id: "m1", url: "/api/v1/me/fresh-drops/media/m1", alt: "A wallet" }] },
    { id: "story", slug: "fresh-drops-story", category: "story_evidence", title: "Tim went looking again.", description: "More fell out.", owner: "tim", status: "out_there", reportable: false, collectionOrder: 0, media: [] },
  ]);
  assert.deepEqual(items.map((item) => item.id), ["story", "item"]);
  assert.equal(items[0]?.reportable, false);
});

test("report links contain only the stable item identifier", () => {
  assert.equal(freshDropReportHref("case-item-wallet"), "/report?item=case-item-wallet&source=fresh-drops");
  assert.equal(freshDropReportHref("../../private"), "/report");
});
```

- [ ] **Step 2: Run the client test and verify it fails**

```powershell
npx tsx --test tests/fresh-drops-client.test.ts
```

Expected: FAIL because the client module is missing.

- [ ] **Step 3: Implement the isolated gallery module**

Create `src/client/fresh-drops.ts` with these exported boundaries:

```ts
import { initializeApprovedMediaViewer, renderApprovedMedia } from "./approved-media-viewer";

export interface FreshDropItem {
  id: string;
  slug: string;
  owner: "tim" | "casey";
  category: string;
  title: string;
  description: string;
  status: "out_there" | "found" | "paused";
  reportable: boolean;
  collectionOrder: number;
  media: Array<{ id: string; url: string; alt: string; caption: string }>;
}

export interface FreshDropsDependencies {
  request: (path: string) => Promise<Response>;
  requestImage: (path: string) => Promise<Response>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const safeId = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
const safeText = (value: unknown, maximum: number): string =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

export const freshDropReportHref = (id: string): string =>
  /^[A-Za-z0-9_-]{1,128}$/.test(id)
    ? `/report?item=${encodeURIComponent(id)}&source=fresh-drops`
    : "/report";

export function normalizeFreshDrops(value: unknown): FreshDropItem[] {
  if (!Array.isArray(value)) return [];
  const owners = new Set(["tim", "casey"]);
  const statuses = new Set(["out_there", "found", "paused"]);
  return value.flatMap((candidate): FreshDropItem[] => {
    if (!isRecord(candidate)) return [];
    const id = safeId(candidate.id);
    const slug = safeId(candidate.slug);
    const owner = safeText(candidate.owner, 16);
    const status = safeText(candidate.status, 24);
    const collectionOrder = candidate.collectionOrder;
    if (!id || !slug || !owners.has(owner) || !statuses.has(status)) return [];
    if (!Number.isInteger(collectionOrder) || Number(collectionOrder) < 0 || Number(collectionOrder) > 999) return [];
    const media = Array.isArray(candidate.media)
      ? candidate.media.flatMap((entry): FreshDropItem["media"] => {
          if (!isRecord(entry)) return [];
          const mediaId = safeId(entry.id);
          const alt = safeText(entry.alt, 300);
          if (!mediaId || !alt) return [];
          return [{
            id: mediaId,
            url: `/api/v1/me/fresh-drops/media/${encodeURIComponent(mediaId)}`,
            alt,
            caption: safeText(entry.caption, 500),
          }];
        })
      : [];
    return [{
      id,
      slug,
      owner: owner as FreshDropItem["owner"],
      category: safeText(candidate.category, 80),
      title: safeText(candidate.title, 160),
      description: safeText(candidate.description, 1200),
      status: status as FreshDropItem["status"],
      reportable: candidate.reportable === true,
      collectionOrder: Number(collectionOrder),
      media,
    }];
  }).sort((left, right) => left.collectionOrder - right.collectionOrder || left.id.localeCompare(right.id));
}
```

Implement `initializeFreshDrops(deps)` beneath these exports with this exact
sequence:

1. locate the state, story, list and retry elements and return without a
   network request if the section is absent;
2. fetch `/api/v1/me/fresh-drops`, require an `ok` response and normalize
   `envelope.data.items` with `normalizeFreshDrops`;
3. render the non-reportable `story_evidence` record into the story container
   and render every remaining record into the ordered list;
4. for each normalized media URL, call `requestImage`, require an image content
   type and a successful response, convert the response blob to an object URL,
   and pass that URL plus the server-provided alt/caption into
   `renderApprovedMedia`;
5. create status text and report links with DOM APIs only, using
   `freshDropReportHref(item.id)` and an accessible name containing the item
   title;
6. call `initializeApprovedMediaViewer` after cards exist;
7. if the list request fails, show **Fresh Drops could not be loaded. Try
   again.**, expose the retry button and leave the rest of My Hunt usable;
8. if an image request fails, show **Image temporarily unavailable** inside
   that card without removing the item; and
9. keep every object URL in a `Set<string>` and revoke all of them once on
   `pagehide` and before a retry replaces the rendered gallery.

Never assign API text to `innerHTML`; create nodes and set `textContent`.

- [ ] **Step 4: Add the My Hunt section**

Insert before the 13-place checklist in `dashboard.html`:

```html
<section class="fresh-drops field-panel field-panel--full" id="fresh-drops" aria-labelledby="fresh-drops-title" data-fresh-drops>
  <p class="field-label">Signed-in case file</p>
  <h2 id="fresh-drops-title">Fresh Drops</h2>
  <p>Tim went back out. The pile grew. These photographs and item details are available to registered hunters.</p>
  <p data-fresh-drops-state role="status" aria-live="polite">Loading the latest item file…</p>
  <div data-fresh-drops-story></div>
  <ol class="fresh-drops__items" data-fresh-drops-items></ol>
  <button class="hunter-button hunter-button--quiet" type="button" data-fresh-drops-retry hidden>Try Fresh Drops again</button>
</section>
```

Link `/css/fresh-drops.css` and `/css/route-lightbox.css` from `dashboard.html`.

- [ ] **Step 5: Wire the gallery into the existing Clerk session**

In `dashboard.ts`, import `initializeFreshDrops`. After `renderDashboard()` and
only when `envelope.data.participationUnlocked === true`, call it with requests
that use `authHeaders(auth)`, `credentials: "same-origin"`, `cache: "no-store"`
and the current abort signal.

Update `returnToPromptedAction()` to allow the exact same-page target
`/dashboard#fresh-drops`: remove the `returnTo` query parameter, replace the
current history entry, scroll the Fresh Drops heading into view and focus it.
Continue rejecting protocol-relative, cross-origin and every other malformed
target.

- [ ] **Step 6: Implement desktop and mobile presentation**

In `css/fresh-drops.css`:

- use a restrained evidence-board grid above 760px;
- render the story as a three-image evidence strip;
- render ordered item cards with status text and 44px **I found this** links;
- switch to one semantic column below 760px;
- use `object-fit: contain`, never crop evidence destructively;
- respect `prefers-reduced-motion`; and
- provide visible focus and no horizontal scrolling at 320px.

- [ ] **Step 7: Run gallery, accessibility and type tests**

```powershell
npx tsx --test tests/fresh-drops-client.test.ts tests/hunter-ui-client.test.ts
node --test tests/fresh-drops-ui.test.mjs tests/hunter-ui-pages.test.mjs
npm run typecheck:client
```

Expected: all PASS.

- [ ] **Step 8: Commit the signed-in gallery**

```powershell
git add src/client/fresh-drops.ts src/client/dashboard.ts dashboard.html css/fresh-drops.css css/hunter.css tests/fresh-drops-client.test.ts tests/fresh-drops-ui.test.mjs
git commit -m "feat: add signed-in Fresh Drops gallery"
```

---

### Task 6: Add the two-item public teaser

**Files:**
- Modify: `index.html:73-123`
- Modify: `src/client/items.ts:1-135`
- Modify: `css/fresh-drops.css`
- Modify: `tests/fresh-drops-client.test.ts`
- Modify: `tests/fresh-drops-ui.test.mjs`
- Modify: `tests/unhinged-evidence-wall.test.mjs`

- [ ] **Step 1: Write failing public teaser tests**

Add to `tests/fresh-drops-client.test.ts`:

```ts
test("public teaser uses only slots one and two", () => {
  const teaser = publicFreshDropTeaser([
    { slug: "camera", audience: "public", teaserOrder: 1 },
    { slug: "wallet", audience: "hunter_only", teaserOrder: null },
    { slug: "toy-car", audience: "public", teaserOrder: 2 },
  ]);
  assert.deepEqual(teaser.map((item) => item.slug), ["camera", "toy-car"]);
});
```

Add static assertions that `index.html` contains `data-fresh-drops-teaser`, a
two-item list, and a same-origin `/dashboard?returnTo=` action.

- [ ] **Step 2: Run tests and verify they fail**

```powershell
npx tsx --test tests/fresh-drops-client.test.ts
node --test tests/fresh-drops-ui.test.mjs
```

Expected: FAIL because teaser projection and markup are absent.

- [ ] **Step 3: Extend public item normalization**

In `src/client/items.ts`, accept safe `audience`, `showOnBoard` and
`teaserOrder` fields. Export:

```ts
export const publicFreshDropTeaser = (items: PublicCaseItem[]): PublicCaseItem[] =>
  items
    .filter((item) => item.audience === "public" && (item.teaserOrder === 1 || item.teaserOrder === 2))
    .sort((left, right) => Number(left.teaserOrder) - Number(right.teaserOrder))
    .slice(0, 2);
```

Continue rendering the main evidence list only for `showOnBoard === true`.
Render the teaser into its separate list from the same already-fetched public
envelope. A missing live envelope leaves the static camera/toy-car teaser copy
visible.

- [ ] **Step 4: Add the static teaser shell**

Insert after the evidence wall:

```html
<section class="fresh-drops-teaser" aria-labelledby="fresh-drops-teaser-title" data-fresh-drops-teaser>
  <div class="wrap">
    <p class="eyebrow">More fell out</p>
    <h2 id="fresh-drops-teaser-title">The pile grew.</h2>
    <p>Here are two of the latest items. Registered hunters can open the complete Fresh Drops file.</p>
    <ol data-fresh-drops-teaser-items>
      <li data-fresh-drop-teaser="camera"><strong>A camera</strong><span>One of the latest additions.</span></li>
      <li data-fresh-drop-teaser="toy-car"><strong>A tiny toy car</strong><span>Yes, really.</span></li>
    </ol>
    <a class="evidence-action evidence-action--primary" href="/dashboard?returnTo=%2Fdashboard%23fresh-drops">Sign in to see Fresh Drops</a>
  </div>
</section>
```

Do not add Fresh Drops to the three primary navigation actions.

- [ ] **Step 5: Run public and preservation tests**

```powershell
npx tsx --test tests/fresh-drops-client.test.ts
node --test tests/fresh-drops-ui.test.mjs tests/unhinged-evidence-wall.test.mjs tests/campaign-shell-preservation.test.mjs
```

Expected: all PASS; the 13 places and three primary actions remain unchanged.

- [ ] **Step 6: Commit the teaser**

```powershell
git add index.html src/client/items.ts css/fresh-drops.css tests/fresh-drops-client.test.ts tests/fresh-drops-ui.test.mjs tests/unhinged-evidence-wall.test.mjs
git commit -m "feat: tease Fresh Drops on the public case board"
```

---

### Task 7: Prefill and persist the reported item

**Files:**
- Modify: `report.html:70-140`
- Modify: `src/client/report.ts:20-140,430-531,580-600,797-840`
- Modify: `src/server/app.ts:1072-1140`
- Modify: `src/server/d1-store.ts:793-878,3878-3910,5469-5495,5741-5762`
- Modify: `src/client/ops.ts:127-158,805-839,1490-1521`
- Modify: `tests/fresh-drops-api.test.ts`
- Modify: `tests/report-workflow.test.ts`
- Modify: `tests/ops-board-ui-behavior.test.ts`

- [ ] **Step 1: Write failing item-prefill and server-validation tests**

Add to `tests/fresh-drops-api.test.ts`:

```ts
test("only an unlocked hunter can associate a report with a reportable Fresh Drop", async () => {
  const { app, unlockedHunterHeaders, reportForm } = createApiFixture();
  const guest = await app.request(`${origin}/api/v1/reports`, reportForm({ caseItemId: "case-item-wallet" }));
  assert.equal(guest.status, 401);

  const response = await app.request(`${origin}/api/v1/reports`, reportForm(
    { caseItemId: "case-item-wallet" },
    unlockedHunterHeaders,
  ));
  assert.equal(response.status, 201);
  const body = await responseJson(response);
  assert.equal(body.data.caseItemId, "case-item-wallet");
  assert.equal(body.data.caseItemTitle, "A wallet");
});
```

Add a client test proving `?item=case-item-wallet&source=fresh-drops` selects
**I found an item**, fills the hidden ID and renders a read-only **Reporting: A
wallet** context card without copying title text from the URL.

- [ ] **Step 2: Run focused tests and verify they fail**

```powershell
npx tsx --test tests/fresh-drops-api.test.ts tests/report-workflow.test.ts
```

Expected: FAIL because report association is not implemented.

- [ ] **Step 3: Add reportable item lookup**

Implement `getReportableFreshDrop(id)` in `D1DataStore`:

```ts
async getReportableFreshDrop(itemId: string) {
  const row = await this.db.prepare(
    `SELECT id, title FROM case_items
     WHERE id = ? AND collection = 'fresh_drops' AND reportable = 1
       AND status IN ('out_there', 'found', 'paused') LIMIT 1`
  ).bind(itemId).first<Row>();
  return row ? { id: value(row.id), title: value(row.title) } : null;
}
```

- [ ] **Step 4: Validate and snapshot the item in report creation**

In the report route, accept only a stable optional `caseItemId`. When present:

1. require an authenticated hunter;
2. require `participationUnlocked`;
3. load `getReportableFreshDrop`;
4. return `422 case_item_invalid` if it is not active/reportable; and
5. pass both the stable ID and authoritative title to `createReport`.

Extend the report insert with `case_item_id` and
`case_item_title_snapshot`. Extend `privateReportFromRow`, Ops list/detail and
hunter-safe report history with `caseItemId` and `caseItemTitle`; never join to
the current title when rendering an old report.

- [ ] **Step 5: Add signed-in report-page prefill**

Add to `report.html`:

```html
<aside class="selected-case-item" data-report-case-item hidden>
  <p class="field-label">Fresh Drops item</p>
  <p><strong data-report-case-item-title></strong></p>
  <button type="button" data-report-case-item-clear>Report something else</button>
</aside>
<input type="hidden" name="caseItemId" value="" />
```

After `signedInReportToken()` succeeds, read only the stable `item` query
parameter, fetch `/api/v1/me/fresh-drops`, find the matching record, render its
server-provided title, select the `found` intake choice and set the hidden ID.
If authentication or lookup fails, clear the ID and leave the ordinary four
choices fully usable.

Add `caseItemId` to `ReportDraft`, `reportPayload`, `FormData` and receipt reset.

- [ ] **Step 6: Show the selected item clearly in Ops**

Add `caseItemId` and `caseItemTitle` to `OpsReportDetail` normalization. Insert
this fact before Waypoint:

```ts
`<div><dt>Reported item</dt><dd>${escapeOpsHtml(detail.caseItemTitle ?? "Not specified")}</dd></div>`
```

Do not expose it on public Case Notes or Latest News automatically.

- [ ] **Step 7: Run report and Ops regressions**

```powershell
npx tsx --test tests/fresh-drops-api.test.ts tests/report-workflow.test.ts tests/ops-board-ui-behavior.test.ts
npx tsx --test --test-name-pattern "reportable Fresh Drop|private reports" tests/api-store-integration.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit report association**

```powershell
git add report.html src/client/report.ts src/server/app.ts src/server/d1-store.ts src/client/ops.ts tests/fresh-drops-api.test.ts tests/report-workflow.test.ts tests/ops-board-ui-behavior.test.ts
git commit -m "feat: connect Fresh Drops to private reports"
```

---

### Task 8: Build the guarded idempotent media importer

**Files:**
- Create: `scripts/import-fresh-drops.mjs`
- Modify: `tests/fresh-drops-manifest.test.mjs`
- Modify: `.env.example`

- [ ] **Step 1: Write failing importer guard tests**

Add tests that inject fake `fetch`, `readFile` and hashing dependencies and
prove:

- production origin is rejected without both `--allow-production` and
  `TIM_LOST_PRODUCTION_IMPORT=APPROVED`;
- validation runtime must report `deploymentEnvironment: "validation"`;
- an existing upload with the same SHA-256 is not uploaded again;
- existing camera and Apple Watch records are patched, not created;
- an item remains Draft until every selected derivative reports Ready; and
- a rerun produces zero new records and zero new uploads.

- [ ] **Step 2: Run importer tests and verify they fail**

```powershell
node --test tests/fresh-drops-manifest.test.mjs
```

Expected: FAIL because the importer module is missing.

- [ ] **Step 3: Implement the importer as a dependency-injected module and CLI**

The script must:

1. require `--origin`, `--source` and `FRESH_DROPS_OPS_TOKEN`;
2. call `/api/v1/config` and verify the expected deployment environment;
3. call `/api/v1/ops/items` with `Authorization: Bearer` and same-origin
   `Origin` headers;
4. match items by stable ID first and slug second;
5. create only missing Draft records;
6. SHA-256 each source file and skip hashes already returned by Ops;
7. upload missing files to the item's existing media endpoint;
8. poll the Ops item record until every upload is Ready or a bounded timeout
   reports the exact item/source that failed;
9. PATCH the exact version with media selections, media audience, final copy,
   collection placement and `status: "out_there"`; and
10. print IDs, slugs, source hashes and outcomes but never print the bearer
    token or private object keys.

Export `importFreshDrops(options)`. The options object has required `origin`,
`sourceDirectory` and `token` strings; optional `allowProduction` boolean and
`productionApproval` string; and injectable `fetchImpl`, `sleep`, `readFile`
and `sha256` functions. The function returns a summary containing ordered
`created`, `patched`, `uploaded`, `skipped` and `failed` arrays. Throw before
the first mutating request when environment validation fails. On a media
timeout, leave that item Draft, append its stable item/source identifiers to
`failed`, finish no later items, and throw an error containing the same safe
identifiers. The CLI parses flags into this function and sets a non-zero exit
code for any thrown error.

The CLI invocation is:

```powershell
$env:FRESH_DROPS_OPS_TOKEN = '<one-time local Clerk staff session token>'
node scripts/import-fresh-drops.mjs `
  --origin https://codex-validation.seba-treasure-hunt.pages.dev `
  --source .\source-media\fresh-drops-2026-07-31
Remove-Item Env:FRESH_DROPS_OPS_TOKEN
```

The token stays only in the process environment and must not be written to a
file, command output, status document or Git.

- [ ] **Step 4: Document the local environment variable without a value**

Add to `.env.example`:

```dotenv
# One-time local staff session token used only by scripts/import-fresh-drops.mjs.
# Never commit a value; remove it from the process environment after import.
FRESH_DROPS_OPS_TOKEN=
```

- [ ] **Step 5: Run importer unit tests**

```powershell
node --test tests/fresh-drops-manifest.test.mjs
```

Expected: all reconciliation and importer tests PASS without network calls.

- [ ] **Step 6: Commit the importer**

```powershell
git add scripts/import-fresh-drops.mjs scripts/fresh-drops-manifest.mjs tests/fresh-drops-manifest.test.mjs .env.example
git commit -m "feat: add guarded Fresh Drops importer"
```

---

### Task 9: Close privacy, build and accessibility gaps

**Files:**
- Modify: `scripts/build.mjs:22-58`
- Modify: `tests/public-output-privacy-scan.test.mjs`
- Modify: `tests/build-isolation.test.mjs`
- Modify: `tests/fresh-drops-ui.test.mjs`
- Modify: `tests/campaign-shell-accessibility.test.mjs`

- [ ] **Step 1: Add failing output-privacy contracts**

Assert that the built output contains none of:

```js
[
  "IMG_5645", "IMG_5647", "image000001", "IMG_5630", "IMG_5610",
  "source-media", "fresh-drops-2026-07-31", "D:\\Users\\",
  "private_object_key", "source_sha256",
]
```

Allow public text and API paths but reject a static path matching any of the 21
source filenames. Add a test that `dist/assets` contains no new source JPEG.

- [ ] **Step 2: Run privacy tests and verify the new contract catches leaks**

```powershell
npm run build
node --test tests/public-output-privacy-scan.test.mjs tests/build-isolation.test.mjs
```

Expected: tests fail if source filenames or local paths are present; otherwise
they may already pass, proving no static leak was introduced.

- [ ] **Step 3: Register only required public build assets**

Add `fresh-drops.css` to the normal static CSS directory through existing
`staticDirectories`; do not add `source-media` or any image source directory to
`scripts/build.mjs`. Because `fresh-drops.ts` is imported by `dashboard.ts`, do
not add a second entry bundle.

- [ ] **Step 4: Add accessibility contracts**

Verify:

- teaser and gallery have unique accessible headings;
- story precedes reportable items in DOM order;
- every image has non-empty alt text;
- a processed derivative contains no EXIF, XMP, IPTC, GPS or source filename
  metadata when inspected with Sharp's `metadata()` and a byte-string scan;
- no item response or rendered card contains latitude, longitude or an inferred
  place from the source batch;
- unavailable images retain text content;
- the viewer has close, previous and next controls;
- **I found this** links include the item title in accessible context;
- mobile cards remain one column at 320px; and
- reduced-motion rules are present.

- [ ] **Step 5: Run the complete local release gate**

```powershell
npm run legal:verify
npm run typecheck
npm test
npm run build
node scripts/qa-output-privacy.mjs dist
git diff --check
```

Expected: zero failures, no privacy findings and no whitespace errors.

- [ ] **Step 6: Commit release-gate coverage**

```powershell
git add scripts/build.mjs tests/public-output-privacy-scan.test.mjs tests/build-isolation.test.mjs tests/fresh-drops-ui.test.mjs tests/campaign-shell-accessibility.test.mjs
git commit -m "test: close Fresh Drops release gates"
```

---

### Task 10: Deploy and populate isolated validation

**Files:**
- Create: `docs/operations/2026-07-31-fresh-drops-validation.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Capture clean source and production read-only baselines**

Run:

```powershell
git status --short
git rev-parse HEAD
npx wrangler d1 execute tim-lost-hunter-platform --remote --command "SELECT 'players' AS kind, COUNT(*) AS count FROM player_accounts UNION ALL SELECT 'reports', COUNT(*) FROM private_reports UNION ALL SELECT 'items', COUNT(*) FROM case_items UNION ALL SELECT 'item_media', COUNT(*) FROM case_item_media;"
```

Expected: clean worktree; source commit recorded; production query is read-only.
Save counts in the validation operations document, not personal record content.

- [ ] **Step 2: Apply migration only to validation**

```powershell
npx wrangler d1 migrations apply tim-lost-hunter-platform-validation --remote
```

Expected: migration `0017_fresh_drops_hunter_gallery.sql` applies successfully.
Do not run a production migration.

- [ ] **Step 3: Deploy the validation media worker and Pages candidate**

```powershell
npm run build
npx wrangler deploy --config wrangler.media.toml --env validation
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch codex-validation
```

Expected: validation media worker and an immutable Pages deployment URL. The
stable validation hostname reports runtime `validation`.

- [ ] **Step 4: Obtain a one-time validation staff token and run the importer**

Use the validation Ops account in the browser, obtain one active session token
through the existing Clerk developer workflow, place it only in the current
PowerShell process, run the validation importer from Task 8, then remove the
environment variable immediately.

Expected importer summary:

- 16 manifest records reconciled;
- 20 JPEGs uploaded or matched;
- one source (`02-IMG_5646.jpg`) deliberately omitted;
- camera and Apple Watch updated rather than duplicated;
- camera and toy car public teaser media ready;
- all remaining selected media hunter-only; and
- every manifest record Out there after media readiness.

- [ ] **Step 5: Run unauthenticated privacy checks**

Verify with HTTP requests:

```powershell
$origin = 'https://codex-validation.seba-treasure-hunt.pages.dev'
Invoke-WebRequest "$origin/api/v1/items" -UseBasicParsing | Select-Object StatusCode,Content
Invoke-WebRequest "$origin/api/v1/me/fresh-drops" -UseBasicParsing -SkipHttpErrorCheck | Select-Object StatusCode,Content
Invoke-WebRequest "$origin/api/v1/me/fresh-drops/media/not-a-real-id" -UseBasicParsing -SkipHttpErrorCheck | Select-Object StatusCode
```

Expected: public response contains no wallet, mystery-item or hunter-media IDs;
both hunter endpoints return 401 to the guest.

- [ ] **Step 6: Run authenticated browser validation**

Using disposable validation accounts and records, verify:

1. public homepage shows only the camera and toy-car teaser;
2. sign-up/legal/verification returns to `#fresh-drops`;
3. an unlocked hunter sees the forest sequence and complete ordered gallery;
4. every full image opens and closes by mouse, keyboard and touch;
5. **I found this** preselects the authoritative item;
6. the submitted private report shows the item snapshot in Ops;
7. no item or image publishes automatically;
8. Ops can change and reverse audience/status with audit events;
9. the 13-place checklist and exact directions are unchanged; and
10. 1440px, 390px and 320px layouts have no horizontal overflow or console errors.

- [ ] **Step 7: Re-read production counts and confirm zero mutation**

Repeat the exact read-only production count query from Step 1. Expected: any
count change must be explained by concurrent real use; deployment/import steps
must show no production write, migration, R2 object, queue message, Clerk
change, Pages deployment or DNS change.

- [ ] **Step 8: Write the immutable validation record**

Document:

- exact Git commit;
- immutable and stable validation URLs;
- migration and media-worker deployment identifiers;
- importer reconciliation counts and omitted source;
- automated test totals;
- desktop/mobile/browser results;
- production before/after counts;
- known warnings; and
- explicit statement that production is unchanged.

Update `STATUS.md` with a dated Fresh Drops validation checkpoint and the next
owner action.

- [ ] **Step 9: Commit validation evidence**

```powershell
git add docs/operations/2026-07-31-fresh-drops-validation.md STATUS.md
git commit -m "docs: record Fresh Drops validation candidate"
```

Stop and ask the owner to approve the immutable candidate. Do not begin Task 11
without that explicit production approval.

---

### Task 11: Promote the exact approved candidate to production

**Files:**
- Modify after successful release: `docs/operations/2026-07-31-fresh-drops-validation.md`
- Modify after successful release: `STATUS.md`

- [ ] **Step 1: Confirm the production approval and exact source commit**

Record the approval in the active task and verify:

```powershell
git status --short
git rev-parse HEAD
```

Expected: clean worktree and the same tested source commit documented in the
validation record.

- [ ] **Step 2: Export the production D1 rollback backup**

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
npx wrangler d1 export tim-lost-hunter-platform --remote --output "backups\tim-lost-before-fresh-drops-$stamp.sql"
```

Expected: non-empty local backup outside Git with a recorded SHA-256.

- [ ] **Step 3: Apply migration `0017` to production**

```powershell
npx wrangler d1 migrations apply tim-lost-hunter-platform --remote
```

Expected: only migration `0017` applies. Newly seeded records remain Draft, so
the old live application cannot expose them.

- [ ] **Step 4: Promote the exact tested Pages and media-worker artifacts**

Rebuild from the exact tested commit and verify artifact hashes match the
validation record before deployment:

```powershell
npm run build
npx wrangler deploy --config wrangler.media.toml
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch production
```

Expected: production URLs and worker identify runtime `production`; no content
record is changed by the code deployment itself.

- [ ] **Step 5: Run the guarded production importer**

Only after the new audience-aware production code is live, obtain a one-time
production staff token and run:

```powershell
$env:FRESH_DROPS_OPS_TOKEN = '<one-time local Clerk staff session token>'
$env:TIM_LOST_PRODUCTION_IMPORT = 'APPROVED'
node scripts/import-fresh-drops.mjs `
  --origin https://www.timlostsomething.com `
  --source .\source-media\fresh-drops-2026-07-31 `
  --allow-production
Remove-Item Env:FRESH_DROPS_OPS_TOKEN
Remove-Item Env:TIM_LOST_PRODUCTION_IMPORT
```

Expected: the same manifest reconciliation as validation, with no duplicate
item or hash.

- [ ] **Step 6: Run production smoke and privacy verification**

Verify the public teaser, guest API exclusions, hunter gallery, one read-only
Ops item view, one report prefill without submitting, mobile layout, console,
canonical host and production counts. Do not create a public post or test
submission.

- [ ] **Step 7: Tag and document the rollback point**

Create an annotated release tag naming Fresh Drops, record the previous Pages
deployment and worker version, add the production verification to the
operations document and update `STATUS.md`.

- [ ] **Step 8: Commit release documentation**

```powershell
git add docs/operations/2026-07-31-fresh-drops-validation.md STATUS.md
git commit -m "docs: record Fresh Drops production release"
```

If authorization, privacy, migration, media, data-count or artifact checks fail
at any point, stop. Do not weaken a gate, expose a hunter-only object, reseed
production broadly or continue with a partially understood state.
