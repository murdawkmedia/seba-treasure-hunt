# Emergency Unconfirmed-Partner Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the uncontracted radio partner from every public website surface and publish a production-safe, allowlisted hotfix without promoting the unfinished validation platform.

**Architecture:** Patch the static `main` release in an isolated worktree, add a runtime-constructed deny-term regression contract, and create a dependency-free allowlist builder for `dist/`. Deploy only `dist/` to the Pages production branch; leave the already-clean validation branch deployment unchanged.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner and filesystem APIs, Cloudflare Pages/Wrangler.

---

## File Map

- Modify `tests/campaign-refresh.test.mjs`: prohibit the disputed partner term, link, logo path and partner-only classes across public source and built output.
- Modify `index.html`: remove all partner promotion and neutralize sentences that depended on it.
- Modify `route.html`: remove the partner strip and footer.
- Modify `interview.html`: remove the partner strip and footer.
- Modify `css/style.css`: remove partner-specific selectors and comments.
- Delete `assets/cfcw-logo.png`: remove the directly addressable logo.
- Create `scripts/build-public.mjs`: build only the explicit public allowlist and reject prohibited output.
- Modify `.gitignore`: exclude generated `dist/`.
- Modify `README.md`: document the allowlisted build and deployment procedure.
- Modify `STATUS.md`: record the emergency hotfix and verification evidence.

### Task 1: Add the failing public-surface regression contract

**Files:**
- Modify: `tests/campaign-refresh.test.mjs`

- [ ] **Step 1: Add runtime-constructed prohibited-term helpers**

Add these imports and constants:

```js
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prohibitedPartner = String.fromCharCode(67, 70, 67, 87);
const prohibitedPattern = new RegExp(prohibitedPartner, "i");
const publicSourceFiles = [
  "index.html",
  "route.html",
  "interview.html",
  "css/style.css",
  "js/site.js",
  "robots.txt",
  "sitemap.xml",
];
```

Keep the existing `read()` helper and imports deduplicated.

- [ ] **Step 2: Add a source-level prohibition test**

```js
test("public source contains no unconfirmed partner references", () => {
  const publicSource = publicSourceFiles.map(read).join("\n");
  assert.doesNotMatch(publicSource, prohibitedPattern);
  assert.doesNotMatch(publicSource, /official radio partner/i);
  assert.doesNotMatch(publicSource, /partner-strip|prize-cfcw|footer-cfcw/i);
  assert.ok(
    !existsSync(path.join(root, "assets", `${prohibitedPartner.toLowerCase()}-logo.png`)),
    "the removed partner logo must not remain addressable",
  );
});
```

- [ ] **Step 3: Run the test and observe the expected failure**

Run:

```powershell
node --test tests/campaign-refresh.test.mjs
```

Expected: FAIL because the current HTML, CSS and logo still contain the prohibited partner material.

- [ ] **Step 4: Commit the failing contract**

```powershell
git add tests/campaign-refresh.test.mjs
git commit -m "test: prohibit unconfirmed partner content"
```

### Task 2: Remove the public partner content

**Files:**
- Modify: `index.html`
- Modify: `route.html`
- Modify: `interview.html`
- Modify: `css/style.css`
- Delete: `assets/cfcw-logo.png`
- Test: `tests/campaign-refresh.test.mjs`

- [ ] **Step 1: Remove shared partner markup**

Delete the complete `partner-strip` blocks near the top of all three HTML pages and the complete `footer-cfcw` blocks in all three footers.

- [ ] **Step 2: Remove or neutralize home-page claims**

Apply these exact content outcomes in `index.html`:

```html
<p class="sign">— Tim's account, as told to the SebaHub team.</p>
```

```html
<p>A hunt that hops town to town across Central Alberta. (This year Tim lost his ID bundle and two rings — next year, who knows what the man'll misplace.)</p>
```

```html
<p class="section-lead">Every sponsor dollar goes straight into the prize — and puts your brand in front of hunters and the whole Seba Beach community.</p>
```

Replace the four sponsor-tier bodies with:

```html
<div class="tier"><h3>Gold</h3><div class="tier__amt">$5,000+</div><p>Logo on the site &amp; ads · featured sponsor card · social feature</p></div>
<div class="tier"><h3>Silver</h3><div class="tier__amt">$2,500</div><p>Logo on the site · social feature</p></div>
<div class="tier"><h3>Community</h3><div class="tier__amt">$1,000</div><p>Logo on the site · thank-you on campaign channels</p></div>
<div class="tier"><h3>In-Kind</h3><div class="tier__amt">Goods &amp; services</div><p>Donate goods, services, or experiences to the pot. Let's talk.</p></div>
```

Replace the FAQ update sentence with:

```html
<dd><strong>Keep the cash. Keep the rings.</strong> Return the ID to SebaHub (162 Second Avenue, Seba Beach) or by mail — that's the whole ask. If the items aren't found quickly, the reward may rise to <strong>$10,000</strong>. Any prize updates will be published on this website. Reward is as-found and non-transferable.</dd>
```

Delete the broadcast-update paragraph and the entire anchor-sponsor block rather than replacing them with another partner.

- [ ] **Step 3: Remove partner-specific styles and logo**

Delete the `partner-strip`, `partner-strip__logo`, `partner-strip__text`, `prize-cfcw` and `footer-cfcw` rules and their associated comments from `css/style.css`.

Delete the logo:

```powershell
git rm -- assets/cfcw-logo.png
```

- [ ] **Step 4: Run the contract**

Run:

```powershell
node --test tests/campaign-refresh.test.mjs
```

Expected: all campaign-refresh tests PASS.

- [ ] **Step 5: Commit the content removal**

```powershell
git add index.html route.html interview.html css/style.css assets
git commit -m "fix: remove unconfirmed partner from public site"
```

### Task 3: Add the allowlisted public build

**Files:**
- Create: `scripts/build-public.mjs`
- Modify: `.gitignore`
- Modify: `tests/campaign-refresh.test.mjs`

- [ ] **Step 1: Create the dependency-free builder**

Create `scripts/build-public.mjs`:

```js
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const allowlist = [
  "_worker.js",
  "canonical-host-worker.mjs",
  "index.html",
  "route.html",
  "interview.html",
  "robots.txt",
  "sitemap.xml",
  "assets",
  "css",
  "js",
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".xml"]);
const prohibitedPartner = String.fromCharCode(67, 70, 67, 87);
const prohibitedPattern = new RegExp(prohibitedPartner, "i");

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const relativePath of allowlist) {
  await cp(path.join(root, relativePath), path.join(dist, relativePath), { recursive: true });
}

for (const file of await walk(dist)) {
  const relativePath = path.relative(dist, file);
  if (prohibitedPattern.test(relativePath)) {
    throw new Error(`Prohibited public file path: ${relativePath}`);
  }
  if (textExtensions.has(path.extname(file).toLowerCase())) {
    const body = await readFile(file, "utf8");
    if (prohibitedPattern.test(body)) {
      throw new Error(`Prohibited public content: ${relativePath}`);
    }
  }
}

console.log(`Built ${dist}`);
```

- [ ] **Step 2: Ignore generated output**

Append to `.gitignore`:

```gitignore
dist/
```

- [ ] **Step 3: Add a packaging regression test**

Add to `tests/campaign-refresh.test.mjs`:

```js
test("public build is allowlisted and contains no unconfirmed partner material", () => {
  execFileSync(process.execPath, ["scripts/build-public.mjs"], { cwd: root });
  assert.ok(existsSync(path.join(root, "dist", "index.html")));
  assert.ok(!existsSync(path.join(root, "dist", "docs")));
  assert.ok(!existsSync(path.join(root, "dist", "tests")));
  assert.ok(!existsSync(path.join(root, "dist", "scripts")));
  assert.ok(
    !existsSync(path.join(root, "dist", "assets", `${prohibitedPartner.toLowerCase()}-logo.png`)),
  );
});
```

- [ ] **Step 4: Run the full suite and build**

```powershell
node --test tests/*.test.mjs
node scripts/build-public.mjs
```

Expected: 11 tests PASS and `dist/` contains only allowlisted public files.

- [ ] **Step 5: Commit the build boundary**

```powershell
git add .gitignore scripts/build-public.mjs tests/campaign-refresh.test.mjs
git commit -m "build: publish only allowlisted campaign assets"
```

### Task 4: Document, scan, deploy and verify

**Files:**
- Modify: `README.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Document the production build rule**

Update `README.md` so local verification and deployment use:

```powershell
node --test tests/*.test.mjs
node scripts/build-public.mjs
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch main
```

State explicitly that repository docs, tests and scripts are not public assets.

- [ ] **Step 2: Record the hotfix state**

Update `STATUS.md` with the date, removed partner material, allowlisted deployment package, test count, deployment URL and live verification results. Do not include private account identifiers or credentials.

- [ ] **Step 3: Run final local checks**

```powershell
node --test tests/*.test.mjs
node scripts/build-public.mjs
git diff --check
rg -n -i "cfcw" dist
```

Expected: tests PASS, build succeeds, whitespace check is clean, and the final `rg` returns no matches.

- [ ] **Step 4: Run the public-release privacy scan**

Scan the branch diff and `dist/` for local paths, private email addresses, credentials, tokens, private keys and internal workspace material. Sanitize any new issue before deployment.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md STATUS.md
git commit -m "docs: record emergency partner hotfix"
```

- [ ] **Step 6: Push the hotfix branch**

```powershell
git push -u origin codex/remove-cfcw-emergency
```

Expected: the remote branch updates successfully.

- [ ] **Step 7: Deploy the allowlisted production package**

After verifying the active Cloudflare account is Murdawk Media:

```powershell
npx wrangler pages deploy dist --project-name seba-treasure-hunt --branch main
```

Expected: Wrangler reports a successful production deployment. Do not deploy this legacy hotfix to the `codex-validation` branch.

- [ ] **Step 8: Verify live removal**

For the canonical hostname, bare hostname and Pages production alias, verify:

- `/`, `/route` and `/interview` return successfully;
- response bodies contain no prohibited acronym or radio-partner claim;
- the former logo URL returns `404`;
- the former documentation and test URLs return `404`;
- the bare hostname still redirects permanently while preserving path and query; and
- `codex-validation.seba-treasure-hunt.pages.dev` remains clean and retains the hunter-platform validation build.

- [ ] **Step 9: Record the deployment evidence**

Add the production deployment identifier and verification results to `STATUS.md`, amend the documentation commit, push it, and repeat the privacy scan before the final push.
