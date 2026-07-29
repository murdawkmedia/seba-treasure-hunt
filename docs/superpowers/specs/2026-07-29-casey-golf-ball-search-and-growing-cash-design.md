# Casey's Golf-Ball Search and Growing Cash Story

**Date:** 2026-07-29  
**Status:** Approved design  
**Project:** Tim Lost Something?  
**Release boundary:** Validation first; production requires separate owner approval

## Objective

Expand the public story without confusing its two searches:

- Tim remains the lead treasure case. His government ID and two diamond rings
  remain missing, and the cash believed to be in the search area has grown.
- Casey becomes the public contact for a separate set of specially marked
  In the Woods golf balls that may be redeemed for festival tickets.

The result must preserve the Documentary Case File direction: suspenseful,
conversational, community-led and lightly playful. It must not become a
cartoon side quest, a pirate story or a separate festival-themed microsite.

## Facts in Force

### Tim's case

- Tim originally lost his government ID, roughly $5,000 in cash and two
  diamond rings during the established route story.
- The ID has not been found.
- Both diamond rings remain missing in separate small baggies across the wider
  search area.
- Tim continues retracing his steps while looking for the ID.
- Cash keeps falling out while he searches. The amount now believed to be in
  the search area is approaching $10,000.
- The source and exact amount of the additional cash remain intentionally
  mysterious.
- Approximately $10,000 is an estimate, not an exact guaranteed prize pool.
- A location that produced nothing earlier may contain something later.

### Casey's golf balls

- Casey lost specially marked golf balls bearing the official In the Woods
  logo.
- The balls are hidden around SebaHub properties and throughout the wider area
  where people are already searching.
- Ordinary unmarked golf balls do not qualify.
- The current working offer is one qualifying ball for one In the Woods Music
  Festival ticket.
- The ball must be returned when redeemed.
- Casey is the only public redemption contact for now.
- Casey may be reached at `casey@sebahub.com` or in person at the SebaHub
  School, Monday through Friday.
- The verified festival website is
  `https://www.inthewoodsmusicfestival.com/`.
- Finer redemption terms remain pending and may be updated.

## Information Architecture

Use two connected but clearly separated searches.

### Homepage

Tim's case remains the primary story. Refresh the homepage facts so `$5,000`
is described as the initial missing amount rather than the current total.
Explain that Tim keeps retracing the route, his ID and rings remain missing,
and the estimated cash now approaches $10,000.

Add a concise secondary teaser after the primary Tim evidence and story:

> **Casey lost something too.**  
> Specially marked In the Woods golf balls are now hidden throughout the same
> wider search area. Find one and it may be worth a ticket to the festival.

The teaser action is **Follow Casey's golf-ball search** and links to
`/golf-balls`.

### Dedicated golf-ball page

Create the public route `/golf-balls`.

- Navigation label: **Golf Balls**
- Page title: **Casey Lost the Golf Balls**
- No sign-in is required.
- No separate map is introduced.
- Existing search boundaries and safety rules remain authoritative.
- The page uses the shared public shell, footer, typography, spacing, status
  components and Documentary Case File visual language.

The page explains this simple flow:

1. Look for golf balls bearing the official In the Woods logo.
2. Confirm the ball is specially marked; ordinary balls do not qualify.
3. Return a qualifying ball directly to Casey.
4. The current offer is one qualifying ball for one festival ticket.
5. Coordinate with Casey by email or visit the SebaHub School Monday through
   Friday.

Primary actions:

- **Email Casey** — `mailto:casey@sebahub.com`
- **Visit the festival website** —
  `https://www.inthewoodsmusicfestival.com/`
- **Read the search rules** — `/rules`

The page must work without a new image. An authentic photograph of a marked
ball may be added later when one is supplied and approved.

### Official updates

The existing Updates page remains the canonical public source for dated
developments. No database or update-category schema is added in this release.
Operators may distinguish the two searches in an update's headline or body
using plain labels such as **Tim's case** or **Casey's golf balls**.

## Public Copy Direction

Recommended homepage framing:

> **Tim's still looking.**  
> His ID and two diamond rings are still missing. The search began with roughly
> $5,000 in cash—but Tim keeps retracing his steps, and cash keeps falling out
> along the way. The amount now believed to be out there is approaching
> $10,000. A place that came up empty last week may not be empty today.

Recommended golf-ball page framing:

> **Casey lost the golf balls.**  
> Look for specially marked balls carrying the In the Woods logo throughout the
> wider search area. Find one, return it to Casey, and the current offer is one
> ball for one In the Woods Music Festival ticket.

Copy must:

- identify roughly $5,000 as the initial amount;
- qualify the current estimate as approaching or around $10,000;
- avoid promising an exact amount or exact availability;
- make clear that Tim lost the ID, cash and rings;
- make clear that Casey lost the marked golf balls;
- avoid claiming that Casey administers Tim's treasure;
- avoid claiming that Tim lost the golf balls;
- use `In the Woods` consistently;
- avoid inventing limits, dates, office hours or redemption conditions.

## Compatibility and Scope

This is a static public-content and navigation release.

In scope:

- homepage copy and teaser;
- dedicated `/golf-balls` page;
- shared public navigation and footer routing;
- sitemap, canonical, SEO, social metadata and truthful structured data;
- focused copy, route, build and responsive tests;
- documentation and validation deployment.

Out of scope:

- database or API changes;
- account, authentication, waiver, report or moderation changes;
- a new route map or new exact search coordinates;
- changes to Tim's 13 Stops;
- changes to the 19-entry Tim's Account;
- reintroducing the removed interview golf-ball question;
- a new ticket inventory or redemption database;
- new Ops categories;
- a production deployment without separate owner approval.

## Safety, Accessibility and Error Handling

- Link to the existing search rules and restricted-area guidance.
- Do not imply that a marked ball authorizes entry into private, restricted or
  hazardous areas.
- External festival links must have clear accessible names and safe external
  link behavior.
- Email and website actions remain ordinary links; no new form or data
  collection is introduced.
- The page must remain usable without images, JavaScript or an authenticated
  session.
- Preserve keyboard navigation, visible focus, reduced-motion behavior,
  semantic headings and the supported 320-pixel minimum width.
- If the festival website is temporarily unavailable, the Casey email contact
  remains sufficient for redemption coordination.

## Testing and Release

### Content integrity

- Confirm every public `$5,000` claim either identifies the initial loss or is
  updated to the qualified growing-cash story.
- Confirm the current amount is never presented as an exact guarantee.
- Confirm the ID and both ring baggies remain officially missing.
- Confirm only marked In the Woods balls qualify.
- Confirm Casey is the only listed redemption contact.
- Confirm the verified festival URL and Casey email are correct.
- Confirm Tim's Account remains exactly 19 entries and contains no restored
  golf-ball question.

### Technical and visual verification

- Replace the broad test that prohibits all public golf-ball references with a
  scoped contract allowing the approved homepage teaser and `/golf-balls`
  page while continuing to forbid unintended references elsewhere.
- Verify `/golf-balls` builds, routes canonically and appears in the sitemap.
- Verify the shared navigation exposes **Golf Balls** consistently without
  breaking mobile header geometry.
- Verify metadata and structured data describe the two searches truthfully.
- Run the existing legal, typecheck, test and production-build gates.
- Review the homepage and golf-ball page at 320, 390 and desktop widths.
- Check keyboard behavior, focus visibility, contrast, wrapping, overflow,
  broken links and browser-console output.

### Release sequence

1. Implement and verify locally.
2. Deploy the exact tested artifact to the validation environment only.
3. Complete owner review on desktop and phone.
4. Promote the exact approved artifact to production only after Murphy gives
   explicit production approval.

No production database, R2 object, queue, identity provider, DNS or public
content is mutated during the validation release.
