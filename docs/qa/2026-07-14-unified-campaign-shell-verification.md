# Unified Campaign Shell Verification - 2026-07-14

This record verifies the local unified-shell implementation for the Tim Lost Something? public and hunter routes. It does not authorize or record a Cloudflare change, DNS change, database migration, provider configuration, delegated authorization, email, validation deployment or production mutation.

## Source and architecture

The verified implementation head before this documentation commit was `786598d` on `codex/tim-lost-hunter-platform`.

- Task 1 renderer/parser: `2bee863`, `c58124d`, `f295f91`, `174f883`, `e77fb69`.
- Task 2 build integration: `6f29961`, `639b30e`, `46bc766`, `f852a34`.
- Task 3 canonical shell behavior: `86a7abf`, `e92e461`, `e2d645f`, `469586c`.
- Task 4 visual system/focus contexts: `3da787b`, `fb0e031`, `c0ca1b1`, `d21df25`, `3b4b1b7`, `0f2b340`.
- Task 5 Clue Board status integration: `7cb02d3`, `dc0d6d6`.
- Task 6 route-matrix/accessibility QA: `53e1941`, `c234363`.
- Task 7 drift protection: `4bda466`, `350c297`, `6a6c3eb`, `1bf3935`.
- Task 8 reproducible browser and privacy-output QA: `48c9057`, `786598d`.

`scripts/campaign-shell.mjs` is the only public shell source. Its fixed primary menu is Start, 12-waypoint Route, Updates, Clue Board, Report, Rules, Dashboard, Sponsors. `css/campaign-shell.css` owns public chrome and shared tokens; landing, route, editorial, ledger, workspace, document and sponsor page-family classes preserve route-specific character. The private Ops console remains independent.

## Reproduction and automated results

Run from the repository root, sequentially:

```powershell
npm run legal:verify
npm test
npm run typecheck
npm run build
npm run verify:waiver-qa
npm run verify:unified-shell-qa
npm audit --omit=dev --audit-level=high
git diff --check
node --test tests/navigation-geometry.test.mjs tests/campaign-shell-accessibility.test.mjs
```

Fresh results:

- Legal generation check: passed. Participation Waiver `2026.1` remains SHA-256 `1a6e50f445fc7c67962e5e0050c7fbe161d7d78e679dab4f6fde951602cf3607`; Privacy Policy & Media Notice `2026.2` remains SHA-256 `47e26763d46441e2e155a6d0ca3869986395c49b60073a8da9256577229f07a8`.
- Static/contract suite: 197/197 passed.
- TypeScript suite: 278/278 passed.
- Worker, client, Worker-test and client-test typechecks: passed.
- Build: passed; Pages Worker 316.9 kB, media Worker 3.2 kB, Clerk browser bundle 1.5 MB, Ops 40.3 kB, Dashboard 29.7 kB, Clue Board 14.1 kB and Sponsors 8.4 kB, plus the remaining client bundles.
- Focused navigation/accessibility gate: 12/12 passed.
- Reproducible unified-shell browser gate: 72/72 navigations, 111/111 states and 19/19 screenshot artifacts passed with zero console or page errors.
- Diff check: passed.
- Dependency audit: exit 0 at the high threshold, with zero high or critical findings. Twelve moderate findings remain in `uuid` through Clerk's optional Solana dependency chain. The offered complete remediation requires a breaking Clerk downgrade and was not forced.

The waiver QA run observed 251 requests: 129 continued local reads, 37 external reads fulfilled locally, 69 local API mocks, 9 authentication-provider mocks and 7 local mocked writes. The writes were three account bootstraps and one each for waiver review, waiver acceptance, participant receipt resend and Ops receipt retry. It recorded zero external writes, zero continued external requests, zero blocked writes, zero forbidden provider attempts and zero server-rejected writes. Its output classifier scanned 37 public static files, including `dashboard.html` and `assets/app/dashboard.js`, and three private Worker/Ops bundle files; both classifications contained zero private-fixture findings.

## Route, accessibility and geometry matrix

| Coverage | Routes/states | Result |
| --- | --- | --- |
| Canonical geometry | All 13 public/hunter routes at 360x900, 768x900 and 1440x900 | One strip/header/skip link, synchronized sticky offsets, correct current state, visible Sponsors and no horizontal overflow |
| 200% zoom equivalent | All 13 routes at 720x500 | Skip focus reaches visible main content below the stacked header with no horizontal overflow |
| Mobile axe | All 13 routes at 390x844, collapsed and expanded menu | Zero serious or critical axe findings; required landmarks and controls present |
| Desktop axe | Home, Route, Interview, Clue Board, Dashboard, Sponsors and Privacy at 1440x1000 | Zero serious or critical axe findings |
| Navigation behavior | 390x844, 720x500, 320x500 and a 390-to-900-to-390 breakpoint transition | Click and Escape closure, focus restoration, nested link behavior, full short-menu traversal and breakpoint reset passed |
| Focus contexts | Dark chrome, parchment, raised controls, current links, overflow-clipped Route photos and Interview details | Visible context-appropriate outlines, preserved component shadows and no clipped focus indicator |

The focused browser run blocked all non-local requests. The screenshot captures also intercepted every external request before network continuation: 23 font or Turnstile requests were fulfilled locally, zero external request continued and zero page error was recorded.

The durable `verify:unified-shell-qa` runner creates a unique OS-temporary build and artifact directory, renders all 13 source routes through the canonical renderer, starts a read-only local server, installs its request boundary before each page and covers 72 page navigations and 111 route states:

- 26 collapsed/expanded states at 360x900;
- 13 desktop states at 768x900;
- 13 desktop states at 1440x900;
- 26 collapsed/expanded states at the 720x500 200%-zoom equivalent;
- 26 collapsed/expanded states at 390x844; and
- 7 representative desktop states at 1440x1000.

The authoritative ledger for this table executed at `2026-07-15T03:24:50.371Z` (run date `2026-07-15`). It records its real Node execution timestamp and derived run date, while the browser fixture clock remains separately and explicitly fixed at `2026-07-14T18:00:00.000Z` so status-age and clue-time rendering are controlled test inputs rather than false run metadata.

The audit recorded zero `console.error` messages and zero uncaught page errors. Across the route matrix and screenshot pass, it intercepted 112 external read attempts: 91 stylesheets and 21 scripts. Every attempt was fulfilled locally with a non-networking QA response; zero external request continued. It recorded zero external writes, zero local writes and zero writes rejected by the read-only server. Local API fixtures were also fulfilled inside the audit boundary so console results reflect the shell and built clients rather than unavailable test infrastructure.

## Visual inspection

All 19 artifacts from this exact run were visually reviewed together. The eight mobile and eight desktop full-page captures retain the unified shell, correct current-state treatment and expected page-family layouts; the three separate 720x500 zoom artifacts are viewport captures rather than full-page captures, so they directly show the focused Home skip link, complete open Route menu and Waiver main-content landing. No private report evidence, exact location, credential, staff-only record or unexpected personal data was visible; the public legal/contact copy and disclosed fictional campaign prop remain the approved public content.

Before those zoom captures, the runner asserts that Tab places Home focus on the visible, outlined `.skip-link` inside the viewport; that the Route menu has its real open state; and that activating the Waiver `.skip-link` targeting `#main` transfers focus to `#main`, leaves it inside the viewport and clears the measured current `--stacked-header-height`. Missing targets or failed focus transfer are not ignored.

The inspection confirmed:

- the status strip, brand, menu alignment, menu order and footer are consistent across the representative routes;
- mobile pages retain one compact header and an explicit menu button without horizontal overflow;
- landing, Route, Interview, ledger, workspace, Sponsors and legal-document personalities remain visually distinct;
- desktop current-state treatment and Sponsors emphasis are consistent;
- the focused skip link is fully visible, the short open menu exposes every item, and zoomed main content clears the sticky rows; and
- no screenshot displayed a broken shell, clipped focus state or page-level overflow.

Screenshots remain outside the repository and were not published. All 19 rows below come from that one preserved unique OS-temporary artifact set; its absolute temporary path is intentionally not recorded. The authoritative ledger contains the following relative names and SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| `mobile-390x844-home.png` | `72299a515a7d0d5b9498341ea2deb95b703a949f90d1df4df436875e0b242c0f` |
| `mobile-390x844-route.png` | `3994069477fe0af7e85d721e923033b767d3d030c59eaca10e9603c2b49bfbc8` |
| `mobile-390x844-interview.png` | `26e7dde5600601102fda48e6559a7db922bc398bb57410adac37188dc701b1f9` |
| `mobile-390x844-clue-board.png` | `4e21c1ad06b017b68b6a6fa24ffd9d91e037313cc36d0c62d537c52c02a105cd` |
| `mobile-390x844-dashboard.png` | `51dfcb67fc5b94730d50eb5db72d25dea61832fcaac088694b9adb0918021c9d` |
| `mobile-390x844-sponsors.png` | `57d2ccc5fd7ddf5d5b2a6cb56c704ea66f88f1d62cd4c700fa4925a3d6a18e36` |
| `mobile-390x844-privacy.png` | `30051be86bb207b31a46185275e67a0eab7e195767f2d7add3338cded1141116` |
| `mobile-390x844-waiver.png` | `42985f0a9e6afba15566a23fd6ed0ae8033829d7f7d4f60143b1ac0e1a9ebd75` |
| `desktop-1440x1000-home.png` | `ac8b5e69c1a4d2f744d9388af478b3666e56fd76f8cf8d26a2bf1aa7f963824c` |
| `desktop-1440x1000-route.png` | `55b09b7384b3f3a8df01b64d4ece4ac45f04ced3a318c81df35c4104ddce40f0` |
| `desktop-1440x1000-interview.png` | `73916a97155ab38dceea512881f54abcce8c68a91bae8b192c2063d7975268da` |
| `desktop-1440x1000-clue-board.png` | `30810992c584e7f7d937de8b098a52f3af94edcb66dfc0b8eb6bf388d8ab7bdd` |
| `desktop-1440x1000-dashboard.png` | `f6ebc116d48ebe70039cc8ebb678eaa72be87939858225d949f869fa4d63d46c` |
| `desktop-1440x1000-sponsors.png` | `bfff101c83e6010e3286f8a0ac5e1a7de21750c57f6f74a58174f629018c2df7` |
| `desktop-1440x1000-privacy.png` | `62fc231797bbb931f11c144dba47333f92d84aadf437638f9166eddcb3cf1986` |
| `desktop-1440x1000-waiver.png` | `3c46440aefed0b21ca64cb8a534589d6f90d67b776a1f8b69a07bdd874154186` |
| `zoom-200-home-tab-focus.png` | `67c3a42aeb1cfff5c6d8ec721cd6d77380af264309783f2d1753b5612e166e11` |
| `zoom-200-route-menu-open.png` | `bccf7ebfe855b6f289bff4321998ccd65907ac70914f9df07ecde3d67a67a6db` |
| `zoom-200-waiver-main-focus.png` | `559f1fb1885a1128d1acfc93362d5e4258c96594aca2fbec04cc162e6d3dc70e` |

## Public-output privacy classification

The built text surfaces were scanned for credentials, local personal paths, private evidence fixtures, coordinate-like literals, provider configuration, unapproved broadcaster references, internal workspace names and email addresses.

- Public campaign pages and public browser assets contain zero local paths, project credentials, provider-setting names, unapproved broadcaster references, internal workspace names or coordinate-like literals.
- Waiver QA found zero private fixture leaks in production source, rendered public output and public bundles.
- Exactly three previously approved public contact addresses remain in the established campaign/privacy copy; no additional or unknown address was found.
- One broad credential heuristic matched a public analytics identifier embedded in Clerk's bundled Coinbase browser integration. It was inspected and classified as a third-party public vendor constant, not a campaign credential. Its value is intentionally omitted here.
- Sixteen provider-setting-name occurrences are confined to the private Worker bundle. They are configuration identifiers without values. Dashboard HTML and its client bundle are scanned as public static output; the executable Worker and Ops-only artifacts retain their separate private-bundle classification.
- No raw token, secret value, OAuth state, staff allowlist, private report fixture, exact-location fixture or local source path was found in the served public surfaces.

## Non-deployment handoff

No Cloudflare API or dashboard mutation, DNS change, provider configuration, delegated sign-in, email, validation deployment or production operation occurred. Pre-existing Wrangler/workerd processes were not started, stopped or used as release evidence.

The next external workflow is the separately controlled Graph validation rollout: migrate isolated validation D1 through `0010_graph_transactional_email.sql`, configure Preview-only Graph/sender settings, complete owner-controlled delegated authorization, deploy only the validation branch, run one controlled provider test, and verify production remains unchanged.
