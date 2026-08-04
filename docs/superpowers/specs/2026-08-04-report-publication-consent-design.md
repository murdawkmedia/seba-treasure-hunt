# Report Publication Consent Design

## Goal

Make a hunter's report-time publication choice visible to operators and authoritative for every Case Note or Official Update publication path.

## Decision

`publicationPreference: "private"` is an absolute publication lock. Staff may continue private review and follow-up, but cannot select public media, draft, schedule, or publish a Case Note or Official Update. Publication can become available only after a separate, audited hunter-consent change is implemented and recorded; this change does not add an operator override.

`publicationPreference: "share_after_review"` means the report may enter the existing editorial review flow. It never publishes automatically and remains subject to account, legal, attribution, report-state, and media checks.

## Operator experience

The private report facts panel shows distinct rows for:

- `Hunter / account`: private account classification used by staff.
- `Case Note credit`: the stored privacy-safe public attribution (`display name`, Hunter handle, `Community Hunter`, or `Young Hunter`).
- `Hunter sharing choice`: either `Share after staff review` or `Keep private — public publishing locked`.
- `Finder sharing notice`: the accepted notice version and timestamp, or a clear legacy-record explanation.

When the choice is private, the review banner and public-destination controls explain that publication is locked by the hunter's selection. Private report content remains visible only in the authenticated operator view.

## Enforcement

The D1 publication preview is the source of truth for both UI and mutations. It reads `private_reports.publication_preference` and returns:

- `publicationEligible: false`
- `publicationEligibilityReason: "hunter_requested_private"`
- the safe attribution snapshot, when one exists, for staff context only

Both Case Note and Official Update mutations already require a publication-eligible preview, so adding the preference check there blocks direct API calls as well as browser actions. The in-memory test store mirrors the same rule.

Legacy records without a stored preference remain private because the existing row mapping defaults missing values to `private`.

## Verification

- UI regression: the private facts panel names the safe Case Note credit and the exact sharing choice.
- UI regression: private reports present a publication-lock explanation and disabled public controls.
- D1 regression: Case Note publishing rejects a private report.
- D1 regression: Official Update drafting/publishing rejects a private report.
- Positive regression: `share_after_review` reports retain the existing reviewed-publication flow.
- Full unit, integration, typecheck, and build gates remain green.
