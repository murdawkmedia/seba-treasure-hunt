# Tim Lost Something production release — 2026-07-16

## Current state

- Canonical site: `https://www.timlostsomething.com`
- Apex redirect: `https://timlostsomething.com` permanently preserves the path and query string when redirecting to `www`.
- Cloudflare Pages project: `seba-treasure-hunt`
- Production source commit: `d820b7072c51e2b9d11c513b2217e4a9e4b4d0aa`
- Production Pages deployment: `6dfe8bed-739e-4301-ba84-6046f928ae30`
- Media worker version: `d0476c29-0bfc-450c-b30e-4fcba9aa99d5`
- Production database environment sentinel: `production`
- Production route: 13 waypoints, with separate Seniors Centre and Derby's General Store records.

## Release verification

- Static tests: 211 passing.
- Worker/client tests: 369 passing.
- TypeScript checks: passing.
- Production build: passing.
- D1 migrations: 1–13 applied; no pending migrations.
- D1 foreign-key check: clean.
- Anonymous waypoint API: 13 public waypoints and zero exact member map URLs.
- Live staff password login: verified with an active company-domain operator.
- Production Clerk custom domains: HTTPS-valid for hunter and staff instances.
- Turnstile: production widget active for the canonical, apex, and Pages hostnames.
- Microsoft Graph delegated mail: accepted a self-addressed production delivery test from `tech@sebahub.com` with Casey as Reply-To.
- Production crawl state: no `noindex` and no CFCW references in the live home output.

## Rollback

- Git tag: `production-pre-hunter-platform-2026-07-16`
- Tagged source: `5552a57668417aef2fbd97d63e819807e2ee92dc`
- Previous immutable Pages deployment: `https://ad89ff2a.seba-treasure-hunt.pages.dev`
- Pre-promotion D1 backup: `C:\Users\Murphy\.codex\backups\tim-lost-something\tim-lost-hunter-platform-production-pre-promotion-20260716-091259.sql`
- D1 Time Travel bookmark: `0000001c-00000000-000050aa-07a324b59fa7b796021c2126d5dbc883`

Rollback is deliberately separate for code and data: restore the tagged Pages source for a code rollback; use the recorded D1 backup or Time Travel bookmark only when a data rollback is also required.

## Decisions in force

- Validation accounts and submissions remain disposable and separate from production.
- Production staff self-registration is limited to approved company email domains; each verified active operator receives new-submission alerts.
- Password login and provider-managed password recovery are active. Clerk Client Trust is disabled so new devices do not add an unimplemented email challenge after a correct password; lockout, password-strength, compromised-password, bot, and enumeration protections remain enabled.
- Exact route links remain gated to authenticated hunters. Public route stories and approved-report GPS locations remain public as designed.
- Private evidence is never auto-published. Operators must make a separate explicit publication decision, with media publication off by default.

## Follow-up wishlist

- Add a scheduled retry consumer for transient operator-alert mail failures.
- Run a real participant waiver acceptance after owner testing to verify the end-user receipt presentation and mail copy in production.
- Add visible waypoint-progress tracking later; it is intentionally deferred from this release.
- Rotate bootstrap and API credentials after the launch window and retain only the production secret-store copies.
