# Validation MVP readiness — 2026-07-14

## Release boundary

- Candidate: `codex/tim-lost-hunter-platform`, validation alias only.
- Validation URL: `https://codex-validation.seba-treasure-hunt.pages.dev`.
- Validation remains publicly reachable by URL and sends `X-Robots-Tag: noindex, nofollow`.
- Production, custom domains, DNS, production D1 and production media were not changed.
- Validation identities, submissions, uploads and moderation decisions are disposable and must be reset before launch.

## Verified MVP path

The following checks used disposable validation-only data:

1. Hunter development identity loads from the stable validation alias.
2. Email/password policy is 12+ characters with compromised-password checks and verified email.
3. Clerk lifecycle webhook synchronized a verified Hunter identity into validation D1.
4. Hunter password sign-in, private profile completion and Privacy/Media acceptance completed.
5. Participation Waiver `2026.1` was reviewed, accepted and stored separately from Privacy/Media acceptance.
6. Participation unlocked all 12 approved direction links.
7. A Field Note was submitted privately, loaded in the staff moderation ledger, approved and then appeared on the public clue board.
8. A private report was submitted through the browser form.
9. A second private report included a PNG; the private R2 upload was queued and reached `ready` in validation D1.
10. A disposable Staff principal was invited and activated; the authenticated Ops dashboard returned 200 and loaded the live validation moderation counts.
11. Validation Turnstile uses Cloudflare's official always-pass test key. The bypass is enabled only when `DEPLOYMENT_ENV=validation`; production retains strict action and hostname checks.

## Automated evidence

- `npm test`: 198/198 static/contract tests and 284/284 TypeScript tests passed on the final MVP candidate.
- `npm run typecheck`: passed.
- `npm run build`: passed; Pages Worker approximately 317.1 kB and media Worker 3.2 kB.
- `npm run legal:verify`: passed.
- `npm run verify:waiver-qa`: passed with 251 observed requests, zero external writes, zero forbidden provider attempts and zero privacy findings.
- `npm run verify:unified-shell-qa`: passed across 72 navigations and 111 responsive/focus states with zero console or page errors.
- Provider keys are normalized before environment scoping; validation accepts development keys only and production accepts live keys only.
- Clerk's documented omitted `azp` claim is accepted after signature/issuer verification; a present malformed or unapproved `azp` remains rejected.

## Known ship blockers

1. Microsoft Graph delegated authorization is not complete. The waiver acceptance is stored, but its receipt is currently `pending`; no real email was sent.
2. One clean-browser Staff UI sign-in still needs confirmation after disabling Client Trust. The same disposable Staff identity and session token passed the complete Ops authorization and moderation API path.
3. The Hunter password-recovery email-code path still needs one real mailbox round trip.
4. The Clerk webhook signing secret exposed during setup QA must be rotated by the account owner, then the replacement must be stored in Cloudflare Preview and the validation alias redeployed.

## Ranked post-MVP wishlist

### Before public launch

- Add visible per-waypoint `saved`, `visited` and `searched` controls to the Hunter Dashboard. The protected API exists, but the current dashboard only renders directions and status.
- Add a validation reset command that recreates disposable Clerk users, D1 activity/legal rows and validation media deliberately rather than deleting immutable ledgers ad hoc.
- Re-run the full disposable flow from a clean browser after Graph and Staff-provider activation.
- Verify the four intended administrator addresses through provider invitations and remove the disposable MVP Staff principal.
- Replace Cloudflare Turnstile test keys with a real production widget and verify every production action/hostname.
- Rehearse production migrations `0003`–`0010` from a backup before any live deploy.

### After launch

- Ops UI for zone/rule editing and explicit kill-switch controls.
- CSV exports, hunt-broadcast email and notification scheduling.
- Sponsor directory/logo workflow and campaign analytics.
- Social/Facebook integrations, hotline, video/gallery and AEO refinements.
- Side quests, golf balls, clue coins and physical clue-station workflows.

## Resume point

Create or select the Microsoft Entra application for `tech@sebahub.com`, obtain its public client ID and tenant ID, run the repository's delegated device-login helper, and store the resulting Graph values only as Cloudflare Preview secrets. Send one controlled waiver receipt, verify it arrives from `tech@sebahub.com` with Reply-To `casey@sebahub.com`, then rotate the Clerk webhook secret and rerun the clean-browser Staff and password-recovery checks. Do not touch production until Murphy approves the tested validation release.
