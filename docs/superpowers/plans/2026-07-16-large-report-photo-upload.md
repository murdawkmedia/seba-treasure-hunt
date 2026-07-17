# Large Report Photo Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept report photos through 20 MB directly and optimize supported 20–50 MB source photos in the browser before private upload.

**Architecture:** Centralize decimal byte limits in a shared module, isolate browser decoding/encoding in a testable report-photo preparation module, and pass prepared `File` objects into the existing report submission path. Keep R2 private storage and the media worker unchanged except for consistent 20 MB enforcement.

**Tech Stack:** TypeScript, browser Canvas/CreateImageBitmap APIs, Hono, Cloudflare Pages/Workers/R2/Images, Node test runner, esbuild.

---

### Task 1: Shared decimal upload contract

**Files:**
- Create: `src/shared/report-image-limits.ts`
- Create: `tests/report-image-limits.test.ts`

- [ ] **Step 1: Write the failing constants test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  REPORT_IMAGE_DIRECT_BYTES,
  REPORT_IMAGE_SOURCE_BYTES,
  REPORT_IMAGE_TOTAL_BYTES,
  REPORT_IMAGE_MAX_COUNT,
  reportImageMegabytes,
} from "../src/shared/report-image-limits";

test("report image limits use decimal MB", () => {
  assert.equal(REPORT_IMAGE_DIRECT_BYTES, 20_000_000);
  assert.equal(REPORT_IMAGE_SOURCE_BYTES, 50_000_000);
  assert.equal(REPORT_IMAGE_TOTAL_BYTES, 30_000_000);
  assert.equal(REPORT_IMAGE_MAX_COUNT, 3);
  assert.equal(reportImageMegabytes(27_400_000), "27.4 MB");
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npx tsx --test tests/report-image-limits.test.ts`

Expected: FAIL because `src/shared/report-image-limits.ts` does not exist.

- [ ] **Step 3: Add the shared contract**

```ts
export const REPORT_IMAGE_DIRECT_BYTES = 20_000_000;
export const REPORT_IMAGE_SOURCE_BYTES = 50_000_000;
export const REPORT_IMAGE_TOTAL_BYTES = 30_000_000;
export const REPORT_IMAGE_MAX_COUNT = 3;
export const REPORT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const reportImageMegabytes = (bytes: number) =>
  `${(Math.max(0, bytes) / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
```

- [ ] **Step 4: Run the focused test**

Run: `npx tsx --test tests/report-image-limits.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```powershell
git add src/shared/report-image-limits.ts tests/report-image-limits.test.ts
git commit -m "feat: define decimal report image limits"
```

### Task 2: Sequential browser image preparation

**Files:**
- Create: `src/client/report-image-preparation.ts`
- Create: `tests/report-image-preparation.test.ts`

- [ ] **Step 1: Write failing tests for direct, optimized, sequential and rejected files**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareReportImages,
  ReportImagePreparationError,
} from "../src/client/report-image-preparation";

const jpeg = (size: number, name = "photo.jpg") =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg" });

test("keeps files at 20 MB direct and optimizes larger files sequentially", async () => {
  const calls: string[] = [];
  let active = 0;
  const result = await prepareReportImages(
    [jpeg(20_000_000, "direct.jpg"), jpeg(21_000_000, "large-a.jpg"), jpeg(22_000_000, "large-b.jpg")],
    {
      optimize: async (file) => {
        active += 1;
        assert.equal(active, 1);
        calls.push(file.name);
        active -= 1;
        return jpeg(2_000_000, file.name.replace(".jpg", ".webp"));
      },
    },
  );
  assert.equal(result[0]?.optimized, false);
  assert.deepEqual(calls, ["large-a.jpg", "large-b.jpg"]);
});

test("rejects unsupported, over-50 MB and over-30 MB prepared selections", async () => {
  await assert.rejects(
    prepareReportImages([new File(["x"], "photo.heic", { type: "image/heic" })]),
    (error: ReportImagePreparationError) => error.code === "unsupported_type",
  );
  await assert.rejects(
    prepareReportImages([jpeg(50_000_001)]),
    (error: ReportImagePreparationError) => error.code === "source_too_large",
  );
  await assert.rejects(
    prepareReportImages([jpeg(16_000_000, "a.jpg"), jpeg(16_000_000, "b.jpg")]),
    (error: ReportImagePreparationError) => error.code === "combined_too_large",
  );
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `npx tsx --test tests/report-image-preparation.test.ts`

Expected: FAIL because the preparation module does not exist.

- [ ] **Step 3: Implement selection validation and sequential preparation**

```ts
import {
  REPORT_IMAGE_DIRECT_BYTES,
  REPORT_IMAGE_MAX_COUNT,
  REPORT_IMAGE_SOURCE_BYTES,
  REPORT_IMAGE_TOTAL_BYTES,
  REPORT_IMAGE_TYPES,
} from "../shared/report-image-limits";

export class ReportImagePreparationError extends Error {
  constructor(public readonly code: string, public readonly fileName: string, message: string) {
    super(message);
  }
}

export interface PreparedReportImage {
  source: File;
  upload: File;
  optimized: boolean;
}

export async function prepareReportImages(
  files: readonly File[],
  options: { optimize?: (file: File, signal?: AbortSignal) => Promise<File>; signal?: AbortSignal } = {},
): Promise<PreparedReportImage[]> {
  if (files.length > REPORT_IMAGE_MAX_COUNT) {
    throw new ReportImagePreparationError("too_many", "", "Choose no more than three images.");
  }
  const prepared: PreparedReportImage[] = [];
  let total = 0;
  for (const source of files) {
    if (!REPORT_IMAGE_TYPES.has(source.type)) {
      throw new ReportImagePreparationError("unsupported_type", source.name, `${source.name} must be JPEG, PNG, or WebP. HEIC is not supported yet.`);
    }
    if (source.size > REPORT_IMAGE_SOURCE_BYTES) {
      throw new ReportImagePreparationError("source_too_large", source.name, `${source.name} is larger than 50 MB.`);
    }
    const optimized = source.size > REPORT_IMAGE_DIRECT_BYTES;
    const upload = optimized
      ? await (options.optimize ?? optimizeReportImage)(source, options.signal)
      : source;
    if (upload.size > REPORT_IMAGE_DIRECT_BYTES) {
      throw new ReportImagePreparationError("optimization_too_large", source.name, `${source.name} could not be prepared below 20 MB.`);
    }
    total += upload.size;
    if (total > REPORT_IMAGE_TOTAL_BYTES) {
      throw new ReportImagePreparationError("combined_too_large", source.name, "The prepared photos total more than 30 MB.");
    }
    prepared.push({ source, upload, optimized });
  }
  return prepared;
}
```

- [ ] **Step 4: Add tests for encoder retries, abort and resource release**

Test the exported optimizer through injected bitmap/canvas adapters so Node never requires a real DOM. Assert the attempts use 2560, 2048 and 1600 maximum edges with bounded quality values; abort stops the next attempt; and every bitmap is closed in `finally`.

- [ ] **Step 5: Implement the browser optimizer**

Use `createImageBitmap(file, { imageOrientation: "from-image" })`, an `OffscreenCanvas` when available and an HTML canvas fallback. Encode WebP at bounded attempts `{ edge: 2560, quality: .82 }`, `{ edge: 2048, quality: .76 }`, and `{ edge: 1600, quality: .72 }`. Return a new `.webp` `File`, close the bitmap and clear canvas dimensions in `finally`, and throw `ReportImagePreparationError("decode_failed", ...)` or `("optimization_failed", ...)` with filename-specific copy.

- [ ] **Step 6: Run the focused tests**

Run: `npx tsx --test tests/report-image-preparation.test.ts`

Expected: PASS with direct, optimized, retry, abort and failure cases.

- [ ] **Step 7: Commit browser preparation**

```powershell
git add src/client/report-image-preparation.ts tests/report-image-preparation.test.ts
git commit -m "feat: optimize large report photos in browser"
```

### Task 3: Integrate preparation with the report form

**Files:**
- Modify: `report.html:132-137`
- Modify: `src/client/report.ts:1-675`
- Modify: `css/style.css`
- Modify: `tests/hunter-ui-client.test.ts`
- Modify: `tests/hunter-ui-pages.test.mjs`

- [ ] **Step 1: Add failing form-contract tests**

Assert that `report.html` says “Photos up to 20 MB upload directly; larger photos up to 50 MB will be optimized on this device,” contains a polite `data-report-photo-status` list, and contains a hidden keyboard-accessible `data-report-photo-clear` button. Assert the client imports `prepareReportImages`, uses prepared files in `buildReportFormData`, and uses a 120-second abortable upload timeout.

- [ ] **Step 2: Run the page and client tests and verify expected failures**

Run: `node --test tests/hunter-ui-pages.test.mjs && npx tsx --test tests/hunter-ui-client.test.ts`

Expected: FAIL on missing preparation/status contracts.

- [ ] **Step 3: Add report form status markup**

```html
<span class="field-hint" id="report-photo-hint">Add up to three JPEG, PNG, or WebP photos. Photos up to 20 MB upload directly; larger photos up to 50 MB will be optimized on this device. Prepared uploads may total up to 30 MB.</span>
<ul class="report-photo-status" data-report-photo-status aria-live="polite" aria-relevant="additions text"></ul>
<button class="hunter-button hunter-button--quiet" type="button" data-report-photo-clear hidden>Clear selected photos</button>
```

- [ ] **Step 4: Wire preparation state into `report.ts`**

Maintain one `AbortController`, one preparation promise and one `PreparedReportImage[]`. On file input change, abort stale work, render “Checking photo…” and “Optimizing …,” call `prepareReportImages` sequentially, render the final reduced size, and enable submit only after completion. Pass prepared uploads into a revised `readDraft(form, preparedFiles)` and `buildReportFormData`. Clearing or resetting aborts work and releases the prepared array. Network failure preserves the form and prepared files for retry.

- [ ] **Step 5: Add accessible responsive styling**

Style the status list with existing system colours, visible error state, normal text wrapping, and 44-pixel Clear control. At narrow widths and 200% zoom, prevent filename overflow with `overflow-wrap: anywhere`.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/hunter-ui-pages.test.mjs && npx tsx --test tests/hunter-ui-client.test.ts tests/report-image-preparation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit form integration**

```powershell
git add report.html src/client/report.ts css/style.css tests/hunter-ui-client.test.ts tests/hunter-ui-pages.test.mjs
git commit -m "feat: integrate large photo preparation into reports"
```

### Task 4: Enforce 20 MB server and media limits

**Files:**
- Modify: `src/server/app.ts:353-422`
- Modify: `src/media-worker.ts:69-84`
- Modify: `src/client/board.ts:56,196`
- Modify: `tests/api-worker.test.ts`
- Modify: `tests/media-worker.test.ts`
- Modify: `tests/ops-board-ui-contract.test.mjs`

- [ ] **Step 1: Write failing server boundary tests**

Add API tests proving a valid 20,000,000-byte image is accepted, a 20,000,001-byte image is rejected with `invalid_image`, and files totaling 30,000,001 bytes are rejected with `images_total_too_large`. Add a media-worker test whose `Images.info()` reports exactly 20,000,000 bytes as safe and 20,000,001 as rejected.

- [ ] **Step 2: Run focused server tests and verify failures**

Run: `npx tsx --test tests/api-worker.test.ts tests/media-worker.test.ts`

Expected: FAIL because the current limit is 10 MiB and there is no combined-limit error.

- [ ] **Step 3: Apply the shared decimal limits**

Import the shared constants in `app.ts` and `media-worker.ts`. In `validateImages`, retain signature checks, reject more than three files, reject each file over `REPORT_IMAGE_DIRECT_BYTES`, and reject the sum over `REPORT_IMAGE_TOTAL_BYTES`. Use user copy containing “20 MB” and “30 MB.” Keep multipart body parsing capped at 32 MiB because 30 decimal MB plus form overhead fits safely.

- [ ] **Step 4: Replace remaining public MiB copy**

Keep Case Notes at its existing 10 MB behavior for this report-only release, but change its user-facing copy from “10 MiB” to “10 MB.” Update its static contract test accordingly.

- [ ] **Step 5: Run server and static tests**

Run: `npx tsx --test tests/api-worker.test.ts tests/media-worker.test.ts && node --test tests/ops-board-ui-contract.test.mjs tests/hunter-ui-pages.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit server enforcement**

```powershell
git add src/server/app.ts src/media-worker.ts src/client/board.ts tests/api-worker.test.ts tests/media-worker.test.ts tests/ops-board-ui-contract.test.mjs
git commit -m "feat: enforce 20 MB report image uploads"
```

### Task 5: Full verification and validation deployment

**Files:**
- Modify: `STATUS.md`
- Modify: `README.md`

- [ ] **Step 1: Run the full quality gate**

Run: `npm test`

Expected: all static and TypeScript tests pass.

Run: `npm run legal:verify && npm run typecheck && npm run build && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 2: Run browser validation locally**

Start the built Pages app, submit representative direct and optimized fixtures, throttle the network, cancel a preparation, retry a failed upload, check the confirmation reference, and inspect mobile, keyboard, 200%-zoom and console behavior.

- [ ] **Step 3: Document the operational contract**

Add the decimal limits, browser-only optimization, unsupported HEIC guidance, private-source behavior and rollback note to `README.md` and `STATUS.md`.

- [ ] **Step 4: Commit verification documentation**

```powershell
git add README.md STATUS.md
git commit -m "docs: record large report photo support"
```

- [ ] **Step 5: Deploy validation only and smoke-test**

Deploy the clean `dist` output to the `codex-validation` Pages branch. Verify production D1 baselines before and after, confirm production receives zero writes, and test `/report` plus the resulting validation Ops evidence preview. Do not promote to production without explicit approval.
