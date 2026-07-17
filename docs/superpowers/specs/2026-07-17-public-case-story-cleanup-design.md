# Public Case Story Cleanup Design

**Status:** Approved direction, written for implementation review  
**Date:** 2026-07-17  
**Environment:** Validation first; production promotion remains separate

## Objective

Keep the public experience inside the believable local-mystery story. Remove
language and navigation that make the experience sound like a marketing
campaign, and temporarily withdraw public sponsorship discovery while the
community story is being established.

## Public copy changes

- The shared brand subline becomes **“Tim lost his ID”**. Remove “This year”
  wherever it appears publicly.
- Public route language becomes **“13 Stops”** or **“13-stop route”**. Remove
  “Lucky” from navigation, headings, filters, forms, metadata and explanatory
  copy.
- Replace public-facing uses of “campaign” with “case” or a natural
  case-specific phrase. This includes headings, labels, status explanations,
  metadata, image alternatives and fallback copy.
- Public attribution that currently reads “Campaign operator,” “Campaign Ops”
  or equivalent becomes **“A representative from SebaHub.”** Stored legacy
  publisher values, private audit records and internal identifiers remain
  unchanged.
- Leave authoritative Privacy Policy, Media Notice and Participation Waiver
  bodies unchanged even where their approved legal language uses “campaign.”
- Leave internal CSS classes, module names, API paths, database columns,
  analytics actions and test identifiers unchanged unless a public value would
  otherwise leak through them.

## Fictional ID presentation

Show the fictional ID reference only once in the public case narrative. Its
visible disclosure is exactly:

> A visual representation of what Tim’s I.D. could look like.

Remove the separate “Campaign reference — not the missing card,” “A fictional
reference image,” and longer duplicate disclaimer presentation. Keep the real
blurred evidence bundle as the primary case evidence. The asset remains clearly
described as a visual representation and must never be represented as Tim’s
actual missing ID.

## Sponsorship withdrawal

Use public-build withdrawal rather than visual hiding:

- remove Support the Search/Sponsors from shared desktop and mobile navigation;
- remove the homepage sponsorship section and CTA entirely;
- remove `/sponsors` from the sitemap, canonical public route set, build output
  and public smoke/QA expectations;
- make direct public `/sponsors` and `/sponsors.html` requests unavailable in
  the validation candidate rather than serving hidden details;
- keep `sponsors.html`, its client source, the sponsor API and the private Ops
  sponsorship ledger in source for a later deliberate re-release;
- do not delete existing private sponsor inquiries or alter their database
  schema.

If the private source page is later re-enabled, its lead begins and ends with:
**“Help a local story gather momentum.”** The longer cash/prize/service pitch
is removed from current public sources.

## Shared-system implementation

Apply terminology changes through the shared campaign-shell generator and
public presentation helpers first, then update page-specific copy. This keeps
desktop/mobile navigation and all static pages consistent. Do not rename the
shell’s internal `campaign-*` classes or data attributes; they are technical
contracts, not visible story language.

Legacy public Update records with a stored publisher name such as “Campaign
Ops” must be mapped at the public presentation boundary to “A representative
from SebaHub.” Private Ops and audit views may retain the stored value.

## Testing and release boundaries

- Assert shared navigation contains **13 Stops**, does not contain “Lucky,” and
  has no public sponsorship destination.
- Assert the public build and sitemap omit `sponsors.html` and `/sponsors`;
  direct public sponsor routes are unavailable.
- Assert the homepage has no sponsorship section or CTA.
- Assert the fictional ID disclosure appears once with the approved sentence
  and no removed disclosure text remains.
- Scan rendered public HTML, metadata and client-visible strings for “This
  year,” “Lucky 13,” public “campaign” copy and legacy operator attribution.
  Exclude approved legal bodies and internal implementation identifiers.
- Verify private Ops sponsorship access/API behavior remains intact.
- Re-run unified shell, accessibility, metadata, broken-link, privacy, build
  and focused public API tests.
- Deploy only to `codex-validation` after all checks pass. Production remains
  unchanged until Murphy gives separate explicit approval.

## Alternatives considered

1. **Recommended: withdraw sponsorship at the build and route boundary.** This
   prevents discovery by navigation, search engines and direct URLs while
   preserving the private workflow for later.
2. Hide the sponsor link with CSS but continue serving the page. Rejected
   because direct links and crawlers would still expose the story-breaking
   details.
3. Delete all sponsor code and data. Rejected because the private workflow is
   useful later and deletion adds unnecessary risk.

