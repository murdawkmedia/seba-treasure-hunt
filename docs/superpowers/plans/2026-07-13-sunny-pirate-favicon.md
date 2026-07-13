# Sunny Pirate Mystery Chest Favicon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the money-bag emoji favicon with the approved Sunny Pirate Mystery Chest mark across every site page and publish it only to the `codex-validation` Cloudflare Pages preview.

**Architecture:** Keep one deterministic, dependency-free SVG as the canonical artwork. Use a small Sharp-based generator to derive PNG sizes and a standards-compliant multi-image ICO, then reference the shared assets from every HTML page. Contract tests cover source semantics, dimensions, HTML integration and build output before the branch is pushed and `dist/` is deployed to the validation branch.

**Tech Stack:** Static HTML, SVG, Node.js, Sharp, Node test runner, esbuild, Cloudflare Pages/Wrangler.

---

## File Structure

- Create `assets/favicon.svg`: canonical square-viewBox vector artwork.
- Create `assets/favicon-32x32.png`: generated browser PNG fallback.
- Create `assets/apple-touch-icon.png`: generated 180×180 touch icon.
- Create `assets/favicon-192x192.png`: generated installable-site icon.
- Create `assets/favicon-512x512.png`: generated high-resolution icon.
- Create `favicon.ico`: generated 16/32/48-pixel ICO container.
- Create `site.webmanifest`: minimal icon and theme metadata with `display: "browser"`.
- Create `scripts/generate-favicons.mjs`: deterministic raster and ICO generator.
- Create `tests/favicon-assets.test.mjs`: favicon source, output, integration and build-copy contracts.
- Modify `package.json`: add the reproducible `assets:favicons` command.
- Modify `scripts/build.mjs`: allowlist the root ICO and manifest.
- Modify all twelve root HTML pages: use the shared favicon, touch icon and manifest references.
- Modify `README.md` and `STATUS.md`: record the favicon architecture, verification and validation-only deployment.

### Task 1: Add Failing Favicon Contracts

**Files:**
- Create: `tests/favicon-assets.test.mjs`

- [ ] **Step 1: Write the source and integration tests**

Create a Node test that checks the approved semantic parts, generated dimensions, ICO directory, HTML references and build allowlist:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPages = [
  "index.html", "route.html", "interview.html", "start.html",
  "dashboard.html", "updates.html", "report.html", "rules.html",
  "privacy.html", "community-guidelines.html", "clue-board.html", "ops.html",
];

test("favicon SVG contains the approved independent symbols", () => {
  const svg = fs.readFileSync(path.join(repo, "assets", "favicon.svg"), "utf8");
  assert.match(svg, /viewBox="0 0 190 190"/);
  for (const part of ["pirate-sun", "eyepatch", "question-mark-left", "question-mark-right", "treasure-chest"]) {
    assert.match(svg, new RegExp(`data-part="${part}"`));
  }
  assert.doesNotMatch(svg, /<text|<script|https?:\/\//);
});

test("generated PNG and ICO assets have the required dimensions", async () => {
  for (const [file, width] of [
    ["assets/favicon-32x32.png", 32],
    ["assets/apple-touch-icon.png", 180],
    ["assets/favicon-192x192.png", 192],
    ["assets/favicon-512x512.png", 512],
  ]) {
    const metadata = await sharp(path.join(repo, file)).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, width);
    assert.equal(metadata.format, "png");
  }

  const ico = fs.readFileSync(path.join(repo, "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const sizes = [0, 1, 2].map((index) => ico[6 + index * 16] || 256);
  assert.deepEqual(sizes, [16, 32, 48]);
});

test("every HTML page references the shared favicon set", () => {
  for (const page of htmlPages) {
    const html = fs.readFileSync(path.join(repo, page), "utf8");
    assert.match(html, /href="\/favicon\.ico"/);
    assert.match(html, /href="\/assets\/favicon\.svg"/);
    assert.match(html, /href="\/assets\/favicon-32x32\.png"/);
    assert.match(html, /href="\/assets\/apple-touch-icon\.png"/);
    assert.match(html, /href="\/site\.webmanifest"/);
    assert.doesNotMatch(html, /data:image\/svg\+xml[^\n]+%F0%9F%92%B0/i);
  }
});

test("the build allowlist publishes the root favicon files", () => {
  const script = fs.readFileSync(path.join(repo, "scripts", "build.mjs"), "utf8");
  assert.match(script, /"favicon\.ico"/);
  assert.match(script, /"site\.webmanifest"/);
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```powershell
node --test tests/favicon-assets.test.mjs
```

Expected: failures for missing `assets/favicon.svg`, generated assets and shared page references.

- [ ] **Step 3: Commit the failing contract**

```powershell
git add tests/favicon-assets.test.mjs docs/superpowers/plans/2026-07-13-sunny-pirate-favicon.md
git commit -m "test: define favicon asset contracts"
```

### Task 2: Create the Canonical Artwork and Asset Generator

**Files:**
- Create: `assets/favicon.svg`
- Create: `scripts/generate-favicons.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the approved SVG source**

Use a `viewBox="0 0 190 190"` with a five-unit horizontal translation around the approved 180×190 mark. Add stable `data-part` attributes to the pirate sun, oval eyepatch, left and right 22-degree question marks and treasure chest. Keep transparent corners, flat fills, rounded strokes and no external resources.

The critical structure is:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 190">
  <defs>
    <linearGradient id="chest" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#f8c64b"/>
      <stop offset="1" stop-color="#ae5d1d"/>
    </linearGradient>
  </defs>
  <g transform="translate(5 0)">
    <path data-part="shield" d="M90 5c20 0 41 6 70 19 8 4 13 11 13 21v56c0 37-30 66-83 84-53-18-83-47-83-84V45c0-10 5-17 13-21C49 11 70 5 90 5Z" fill="#fff1d2" stroke="#123b30" stroke-width="7"/>
    <path d="M90 15c18 0 37 5 63 17 6 3 9 7 9 14v53c0 31-25 56-72 73-47-17-72-42-72-73V46c0-7 3-11 9-14 26-12 45-17 63-17Z" fill="#174637" stroke="#e7a72a" stroke-width="4"/>
    <g data-part="pirate-sun">
      <circle cx="90" cy="55" r="25" fill="#f2ad25" stroke="#9a561c" stroke-width="4"/>
      <path data-part="pirate-hat" d="M61 38c8-15 19-22 33-22 15 0 27 7 35 22-22-5-45-5-68 0Z" fill="#102a22"/>
      <path d="M64 39c17-5 35-5 53 0" fill="none" stroke="#fff1d2" stroke-width="4" stroke-linecap="round"/>
      <circle cx="75" cy="55" r="4.5" fill="#102a22"/>
      <path d="M78 42c10 1 20 5 29 11" fill="none" stroke="#102a22" stroke-width="4.5" stroke-linecap="round"/>
      <ellipse data-part="eyepatch" cx="105" cy="56" rx="8" ry="6.5" fill="#102a22"/>
      <path d="M72 70c10 8 21 8 33 0" fill="none" stroke="#102a22" stroke-width="5" stroke-linecap="round"/>
    </g>
    <g data-part="question-mark-left" transform="translate(40 87) rotate(-22)">
      <path d="M-17-10c1-11 9-18 20-18 12 0 20 7 20 17 0 8-5 13-12 17-7 4-9 8-9 15" fill="none" stroke="#0a291f" stroke-width="11" stroke-linecap="round" opacity=".7"/>
      <path d="M-17-12c1-11 9-18 20-18 12 0 20 7 20 17 0 8-5 13-12 17-7 4-9 8-9 15" fill="none" stroke="#fff1d2" stroke-width="7" stroke-linecap="round"/>
      <circle cx="2" cy="32" r="5" fill="#fff1d2" stroke="#0a291f" stroke-width="2"/>
    </g>
    <g data-part="question-mark-right" transform="translate(140 87) rotate(22)">
      <path d="M-17-10c1-11 9-18 20-18 12 0 20 7 20 17 0 8-5 13-12 17-7 4-9 8-9 15" fill="none" stroke="#0a291f" stroke-width="11" stroke-linecap="round" opacity=".7"/>
      <path d="M-17-12c1-11 9-18 20-18 12 0 20 7 20 17 0 8-5 13-12 17-7 4-9 8-9 15" fill="none" stroke="#fff1d2" stroke-width="7" stroke-linecap="round"/>
      <circle cx="2" cy="32" r="5" fill="#fff1d2" stroke="#0a291f" stroke-width="2"/>
    </g>
    <g data-part="treasure-chest">
      <path d="M43 143h94l-9 31H52l-9-31Z" fill="url(#chest)" stroke="#102a22" stroke-width="6" stroke-linejoin="round"/>
      <path d="M49 140c3-18 18-28 41-28s38 10 41 28H49Z" fill="#d88622" stroke="#102a22" stroke-width="6" stroke-linejoin="round"/>
      <path d="M52 140h76" stroke="#ffd667" stroke-width="6"/>
      <path d="M62 146v25M118 146v25" stroke="#714018" stroke-width="5" opacity=".75"/>
      <rect x="80" y="141" width="21" height="23" rx="4" fill="#f8c945" stroke="#102a22" stroke-width="5"/>
      <circle cx="90.5" cy="151" r="3" fill="#102a22"/>
    </g>
  </g>
</svg>
```

- [ ] **Step 2: Add the deterministic generator**

Implement `scripts/generate-favicons.mjs` with Sharp. Render transparent PNGs at 32, 180, 192 and 512 pixels. Render separate 16, 32 and 48-pixel PNG buffers, then write an ICO header, three 16-byte directory entries and the PNG payloads:

```js
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "assets", "favicon.svg"));

for (const [relativePath, size] of [
  ["assets/favicon-32x32.png", 32],
  ["assets/apple-touch-icon.png", 180],
  ["assets/favicon-192x192.png", 192],
  ["assets/favicon-512x512.png", 512],
]) {
  await sharp(source, { density: 512 }).resize(size, size).png().toFile(path.join(root, relativePath));
}

const icoSizes = [16, 32, 48];
const images = await Promise.all(icoSizes.map((size) =>
  sharp(source, { density: 512 }).resize(size, size).png().toBuffer()
));
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (let index = 0; index < images.length; index += 1) {
  const entry = 6 + index * 16;
  header[entry] = icoSizes[index];
  header[entry + 1] = icoSizes[index];
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(path.join(root, "favicon.ico"), Buffer.concat([header, ...images]));
```

- [ ] **Step 3: Add and run the asset command**

Add to `package.json`:

```json
"assets:favicons": "node scripts/generate-favicons.mjs"
```

Run:

```powershell
npm run assets:favicons
```

Expected: five generated files with no generator error.

- [ ] **Step 4: Run the asset portion of the contract**

Run:

```powershell
node --test tests/favicon-assets.test.mjs
```

Expected: artwork and dimension tests pass; HTML/build integration tests remain red.

- [ ] **Step 5: Commit the artwork pipeline**

```powershell
git add assets/favicon.svg assets/favicon-32x32.png assets/apple-touch-icon.png assets/favicon-192x192.png assets/favicon-512x512.png favicon.ico scripts/generate-favicons.mjs package.json
git commit -m "feat: add sunny pirate favicon assets"
```

### Task 3: Integrate the Favicon Across the Site

**Files:**
- Create: `site.webmanifest`
- Modify: `index.html`
- Modify: `route.html`
- Modify: `interview.html`
- Modify: `start.html`
- Modify: `dashboard.html`
- Modify: `updates.html`
- Modify: `report.html`
- Modify: `rules.html`
- Modify: `privacy.html`
- Modify: `community-guidelines.html`
- Modify: `clue-board.html`
- Modify: `ops.html`
- Modify: `scripts/build.mjs`

- [ ] **Step 1: Add the minimal manifest**

Create `site.webmanifest`:

```json
{
  "name": "Tim Lost Something?",
  "short_name": "Tim Lost?",
  "icons": [
    { "src": "/assets/favicon-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/favicon-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#174637",
  "background_color": "#fff1d2",
  "display": "browser"
}
```

- [ ] **Step 2: Add the shared head references to every page**

Place this block after each `<title>` and remove the existing money-bag data-URI favicon lines:

```html
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/favicon-32x32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
```

- [ ] **Step 3: Allowlist the root files in the production build**

Add these entries to `staticFiles` in `scripts/build.mjs`:

```js
"favicon.ico",
"site.webmanifest",
```

- [ ] **Step 4: Run the favicon contract and confirm GREEN**

Run:

```powershell
node --test tests/favicon-assets.test.mjs
```

Expected: 4/4 tests pass.

- [ ] **Step 5: Commit site integration**

```powershell
git add site.webmanifest scripts/build.mjs *.html tests/favicon-assets.test.mjs
git commit -m "feat: use sunny pirate favicon sitewide"
```

### Task 4: Verify, Document and Package the Release

**Files:**
- Modify: `README.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Run the complete automated verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all tests pass, all TypeScript projects pass, `dist/` builds, and no whitespace errors are reported.

- [ ] **Step 2: Verify built artifacts**

Run:

```powershell
node --test tests/favicon-assets.test.mjs
Get-Item dist/favicon.ico, dist/site.webmanifest, dist/assets/favicon.svg, dist/assets/favicon-32x32.png, dist/assets/apple-touch-icon.png
```

Expected: every listed artifact exists and the favicon contract remains green.

- [ ] **Step 3: Inspect small-size rendering**

Create a temporary local contact sheet from the canonical SVG at 16, 32, 64 and 180 pixels, inspect it visually, and delete the temporary contact sheet before committing. Confirm transparent corners, two complete question marks and an unmistakable oval eyepatch.

- [ ] **Step 4: Update handoff documentation**

Record in `README.md` that `assets/favicon.svg` is canonical and `npm run assets:favicons` regenerates derived assets. Update `STATUS.md` with the exact test count, successful build, commit state and the fact that the deployment target is the noindex `codex-validation` preview only.

- [ ] **Step 5: Commit the verified release documentation**

```powershell
git add README.md STATUS.md
git commit -m "docs: record favicon validation release"
```

### Task 5: Push and Deploy Only to Validation

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the public-release privacy check**

Scan the staged diff and generated output for local paths, credentials, private admin addresses, private coordinates and unapproved evidence. Expected: no newly introduced private data.

- [ ] **Step 2: Confirm repository and target state**

Run:

```powershell
git status --short
git branch --show-current
git log -3 --oneline
```

Expected: clean branch `codex/tim-lost-hunter-platform` with the favicon commits at its tip.

- [ ] **Step 3: Push the feature branch**

Run:

```powershell
git push -u origin codex/tim-lost-hunter-platform
```

Expected: the branch is available on `murdawkmedia/seba-treasure-hunt`; do not merge or update `main`.

- [ ] **Step 4: Deploy the built output to the validation branch**

Run:

```powershell
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch codex-validation
```

Expected: Wrangler returns a successful preview deployment. Do not apply remote D1 migrations, alter Pages production aliases, or deploy the media Worker.

- [ ] **Step 5: Verify the validation URL**

Check `https://codex-validation.seba-treasure-hunt.pages.dev/` and at least one secondary page. Confirm:

- HTTP 200;
- `X-Robots-Tag: noindex, nofollow` or equivalent preview noindex behaviour;
- favicon links resolve with HTTP 200;
- the browser displays the Sunny Pirate Mystery Chest favicon; and
- `www.timlostsomething.com` remains untouched.

- [ ] **Step 6: Record the exact validation deployment URL**

If Wrangler returns a unique deployment URL in addition to the branch alias, add both URLs and the deployment time to `STATUS.md`, commit the documentation update, and push the same feature branch again. Do not redeploy solely for that documentation-only commit.
