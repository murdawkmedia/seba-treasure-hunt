# Paid Clues access refinement — validation record

Date: 2026-08-07

Source commit: `6ba4236`

Immutable deployment: `https://a82d6173.seba-treasure-hunt.pages.dev`

Stable validation page:
`https://codex-validation.seba-treasure-hunt.pages.dev/clues?release=6ba4236`

## Scope

This validation-only release refines the paid-clue MVP so released clues do
not require payment. Clue 01 is a complete public sample. Later riddles become
public when released, and their decoders are included for active signed-in
hunters. A signed-in hunter may buy $5 CAD early access only to the exact next
Ready clue; no later clue or bundle is offered.

The release also adds an explicit, tightly bounded controlled-digging permit
for an individual clue and published open zone. The default remains no digging.
No scheduler, banking integration, automatic release, or production change is
included.

## Access and operations rules

- Clue 01 exposes its riddle and decoder publicly as the sample.
- Clues 02–30 release manually and sequentially at irregular times.
- Released titles and riddles are public. Their decoders require an active
  hunter account but no purchase.
- Only the exact next Ready clue can be bought in advance.
- A waiting transfer blocks release. Created but unclaimed carts are cancelled
  atomically when that clue releases.
- Approval requires an Ops user to attest that Tim confirmed the Interac
  e-Transfer cleared. The timestamp is stored with the audited decision.
- Retraction returns a Released clue to Draft for review.
- Decoder Paid/Free toggles have been removed because access is derived from
  clue state and hunter entitlement.
- Exact digging instructions are shown only to a signed-in hunter with the
  current waiver, and only while the selected zone is published and open.
- The controlled permit is limited to marked loose sand, the stated tools, and
  at most 300 mm / 12 inches (or a smaller clue-specific limit). Closures and
  stop conditions override every permit.

## Validation evidence

- Validation D1 sentinel returned `validation` before any write.
- Preview migration `0026_clue_early_access_confirmation.sql` applied cleanly;
  a second migration check reported no migrations remaining.
- Complete automated suite: 695 passed, 0 failed.
- Worker, client, and test TypeScript projects: passed.
- Authoritative legal-document generation check: passed.
- Production build: passed.
- Deploy-output privacy scan: 56 served static files passed.
- Git staged-diff hygiene: passed.
- Remote API smoke on the immutable deployment:
  - `/clues` returned 200 and displayed the validation notice;
  - `/api/v1/clues` returned 30 records;
  - Clue 01 was Released with riddle and `public_sample` decoder access;
  - Clues 02–30 exposed no sealed titles or riddles;
  - signed-out My Hunt and Ops clue APIs returned 401.
- Desktop and 390 px mobile browser smoke found no horizontal overflow on
  Clues, My Hunt, Waiver, or Rules, and no unexpected console errors. The
  signed-out Case Room emitted only its expected 401 authentication probes.
- Production remained unchanged: its homepage returned 200, displayed no
  validation notice, and `/api/v1/clues` remained 404.

## Owner acceptance

1. Open the stable validation page signed out. Confirm Clue 01 shows the full
   sample while Clues 02–30 reveal no private copy.
2. In validation Ops, review Clue 02 and move it from Draft to Ready.
3. Sign in with a disposable validation hunter. Confirm Clue 01 is included
   without payment and Clue 02 is the only early-access purchase offered.
4. Submit a disposable test transfer claim. In Ops, confirm approval requires
   the Tim-cleared-payment attestation and unlocks Clue 02 immediately.
5. Confirm a waiting claim blocks release. After resolving it, release Clue 02
   and verify its riddle becomes public and its decoder is included for any
   active signed-in hunter.
6. Configure a disposable clue-specific digging permit only against a
   published open validation zone. Confirm anonymous visitors cannot see the
   exact permit, and a signed-in hunter with the current waiver can.

Production promotion remains blocked pending Murphy's approval of this exact
candidate. Before promotion, capture a fresh production D1 export and baseline,
apply migration `0026` once, preserve all live records and versions, deploy the
immutable source commit, and run the production smoke and rollback checklist.
