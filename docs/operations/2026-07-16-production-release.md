# Tim Lost Something production release — 2026-07-16

## Current state

- Canonical site: `https://www.timlostsomething.com`
- Apex redirect: `https://timlostsomething.com` permanently preserves the path and query string when redirecting to `www`.
- Cloudflare Pages project: `seba-treasure-hunt`
- Production application commit: `20e6da5248e3461d8f0eac95e2e534a49d1d62bd`
- Production Pages deployment: `34826743-fccc-43cc-a2e8-61df267a5759`
- Latest production data revision: `b44edb8f9b4374459505454a488ac04363600f48`
- Media worker version: `d0476c29-0bfc-450c-b30e-4fcba9aa99d5`
- Production database environment sentinel: `production`
- Production route: 13 waypoints, with separate Seniors Centre and Derby's General Store records.

## Release verification

- Static tests: 211 passing.
- Worker/client tests: 370 passing.
- TypeScript checks: passing.
- Production build: passing.
- D1 migrations: 1–14 applied; no pending migrations.
- D1 foreign-key check: clean.
- Anonymous waypoint API: 13 public waypoints and zero exact member map URLs.
- Live staff password login: verified with an active company-domain operator.
- Production Clerk custom domains: HTTPS-valid for hunter and staff instances.
- Turnstile: production widget active for the canonical, apex, and Pages hostnames.
- Microsoft Graph delegated mail: accepted a self-addressed production delivery test from the configured campaign mailbox with the campaign contact as Reply-To.
- Production crawl state: no `noindex` and no CFCW references in the live home output.

## Source-ready follow-on: Release 2 Documentary Case File

- Release 2A establishes the tracked documentary design source, type system,
  shared shell treatment and non-themed favicon family.
- Release 2B completes the public page/content/media transition, including the
  documentary homepage, real-evidence priority, Case Notes, Support the Search,
  Tim's preserved account, the preserved Lucky 13 route and one-item homepage
  official update.
- The 19 answer bodies, 13 stable waypoint IDs/order, 61 route photos, legal
  bodies/hashes, auth gates, reports, moderation, APIs and private Ops contracts
  remain unchanged.
- Retired public artwork is removed from source and build output; recursive
  regressions reject pirate vocabulary, references and old font tokens.
- This follow-on is not a production Pages deployment. The production commit
  and deployment identifiers above remain authoritative until explicit owner
  approval.
- After an approved deployment, smoke-test `/`, `/route`, `/interview`,
  `/updates`, `/clue-board`, `/sponsors`, `/start` and `/report`, then update the
  production identifiers and verification counts in this document.

## Rollback

- Git tag: `production-pre-hunter-platform-2026-07-16`
- Tagged source: `5552a57668417aef2fbd97d63e819807e2ee92dc`
- Previous immutable Pages deployment: `https://ad89ff2a.seba-treasure-hunt.pages.dev`
- Pre-promotion D1 backup: retained in the local ignored backup store.
- D1 Time Travel bookmark: recorded in the private release operations log.

Rollback is deliberately separate for code and data: restore the tagged Pages source for a code rollback; use the recorded D1 backup or Time Travel bookmark only when a data rollback is also required.

## Decisions in force

- Validation accounts and submissions remain disposable and separate from production.
- Production staff self-registration is limited to approved company email domains; each verified active operator receives new-submission alerts.
- Password login and provider-managed password recovery are active. Clerk Client Trust is disabled so new devices do not add an unimplemented email challenge after a correct password; lockout, password-strength, compromised-password, bot, and enumeration protections remain enabled.
- Exact route links remain gated to authenticated hunters. Public route stories and approved-report GPS locations remain public as designed.
- Private evidence is never auto-published. Operators must make a separate explicit publication decision, with media publication off by default.
- The RV guest and horseshoe-pit area remains restricted. Hunters planning to go beyond the public approach and enter the park must first check in with office staff and follow their directions.

## Follow-up wishlist

- Add a scheduled retry consumer for transient operator-alert mail failures.
- Run a real participant waiver acceptance after owner testing to verify the end-user receipt presentation and mail copy in production.
- Add visible waypoint-progress tracking later; it is intentionally deferred from this release.
- Rotate bootstrap and API credentials after the launch window and retain only the production secret-store copies.
