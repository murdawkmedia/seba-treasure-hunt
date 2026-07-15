# Unified Campaign Shell Verification - 2026-07-14

This record verifies the local unified-shell implementation for the Tim Lost Something? public and hunter routes. It does not authorize or record a Cloudflare change, DNS change, database migration, provider configuration, delegated authorization, email, validation deployment or production mutation.

## Source and architecture

The verified implementation head before this documentation commit was `1bf3935` on `codex/tim-lost-hunter-platform`.

- Task 1 renderer/parser: `2bee863`, `c58124d`, `f295f91`, `174f883`, `e77fb69`.
- Task 2 build integration: `6f29961`, `639b30e`, `46bc766`, `f852a34`.
- Task 3 canonical shell behavior: `86a7abf`, `e92e461`, `e2d645f`, `469586c`.
- Task 4 visual system/focus contexts: `3da787b`, `fb0e031`, `c0ca1b1`, `d21df25`, `3b4b1b7`, `0f2b340`.
- Task 5 Clue Board status integration: `7cb02d3`, `dc0d6d6`.
- Task 6 route-matrix/accessibility QA: `53e1941`, `c234363`.
- Task 7 drift protection: `4bda466`, `350c297`, `6a6c3eb`, `1bf3935`.

`scripts/campaign-shell.mjs` is the only public shell source. Its fixed primary menu is Start, 12-waypoint Route, Updates, Clue Board, Report, Rules, Dashboard, Sponsors. `css/campaign-shell.css` owns public chrome and shared tokens; landing, route, editorial, ledger, workspace, document and sponsor page-family classes preserve route-specific character. The private Ops console remains independent.

## Reproduction and automated results

Run from the repository root, sequentially:

```powershell
npm run legal:verify
npm test
npm run typecheck
npm run build
npm run verify:waiver-qa
npm audit --omit=dev --audit-level=high
git diff --check
node --test tests/navigation-geometry.test.mjs tests/campaign-shell-accessibility.test.mjs
```

Fresh results:

- Legal generation check: passed. Participation Waiver `2026.1` remains SHA-256 `1a6e50f445fc7c67962e5e0050c7fbe161d7d78e679dab4f6fde951602cf3607`; Privacy Policy & Media Notice `2026.2` remains SHA-256 `47e26763d46441e2e155a6d0ca3869986395c49b60073a8da9256577229f07a8`.
- Static/contract suite: 189/189 passed.
- TypeScript suite: 278/278 passed.
- Worker, client, Worker-test and client-test typechecks: passed.
- Build: passed; Pages Worker 316.9 kB, media Worker 3.2 kB, Clerk browser bundle 1.5 MB, Ops 40.3 kB, Dashboard 29.7 kB, Clue Board 14.1 kB and Sponsors 8.4 kB, plus the remaining client bundles.
- Focused navigation/accessibility gate: 12/12 passed.
- Diff check: passed.
- Dependency audit: exit 0 at the high threshold, with zero high or critical findings. Twelve moderate findings remain in `uuid` through Clerk's optional Solana dependency chain. The offered complete remediation requires a breaking Clerk downgrade and was not forced.

The waiver QA run observed 251 requests: 129 continued local reads, 37 external reads fulfilled locally, 69 local API mocks, 9 authentication-provider mocks and 7 local mocked writes. The writes were three account bootstraps and one each for waiver review, waiver acceptance, participant receipt resend and Ops receipt retry. It recorded zero external writes, zero continued external requests, zero blocked writes, zero forbidden provider attempts and zero server-rejected writes.

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

## Visual inspection

Representative full-page captures were reviewed for Home, Route, Interview, Clue Board, Dashboard, Sponsors, Privacy and Waiver at 390x844 and 1440x1000. Separate 720x500 captures show the focused Home skip link, the complete open Route menu and the Waiver main-content landing after skip navigation.

The inspection confirmed:

- the status strip, brand, menu alignment, menu order and footer are consistent across the representative routes;
- mobile pages retain one compact header and an explicit menu button without horizontal overflow;
- landing, Route, Interview, ledger, workspace, Sponsors and legal-document personalities remain visually distinct;
- desktop current-state treatment and Sponsors emphasis are consistent;
- the focused skip link is fully visible, the short open menu exposes every item, and zoomed main content clears the sticky rows; and
- no screenshot displayed a broken shell, clipped focus state or page-level overflow.

Screenshots remain outside the repository and were not published. The temporary artifact set contains only the following relative names and SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| `mobile-390x844-home.png` | `723ef5330f5e5a34e9bb386f4f2a9739bf10188375a41b8c0856bbda36cdfbf7` |
| `desktop-1440x1000-home.png` | `686a643a28af744a6c68d2c4e602e0de89fcbdbd1dd29a0cbe970e84d68341b9` |
| `mobile-390x844-route.png` | `472f698bf748e6225d4b3676256eee2435c369e9510486c44cbd51893c895acd` |
| `desktop-1440x1000-route.png` | `6d5f22fb709ef0732eb92f60511feb746b2831105f5001f53919f87a7e3001d4` |
| `mobile-390x844-interview.png` | `170b9e7dc3d279f9c2a1060cf24e5797dce095aae996d68cb92741b97e496c19` |
| `desktop-1440x1000-interview.png` | `8ff54193d74e78fb88318ae850f11bd0323fce1282c233f4e7d7224346709839` |
| `mobile-390x844-clue-board.png` | `b7424e12f3bd0e45e729f66ef1c582d717b9a901342e2a44db0f82562c1c141f` |
| `desktop-1440x1000-clue-board.png` | `a16655f28f3cc2bdb7723a253343caf31ff70ee4c4d61247734ffe96441e949e` |
| `mobile-390x844-dashboard.png` | `8718ef26b836e6ed0866e6ac0355414983e8d5fd5fa7a67f20d6f7dbe21392ad` |
| `desktop-1440x1000-dashboard.png` | `303f0721001c2100f68bf70c10f509c980517944ca6086a7282f266510fafebd` |
| `mobile-390x844-sponsors.png` | `54bfa13bf6525aabb045fea010b6d946c11d551f086003cc06c49233dbaef727` |
| `desktop-1440x1000-sponsors.png` | `b2ef3b85913a78c69ab20325afb3eebc6e718dab614605d8e6273cef47d7774b` |
| `mobile-390x844-privacy.png` | `a36ae2e3de93a38c90331d7e4d71733004a0ffccda257efb05746e367b236247` |
| `desktop-1440x1000-privacy.png` | `320693ac1e60881dbdf9f853168daa8b240d918b84675a4cb10d589767e61a80` |
| `mobile-390x844-waiver.png` | `f1407f5ad741af11245b9e7a72fa8efd02b963fd96f2ed4077098babf11be459` |
| `desktop-1440x1000-waiver.png` | `d624ee5a3bdf94a91767a2cb9f45e151e1c1ac31dcc78f7aa5f928ffe5ae466d` |
| `zoom-200-home-skip-focus.png` | `ca31f3cd20f0f0969ba1a11dfdf5da56370173f2394319c1e590cafb63a4aeef` |
| `zoom-200-route-menu-open.png` | `6529df7480e0c8f77fc10909aafdc5789fa604c22543fe09f0e194bf08bd5d01` |
| `zoom-200-waiver-main-focus.png` | `79353e00e06d08b1ce07c30f2e1da5357b783ac7f86ec29c8d322f4ac32c4e74` |

## Public-output privacy classification

The built text surfaces were scanned for credentials, local personal paths, private evidence fixtures, coordinate-like literals, provider configuration, unapproved broadcaster references, internal workspace names and email addresses.

- Public campaign pages and public browser assets contain zero local paths, project credentials, provider-setting names, unapproved broadcaster references, internal workspace names or coordinate-like literals.
- Waiver QA found zero private fixture leaks in production source, rendered public output and public bundles.
- Exactly three previously approved public contact addresses remain in the established campaign/privacy copy; no additional or unknown address was found.
- One broad credential heuristic matched a public analytics identifier embedded in Clerk's bundled Coinbase browser integration. It was inspected and classified as a third-party public vendor constant, not a campaign credential. Its value is intentionally omitted here.
- Sixteen provider-setting-name occurrences are confined to the private Worker bundle. They are configuration identifiers without values. The Worker, Ops and Dashboard artifacts were classified separately rather than represented as public-page leaks.
- No raw token, secret value, OAuth state, staff allowlist, private report fixture, exact-location fixture or local source path was found in the served public surfaces.

## Non-deployment handoff

No Cloudflare API or dashboard mutation, DNS change, provider configuration, delegated sign-in, email, validation deployment or production operation occurred. Pre-existing Wrangler/workerd processes were not started, stopped or used as release evidence.

The next external workflow is the separately controlled Graph validation rollout: migrate isolated validation D1 through `0010_graph_transactional_email.sql`, configure Preview-only Graph/sender settings, complete owner-controlled delegated authorization, deploy only the validation branch, run one controlled provider test, and verify production remains unchanged.
