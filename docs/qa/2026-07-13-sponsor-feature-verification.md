# Sponsor Feature Verification — 2026-07-13

This record makes the Task 10 sponsor visual, accessibility, route, and built-output checks reproducible for the next validation operator. It does not authorize deployment or any remote write.

## Tooling and prerequisites

- Node dependencies are installed from the lockfile.
- `@playwright/test` 1.61.1 supplies Chromium automation.
- `axe-core` 4.12.1 supplies accessibility analysis.
- Run `npm run build` so `dist/` reflects the source under review.
- Start the local Pages runtime with `npm run dev` and leave it available at `http://127.0.0.1:8788`.
- To inspect another read-only HTTP(S) target, set `SPONSOR_QA_BASE_URL`; the default remains local.

Run the complete check with:

```powershell
npm run verify:sponsor-qa
```

The command exits nonzero on any failed assertion and prints structured JSON evidence.

## Safety boundary

The runner permits HTTP GETs but blocks and counts every POST to `/api/v1/sponsors/inquiries`. The ordinary desktop and mobile checks preserve the local fail-closed Turnstile state. One isolated invalid-form check uses a test-only mocked `/api/v1/config` response and fake Turnstile callback to enable the button, submit an empty form, verify focus and `aria-invalid`, and observe zero sponsor POST requests. It never exercises a successful sponsor submission.

Screenshots are written outside the repository under `%TEMP%\tim-lost-task10`. They are evidence artifacts, not committed dependencies. Each artifact is reported with a SHA-256 digest.

## Browser and route coverage

- Sponsor desktop at 1440×1000: `.case-strip`, `.sponsor-topbar`, `.nav-sponsors[aria-current="page"]`, the `#inquiry` anchor, `#sponsor-faq`, `.sponsor-footer`, `[data-sponsor-turnstile]`, and `[data-sponsor-submit]`; verifies overflow, sticky geometry, gold/current Sponsors, anchor clearance, fail-closed submission, and zero console warnings/errors.
- Sponsor mobile at 390×844: `.menu-toggle`, `#nav`, `#nav .nav-sponsors`, `.opportunity-card`, `[data-sponsor-form]`, `.acknowledgement-field`, `[data-sponsor-turnstile]`, `[data-sponsor-result]`, and `[data-sponsor-submit]`; verifies menu link/Escape behavior, focus return, single-column automatic card heights, readable form regions, no overflow, and fail-closed submission.
- Zoom-equivalent at 720×500: verifies the 135 px sticky stack, hero clearance, and no overflow or overlap.
- Clue Board mobile at 390×844: `.case-signal`, `.board-topbar`, `.board-menu-toggle`, and `#nav .nav-sponsors`; verifies geometry, Sponsors reachability, Escape focus return, and no overflow.
- Unauthenticated Ops gate: `#ops-auth-panel`, `#ops-app`, and `[data-view-panel="sponsors"]`; verifies the gate is visible, the authorized app and sponsor panel remain hidden, and `/api/v1/ops/sponsors` returns HTTP 401 with `staff_auth_required` and no data.
- Route boundaries: `/sponsors` is HTTP 200, `/api/v1/status` is the normal local OPEN payload, and `/_worker.js` is HTTP 404.

Sponsor desktop, sponsor mobile, and the unauthenticated Ops gate run axe with WCAG 2.0 A/AA and WCAG 2.1 A/AA tags: `wcag2a`, `wcag2aa`, `wcag21a`, and `wcag21aa`. Each surface must report zero violations.

## Built-output privacy classification

The broad plan pattern is `sponsor_inquiries|sponsor_inquiry_events|private note|@sebahub\.com|@businessasaforceforgood\.ca|CFCW`. The runner permits sponsor schema strings only in `dist/_worker.js`, the exact private-note implementation copy only in `dist/assets/app/ops.js`, and enumerated intentional public addresses only on their current Home, Privacy, and Route paths. Any unexpected path or address fails the command.

The broad and corrected scans inspect every non-binary file under `dist`, including extensionless text files when present; the recorded build contained none. The corrected rendered-public scan excludes exactly `dist/_worker.js` and `dist/assets/app/ops.js`, then rejects sponsor schema strings, `private note`, and CFCW everywhere else. Separate entire-output checks reject `alex@example.test|Good local fit|staff_subject` and CFCW. A sponsor-page-only check rejects SebaHub and Business as a Force for Good contact addresses.

## Recorded run

The successful 2026-07-13 run used Playwright Chromium against `http://127.0.0.1:8788` and observed zero sponsor POSTs.

- Routes: `/sponsors` 200; `/api/v1/status` 200 with OPEN version 1; `/_worker.js` 404; unauthenticated `/api/v1/ops/sponsors` 401 with `staff_auth_required` and no data.
- Desktop: client and scroll widths 1440 px; strip 54 px at top 0; header 67 px at top 54; stack and `#main` top 121 px; Sponsors background `rgb(241, 182, 43)`; no console warnings/errors; fail closed; zero axe violations.
- Mobile: client and scroll widths 390 px; strip 76 px; header 59 px at top 76; stack 135 px; three 358 px cards with computed `min-height: auto`; 358 px form; menu link activation and Escape/focus return pass; fail closed; zero axe violations.
- Zoom-equivalent: 720 px client and scroll widths; 135 px stack; hero top 135 px; no overflow or overlap.
- Clue Board mobile: 390 px client and scroll widths; 76 px strip; 58 px header at top 76; 134 px stack; Sponsors menu and Escape/focus return pass.
- Ops gate: gateway visible; authorized app hidden; sponsor panel present and hidden; zero axe violations.
- Mock boundary: test-only config and fake Turnstile enabled invalid-form validation; `#sponsor-contact` received focus and `aria-invalid="true"`; zero sponsor POSTs.

The broad scan found 22 classified code/contact matches: eight `sponsor_inquiries` and two `sponsor_inquiry_events` matches in `dist/_worker.js`; two reviewed `private note` copy matches in `dist/assets/app/ops.js`; seven `@sebahub.com` matches across Home, Privacy, and Route; three `@businessasaforceforgood.ca` matches on Home; and zero CFCW matches. The only allowed addresses are `casey@sebahub.com` on Home and Route, `info@sebahub.com` on Privacy, and `tim@businessasaforceforgood.ca` on Home. The corrected rendered-public, entire-output fixture, entire-output CFCW, and sponsor contact-address scans each returned zero matches.

Artifacts in `%TEMP%\tim-lost-task10`:

| Screenshot | SHA-256 |
| --- | --- |
| `sponsors-desktop-1440x1000.png` | `d9206af8f0dee7b3151a5e523803b4ce4808723fecfacfd99bb9eedc3594129e` |
| `sponsors-mobile-390x844.png` | `617265b7360cbe66780bc757b1ca17de15adb358a0ad86c23c38d9256af0cc04` |
| `sponsors-zoom-equivalent-720x500.png` | `c23a559ebd5513bb6c7462e761d11346f8939f72ac5ecd9d685cd4e362098763` |
| `clue-board-mobile-390x844.png` | `9846738d80739b0fd0e61ab5c3f7a8934c2dcb14c99839d31cb1f9e177d4c804` |
| `ops-unauthenticated-1440x1000.png` | `f3d751d29cfbb1f375a1f71ba512ccb429e8d42ddab2ef85aff19d893405c8bd` |

## Known limitation

Authenticated Ops Sponsors visual review is not possible in the local runtime because staff identity configuration is intentionally absent. Static, authorization, API, client, and unauthenticated axe coverage remains in force; authenticated Ops review is deferred to validation Task 11.
