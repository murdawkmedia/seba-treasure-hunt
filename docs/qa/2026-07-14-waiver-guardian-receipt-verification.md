# Waiver, Guardian and Receipt Verification — 2026-07-14

This record verifies the local implementation of the Tim Lost Something? participation-waiver, guardian, legal-receipt and private Ops workflow. It does not authorize or record a deployment, database migration, provider configuration, credential access or real email.

## Scope and legal artifacts

- Participation waiver `2026.1`: SHA-256 `1a6e50f445fc7c67962e5e0050c7fbe161d7d78e679dab4f6fde951602cf3607`.
- Privacy Policy & Media Notice `2026.2`: SHA-256 `47e26763d46441e2e155a6d0ca3869986395c49b60073a8da9256577229f07a8`.
- D1 migrations `0006` through `0009` remain local-only and unapplied to validation or production.
- Validation data remains disposable. Production migrations, deployment, DNS and data remain unchanged.

## Automated verification

Run from the repository root:

```powershell
npm run legal:verify
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
npm run verify:waiver-qa
git diff --check
```

Recorded results:

- Legal generation check: passed; both generated contracts match the exact versions and hashes above.
- Static/contract tests: 88/88 passed.
- TypeScript tests: 194/194 passed.
- Worker, client, Worker-test and client-test TypeScript checks: passed.
- Production build: passed; Pages Worker 304.2 kB, media Worker 3.2 kB, client bundles produced successfully.
- Production dependency audit: exit 0 at the high threshold with zero high or critical findings. Twelve moderate findings remain in Clerk's optional Solana dependency chain; the offered complete remediation is breaking and was not forced into this release.
- Focused real-D1 integration passed through migration `0009`, covering replay, populated receipt reconciliation, acceptance eligibility rollback, current withdrawal ranking, lease fencing, interrupted-receipt replay, atomic Ops retry/private-view audit, append-only mutation rejection and atomic multi-identity rate limits.
- Receipt integrity tests confirm pending/failed replay recovery, sent-receipt silence and exact accepted waiver version/hash matching before rendering or provider access.
- Origin tests confirm browser write APIs reject missing, null, malformed, insecure canonical and unscoped origins while allowing exact canonical HTTPS, scoped HTTPS Pages previews and explicit local development origins.

## Local browser and request-boundary QA

`npm run verify:waiver-qa` builds an isolated temporary copy and exercises the actual built Dashboard, Ops, Clue Board and Report clients. Each invocation uses a unique `%TEMP%\tim-lost-waiver-qa-*` directory so parallel runs cannot delete or corrupt one another.

The successful run covered `/waiver`, Dashboard and Ops at 1440×1000, 390×844 and 720×500. It checked:

- exact legal rendering and print CSS;
- authenticated fixture bootstrap around the real client;
- 0, 1 and 10 supervised minors;
- guardian validation and focus routing;
- acceptance/reference and receipt pending, sent and failed states;
- participant resend and Ops retry;
- progress, waypoint/note, reply, private find-report and upload boundaries;
- horizontal overflow, console errors and axe WCAG 2.0/2.1 A/AA results.

The request ledger observed 232 browser requests. Local mocks handled three account bootstraps and one each for review, acceptance, participant resend and Ops retry. The run recorded:

- zero external writes;
- zero continued external requests;
- zero forbidden provider attempts;
- zero server writes; and
- zero blocked writes required to complete a scenario.

No Clerk, Resend, Turnstile or Cloudflare API received a write. No real email was sent.

## Privacy-output classification

The QA runner separately scanned production source, rendered public files, public browser bundles and private server/Ops bundles. It rejected fixture emails, minor identity/birth-year values, acceptance/job/provider IDs, credentials, exact coordinates, private notes and report evidence from public surfaces.

Recorded findings were zero for production-source leaks, rendered-public leaks and public-bundle leaks. Private implementation strings were classified in their private bundles rather than misreported as public disclosures.

## Approval gates

The following were not performed and require a new explicit authorization:

1. reconcile or apply validation migrations `0001`–`0009`;
2. open or use Clerk, Resend or Cloudflare credentials/private sessions;
3. configure preview-only identity, webhook, Turnstile, sender or secret values;
4. send a controlled real receipt;
5. deploy to `codex-validation`;
6. wipe disposable validation records after controlled testing; or
7. migrate/deploy production or change DNS/domains.

The next authorized phase, if approved, is a validation-only activation with one owner-controlled disposable account followed by a documented wipe. Production remains a separate later decision.
