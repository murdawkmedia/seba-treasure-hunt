# Paid Clues and Decoder MVP — validation record

Date: 2026-08-07

Source commit: `b14f552`

Immutable deployment: `https://0f765e7b.seba-treasure-hunt.pages.dev`

Stable validation page: `https://codex-validation.seba-treasure-hunt.pages.dev/clues?release=b14f552`

## Scope

This validation-only release adds the 30-record Clues case file, optional
$5 CAD decoder orders, manual Interac claim verification, durable purchaser
and opted-in-hunter email notices, the My Hunt decoder ledger, and the private
Clues & Decoder Sales Ops workspace. It does not change the 13 Stops, legal
documents, report workflow, item ledger, or production deployment.

## Validation data and privacy

- Preview migrations `0024_paid_clue_decoder.sql` and
  `0025_clue_notification_jobs.sql` were applied only to the validation D1
  database.
- The guarded importer verified the `validation` environment sentinel before
  every read or write.
- All 30 reviewed clue records are present. Clue 01 is Released; Clues 02–30
  are Draft.
- A second importer pass found 30 existing records and zero missing records,
  proving the import is idempotent.
- The reviewed source remains in the gitignored `.private/` controller area.
- A post-build scan passed across 356 text assets. Sealed titles, riddles,
  decoders, narrowing answers and private notes are absent from public output.
- Validation payment instructions cannot receive real money and do not expose
  the production Interac address.

## Verification evidence

- Legal document verification: passed.
- TypeScript worker, client and test projects: passed.
- Complete automated suite: 688 passed, 0 failed.
- Production build: passed.
- Unified responsive shell QA: 78 page/view navigations, 120 audited states,
  23 screenshots, and zero console, page, request or write-boundary errors.
- Waiver/account browser QA: passed with 1,236 isolated requests and zero
  unexpected console, privacy or network-boundary findings.
- Validation API smoke:
  - runtime environment is `validation`;
  - 30 public-safe clue projections are returned;
  - exactly one is Released and 29 are Sealed;
  - Clue 01 exposes its public riddle but no decoder or narrowing answer;
  - Clue 02 exposes only `Clue 02 — Sealed`;
  - anonymous My Hunt, Ops clue and Ops payment-ledger requests return 401.
- Production remained unchanged: its runtime still reports `production`, its
  homepage returns 200, and `/api/v1/clues` remains unavailable there.

## Owner acceptance

1. Open the stable validation Clues page signed out and confirm that Clue 01 is
   readable while Clues 02–30 are visibly sealed.
2. Sign in with a disposable validation hunter and open **My Hunt → My
   Decoders**.
3. Create a Clue 01 decoder order. Confirm the page explicitly says it is a
   validation test and not to send money.
4. Submit a test sender name, then confirm **Waiting for verification** and the
   reusable reference remain visible after refresh.
5. In validation Ops, approve the test order and confirm the decoder unlocks
   even if email delivery needs a retry.
6. Review the Clues & Decoder Sales workspace. Do not release Clue 02 until its
   private copy has been reviewed and deliberately moved from Draft to Ready.

Production promotion remains blocked until Murphy explicitly approves this
immutable candidate. Before any later production promotion, export production
D1, apply migrations once, run the guarded production importer with both
production confirmations, and complete the documented smoke/rollback checks.
