# Tim Lost Something Campaign Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the live hunt as `Tim Lost Something?`, add factual SEO/AEO and the approved campaign prop, update only the route video's final URL, connect both campaign hostnames, and send every Sunny badge to the SebaStays guarantee.

**Architecture:** Keep the site as three hand-authored static HTML pages with shared CSS/JS and add a Node built-in contract test for public metadata, structured data, branding, links, and crawl files. Keep the real blurred evidence photo authoritative, publish a separately disclosed optimized prop, and regenerate the video from the existing Remotion composition while copying the current AAC stream unchanged. Deploy only tracked files from a clean git archive to the existing Cloudflare Pages project, then attach both hostnames and canonicalize the apex at Cloudflare's edge.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, JSON-LD, FFmpeg/FFprobe, Remotion 4, Git, Cloudflare Pages and Redirect Rules.

---

## File map

Site repository:

- Create `tests/campaign-refresh.test.mjs`: executable contract for brand, links, metadata, JSON-LD, crawl files, prop disclosure, and retired URLs.
- Modify `index.html`: brand hierarchy, canonical/social metadata, homepage answer block, prop display, visible FAQs, JSON-LD, and Sunny badge links.
- Modify `route.html`: brand, canonical/social metadata, breadcrumb/route JSON-LD, and footer Sunny badge link.
- Modify `interview.html`: brand, canonical/social metadata, breadcrumb JSON-LD, and footer Sunny badge link.
- Modify `css/style.css`: accessible badge-link states, answer/prop presentation, focus treatment, and responsive behavior.
- Create `robots.txt`: allow public crawling and point to the canonical sitemap.
- Create `sitemap.xml`: list the three canonical pages.
- Create `assets/photos/tim-lost-id-campaign-prop.webp`: optimized public derivative.
- Modify `assets/route/route-video.mp4`: same video and soundtrack with only the final URL changed.
- Modify `README.md`: current brand, domain, page counts, build/test/deploy notes, and invariants.
- Modify `STATUS.md`: dated current state, custom domains, video provenance, decisions-in-force, and remaining owner/legal items.

Local Remotion tooling root:

- Modify `src/seba-route/EndCard.tsx`: replace only the old GitHub URL with `www.timlostsomething.com`.
- Modify `STATUS.md`: record the end-card update, render/verification method, and canonical output location.

Private source media:

- Move the approved source PNG to `source-media/originals/campaign-props/tim-lost-id-campaign-prop.png`; this directory stays gitignored and excluded from deployment.

### Task 1: Add the failing campaign contract

**Files:**
- Create: `tests/campaign-refresh.test.mjs`

- [ ] **Step 1: Create the contract test**

```js
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pages = ['index.html', 'route.html', 'interview.html']
const canonical = {
  'index.html': 'https://www.timlostsomething.com/',
  'route.html': 'https://www.timlostsomething.com/route',
  'interview.html': 'https://www.timlostsomething.com/interview',
}

test('all pages use the campaign brand and canonical domain', () => {
  for (const page of pages) {
    const html = read(page)
    assert.match(html, /Tim Lost Something\?/)
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical[page]}"`))
    assert.doesNotMatch(html, /murdawkmedia\.github\.io\/seba-treasure-hunt/)
  }
})

test('all four Sunny badges link accessibly to the guarantee', () => {
  const html = pages.map(read).join('\n')
  const links = html.match(/href="https:\/\/www\.sebastays\.com\/guarantee"/g) ?? []
  assert.equal(links.length, 4)
  assert.equal((html.match(/aria-label="Visit the SebaStays Sunny Guarantee \(opens in a new tab\)"/g) ?? []).length, 4)
})

test('SEO and answer-engine surfaces are present and parseable', () => {
  for (const page of pages) {
    const html = read(page)
    assert.match(html, /<meta name="description"/)
    assert.match(html, /<meta property="og:url"/)
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"/)
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(block[1])
  }
  assert.match(read('index.html'), /id="what-is-tim-lost-something"/)
  assert.match(read('index.html'), /id="hunt-faq"/)
})

test('the campaign prop is disclosed and never replaces evidence', () => {
  const html = read('index.html')
  assert.match(html, /assets\/photos\/tim-lost-id-campaign-prop\.webp/)
  assert.match(html, /Campaign prop \/ dramatization/)
  assert.match(html, /assets\/photos\/evidence-cash\.jpg/)
  assert.ok(existsSync(new URL('../assets/photos/tim-lost-id-campaign-prop.webp', import.meta.url)))
})

test('crawl files use only the canonical hostname', () => {
  assert.match(read('robots.txt'), /Sitemap: https:\/\/www\.timlostsomething\.com\/sitemap\.xml/)
  const sitemap = read('sitemap.xml')
  for (const url of Object.values(canonical)) assert.match(sitemap, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
```

- [ ] **Step 2: Run the contract and confirm the expected red state**

Run: `node --test tests/campaign-refresh.test.mjs`

Expected: failures for missing canonicals, brand, guarantee links, JSON-LD, prop derivative, `robots.txt`, and `sitemap.xml`.

- [ ] **Step 3: Commit the red test**

```powershell
git add -- tests/campaign-refresh.test.mjs
git commit -m "test: define campaign refresh contract"
```

### Task 2: Implement brand, badges, SEO, and AEO

**Files:**
- Modify: `index.html`
- Modify: `route.html`
- Modify: `interview.html`
- Modify: `css/style.css`
- Create: `robots.txt`
- Create: `sitemap.xml`

- [ ] **Step 1: Add canonical and social metadata to each page**

Use these exact canonical values:

```html
<!-- index.html -->
<link rel="canonical" href="https://www.timlostsomething.com/" />
<meta property="og:url" content="https://www.timlostsomething.com/" />

<!-- route.html -->
<link rel="canonical" href="https://www.timlostsomething.com/route" />
<meta property="og:url" content="https://www.timlostsomething.com/route" />

<!-- interview.html -->
<link rel="canonical" href="https://www.timlostsomething.com/interview" />
<meta property="og:url" content="https://www.timlostsomething.com/interview" />
```

Every page also gets `og:site_name`, absolute `og:image`, `twitter:card`, `twitter:title`, `twitter:description`, and `twitter:image`. Lead all titles with `Tim Lost Something?` and retain `Seba Beach Treasure Hunt` as the descriptor.

- [ ] **Step 2: Apply the approved visible hierarchy and badge links**

Use this nav brand on all pages:

```html
<a class="brand" href="index.html"><span aria-hidden="true">💰</span> Tim Lost Something?</a>
```

Wrap all four Sunny badges with:

```html
<a class="sunny-badge-link" href="https://www.sebastays.com/guarantee" target="_blank" rel="noopener" aria-label="Visit the SebaStays Sunny Guarantee (opens in a new tab)">
  <img class="hero__badge" src="assets/seba-badge.png" alt="Always Sunny in Seba" />
</a>
```

Footer instances keep `badge-mini` instead of `hero__badge`.

- [ ] **Step 3: Add the visible answer block and visible FAQ**

The answer block must state, without adding new claims:

```html
<section class="answer-block" id="what-is-tim-lost-something" aria-labelledby="what-is-title">
  <div class="wrap answer-block__inner">
    <p class="eyebrow">The 2026 Seba Beach Treasure Hunt</p>
    <h2 id="what-is-title">What is Tim Lost Something?</h2>
    <p><strong>Tim Lost Something?</strong> is a real public treasure hunt around Seba Beach on Lake Wabamun, Alberta. This year, Tim lost his ID—along with roughly $5,000 in cash and two diamond rings. Finders may keep the cash and rings; Tim only asks that his ID be returned to SebaHub.</p>
  </div>
</section>
```

Add a `hunt-faq` section whose visible questions/answers restate the existing official rules for what was lost, what finders keep, hunt hours, route access, safety, eligibility, and ID return.

- [ ] **Step 4: Add JSON-LD grounded in the visible copy**

Use `WebSite` plus homepage `WebPage`/`FAQPage`, page-specific `WebPage` plus `BreadcrumbList`, and route `ItemList`. Every JSON value must use the canonical hostname and match visible claims.

- [ ] **Step 5: Add crawl files**

`robots.txt`:

```text
User-agent: *
Allow: /

Sitemap: https://www.timlostsomething.com/sitemap.xml
```

`sitemap.xml` lists `/`, `/route`, and `/interview` with `2026-07-10` as `lastmod`.

- [ ] **Step 6: Add accessible badge and answer/FAQ styles**

```css
.sunny-badge-link { display: inline-block; border-radius: 16px; }
.sunny-badge-link:hover { filter: brightness(1.08); }
.sunny-badge-link:focus-visible { outline: 4px solid var(--gold-300); outline-offset: 6px; }
.answer-block { background: var(--cream-100); }
.answer-block__inner { max-width: 900px; text-align: center; }
.answer-block .eyebrow { color: var(--rust-600); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 1px; }
.hunt-faq { background: linear-gradient(180deg, var(--cream-100), var(--cream-200)); }
```

- [ ] **Step 7: Run the contract and inspect remaining failures**

Run: `node --test tests/campaign-refresh.test.mjs`

Expected: only the prop-asset test remains red.

- [ ] **Step 8: Commit the brand/SEO slice**

```powershell
git add -- index.html route.html interview.html css/style.css robots.txt sitemap.xml
git commit -m "feat: rebrand hunt and add SEO answer surfaces"
```

### Task 3: Publish the disclosed campaign prop

**Files:**
- Create private source: `source-media/originals/campaign-props/tim-lost-id-campaign-prop.png`
- Create public derivative: `assets/photos/tim-lost-id-campaign-prop.webp`
- Modify: `index.html`
- Modify: `css/style.css`

- [ ] **Step 1: Move the approved source into gitignored source media**

Resolve the source intake path from the current task, verify its SHA-256 is `74D40436D2287F11C044B848BAFA5BB3795D209B84F69112BC01EA3D4822A858`, create `source-media/originals/campaign-props`, and move the PNG there. Do not strip its embedded provenance chunk.

- [ ] **Step 2: Generate the public WebP derivative**

```powershell
ffmpeg -y -i source-media/originals/campaign-props/tim-lost-id-campaign-prop.png -c:v libwebp -quality 82 -compression_level 6 assets/photos/tim-lost-id-campaign-prop.webp
```

Expected: 1587×991 WebP substantially smaller than the 3.0 MiB source.

- [ ] **Step 3: Add a separate disclosed prop figure after the evidence section**

```html
<aside class="campaign-prop" aria-labelledby="campaign-prop-title">
  <div class="wrap">
    <h2 id="campaign-prop-title">Tim's ID — Campaign Prop</h2>
    <figure>
      <img src="assets/photos/tim-lost-id-campaign-prop.webp" width="1587" height="991" loading="lazy" decoding="async" alt="Fictional campaign prop resembling an Alberta driver's licence for Captain Latimer on a dark counter; all details are invented." />
      <figcaption><strong>Campaign prop / dramatization:</strong> not a real driver's licence and not an exact image of the card hunters are looking for.</figcaption>
    </figure>
  </div>
</aside>
```

- [ ] **Step 4: Style the prop without making it look like evidence**

Use a distinct dashed gold frame, a visible disclosure panel, explicit image dimensions, and `max-width: 900px`; do not reuse `.evidence-fig` or `EVIDENCE` labeling.

- [ ] **Step 5: Run the contract and confirm green**

Run: `node --test tests/campaign-refresh.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit the prop slice**

```powershell
git add -- index.html css/style.css assets/photos/tim-lost-id-campaign-prop.webp
git commit -m "feat: add disclosed Tim ID campaign prop"
```

### Task 4: Change only the route-video end-card URL

**Files:**
- Modify in Remotion root: `src/seba-route/EndCard.tsx`
- Create temporary outputs under Remotion `out/`
- Modify in site repo: `assets/route/route-video.mp4`
- Modify in Remotion root: `STATUS.md`

- [ ] **Step 1: Record the existing published video invariants**

Use FFprobe and FFmpeg hash output to record: 1,949 frames, 24 fps, 1920×1080, 81.208333 seconds, H.264 video, AAC audio, size below 25 MiB, and decoded-audio SHA-256 `30928a5ca8991f5d69db5abf443483dcb800b42d6d64de0da25506d1daa275bb`.

- [ ] **Step 2: Change only the EndCard URL source**

```tsx
<div
  style={{
    backgroundColor: PALETTE.goldLight,
    borderRadius: 999,
    color: PALETTE.forestGreenDark,
    fontFamily: FONT_STACK,
    fontSize: 38,
    fontWeight: 700,
    marginTop: 48,
    padding: "14px 40px",
  }}
>
  www.timlostsomething.com
</div>
```

- [ ] **Step 3: Verify and render to a new path**

Run from the Remotion root:

```powershell
npm run lint
npx remotion render SebaRouteRetraced out/seba-route-retraced-timlostsomething-silent.mp4 --codec=h264
```

Expected: lint/typecheck passes and the silent render contains 1,949 frames.

- [ ] **Step 4: Copy the unchanged soundtrack and make the Cloudflare-sized derivative**

Mux the existing published AAC stream into the new visual render with `-c:a copy`. Then encode only video with H.264 at the existing ~1.95 Mbps profile, preserve audio with `-c:a copy`, use `yuv420p`, and add `-movflags +faststart`. Write to a new file before replacing the published asset.

- [ ] **Step 5: Prove the video invariants**

Compare decoded frame hashes against the previous Remotion master through frame 1840; expected zero differences. Confirm frames 1841–1948 differ visually only in the URL. Confirm the final decoded-audio hash is unchanged, frame count/duration/dimensions are unchanged, and final size remains below 25 MiB.

- [ ] **Step 6: Replace the site video and update Remotion status**

Only after Step 5 passes, replace `assets/route/route-video.mp4`. Add a dated Remotion `STATUS.md` entry naming `SebaRouteRetraced`, the new canonical URL, copied-audio invariant, and output verification.

- [ ] **Step 7: Commit the new published video**

```powershell
git add -- assets/route/route-video.mp4
git commit -m "feat: update route video campaign URL"
```

### Task 5: Verify privacy, rendering, and handoff docs

**Files:**
- Modify: `README.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Update README and STATUS to current reality**

Record the canonical/bare domains, Pages project, three routes, 12 waypoints/61 photos, Node contract command, static preview command, safe archive deploy rule, prop disclosure, Remotion video source, badge destination, and decisions-in-force. Remove stale 10-stop/58-photo and GitHub-primary claims.

- [ ] **Step 2: Run public-release privacy scans on the staged diff**

Scan the staged/public diff for local paths, credential terms, private workflow references, tokens, `.env` values, host IPs, raw logs, and unapproved personal details. Treat existing deliberately published hunt contact information as existing scope; do not introduce any new personal contact data.

- [ ] **Step 3: Run static verification**

```powershell
node --test tests/campaign-refresh.test.mjs
git diff --check
git status --short
```

Validate every JSON-LD block with `JSON.parse`, every sitemap URL, all local `src`/`href` targets, and the absence of the old GitHub URL in public HTML.

- [ ] **Step 4: Preview and visually inspect desktop/mobile**

Serve the repo with `python -m http.server 8080`. Check `/`, `/route`, and `/interview` at 1280px and 390px widths; verify the hero, prop disclosure, FAQ, nav wrapping, badge focus/hover, route map, video, and no console errors.

- [ ] **Step 5: Commit docs and any QA corrections**

```powershell
git add -- README.md STATUS.md index.html route.html interview.html css/style.css robots.txt sitemap.xml tests/campaign-refresh.test.mjs
git commit -m "docs: make campaign handoff ready"
```

### Task 6: Deploy and configure Cloudflare

**External target:** Murdawk Media account `d113f919b7e29373ccac141104bea5b0`, Pages project `seba-treasure-hunt`, zone `timlostsomething.com`.

- [ ] **Step 1: Verify account/project/zone without exposing credentials**

Confirm Wrangler/API identity is the Murdawk Media account, list the `seba-treasure-hunt` Pages project, and confirm `timlostsomething.com` is in the same account. Do not print token values or use Signal21 credentials.

- [ ] **Step 2: Create a clean tracked-file deployment archive**

Use `git archive HEAD` into a temporary directory outside the repo. Verify the archive contains the three pages, crawl files, assets, and tests/docs as expected, and contains neither `planning/`, `source-media/`, `.wrangler/`, nor credential files.

- [ ] **Step 3: Deploy the archive to Pages**

```powershell
$stage = Join-Path $env:TEMP 'tim-lost-something-pages-stage'
npx wrangler pages deploy $stage --project-name seba-treasure-hunt --branch main
```

Expected: a successful Pages deployment; immediately smoke-test the returned deployment URL and `https://seba-treasure-hunt.pages.dev` for the `Tim Lost Something?` marker.

- [ ] **Step 4: Attach both custom hostnames**

Attach `www.timlostsomething.com` and `timlostsomething.com` to the existing Pages project through the Murdawk account. Poll both Pages-domain states until active and verify Cloudflare-managed DNS/SSL is healthy.

- [ ] **Step 5: Create the apex canonical redirect**

Create one zone-level dynamic redirect rule:

```text
When: http.host eq "timlostsomething.com"
Target: concat("https://www.timlostsomething.com", http.request.uri.path)
Status: 301
Preserve query string: true
```

Do not replace or reorder unrelated existing zone rules.

- [ ] **Step 6: Verify production behavior**

Verify:

- `https://www.timlostsomething.com/`, `/route`, and `/interview` return 200 and current content.
- `https://timlostsomething.com/route?source=apex-test` returns 301 to `https://www.timlostsomething.com/route?source=apex-test`.
- All four public Sunny badges resolve to `https://www.sebastays.com/guarantee`.
- `robots.txt`, `sitemap.xml`, canonical tags, JSON-LD, the prop image, and the MP4 are public.
- The live MP4 is under 25 MiB and its decoded-audio hash remains unchanged.

- [ ] **Step 7: Push the verified branch/main state**

After production verification and privacy scan, push the intended commits to `origin/main` and confirm local/upstream parity.

### Task 7: Close the MurphyOS handoff

**Files:**
- Modify: project `STATUS.md` if deployment results changed after its predeploy update.
- Create: dated sanitized MurphyOS history note in the approved history zone.

- [ ] **Step 1: Record actual deployed state**

Add exact live URLs, active/redirect behavior, Pages project, verification results, current commit, video invariants, badge destination, and any remaining legal/operational sign-off. Include no credential values or local personal paths.

- [ ] **Step 2: Re-run final checks**

Run the campaign contract, git diff check, public privacy scan, Pages/custom-domain smoke tests, and MurphyOS read-only checks. Resolve any stale README/STATUS statement before completion.

- [ ] **Step 3: Commit/push the final status-only correction if needed**

Use `[skip ci]` only if the final commit changes documentation and no site asset.
