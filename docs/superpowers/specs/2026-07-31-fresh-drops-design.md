# Fresh Drops: Public Teaser and Signed-In Hunter File

**Date:** 2026-07-31

**Status:** Approved in conversation; written specification awaiting owner review

**Target:** Isolated validation first. Production remains unchanged until the
exact validation candidate receives separate owner approval.

## Summary

Add the newly supplied July 31 photographs and hidden objects to the approved
Full Investigation Board without expanding or renumbering the established 13
places.

The approved presentation is **public teaser plus signed-in Fresh Drops**:

- signed-out visitors see one or two selected new items and understand that the
  case has expanded;
- signed-in hunters receive the complete Fresh Drops story and item gallery
  inside My Hunt; and
- the current Clerk accounts, legal acceptances, 13-place route, private
  progress, reporting, moderation, Ops permissions, media processing and audit
  systems remain authoritative.

Access control must be enforced by the server. Hunter-only source images and
derivatives must not be included in public HTML, public JavaScript bundles,
static public asset directories or unauthenticated API projections.

## Source material and established facts

The supplied source set is:

`<local Fresh Drops source directory>`

It contains 21 JPEG files and `CONTEXT.md`. The originals are small, real-world
source photographs. They must remain unchanged in a private, non-deployed
source archive. Processing creates separate responsive derivatives and never
overwrites an original.

Inspection found no usable EXIF capture time, GPS or orientation records in
the JPEG files. The application must not infer or manufacture a forest
location. No exact location from this source set is written into the public
site, the hunter file or the 13-place route.

The approved use of the forest sequence is:

- use `01-IMG_5645.jpg`;
- omit sideways `02-IMG_5646.jpg`;
- use `03-IMG_5647.jpg`; and
- use `21-image000001.jpg` as the selected photograph of Tim in the leaves.

The forest sequence may explain, in qualified language, that Tim went looking
again, an elastic appears to have broken and more cash may have fallen out. It
must not state an exact new cash amount as a verified fact or imply that the
photographs reveal a search location.

All pictured objects in `04` through `20` are currently out there. The new
records do not promise that finders keep an item unless staff deliberately
confirms that rule for the individual record.

## Considered approaches

### A. Public teaser plus signed-in Fresh Drops — selected

Show a small public preview and place the complete new-drop file inside My
Hunt. This keeps the public story understandable, rewards account creation and
does not turn the homepage into a long prize catalogue.

### B. Expand the entire public evidence wall — rejected

Show every new item publicly. This is transparent and searchable but removes
the signed-in benefit, overwhelms the primary case and makes recurring drops
harder to present.

### C. Separate fully gated page — rejected

Hide all new content behind authentication. This creates the cleanest boundary
but gives signed-out visitors too little reason to understand or join the
expanded search.

## Information architecture

### Public evidence board

The existing public case facts remain available according to their current
audience settings. The homepage adds one compact Fresh Drops teaser after the
primary case facts.

The initial teaser uses:

- the instant camera from `16-IMG_5615.jpg`; and
- the toy car from `06-IMG_5628.jpg`.

The choice is data-driven. Staff may later change which one or two items appear
without editing source code. The teaser contains a single prominent action:
**Sign in to see Fresh Drops**. A hunter who is already signed in goes directly
to the Fresh Drops section.

The teaser does not expose a count that must be maintained manually, hidden
object keys, private image URLs, exact locations or implied guarantees about
availability.

### My Hunt: Fresh Drops

Add a clearly labelled Fresh Drops section to My Hunt. It is a list and gallery
of current items, not a fourteenth place, a second map or a second progress
system.

The section opens with the three-image forest story using photographs `01`,
`03` and `21`, followed by ordered evidence cards for all active new items.
Desktop may use the approved investigation-board composition. Mobile and
assistive-technology reading order uses stacked semantic cards.

Each item card contains:

- public-safe title and short description;
- authoritative status;
- one to three processed photographs with alt text;
- a full-image viewer that works by mouse, keyboard and touch; and
- **I found this**, which opens the existing private-report flow with the item
  selected.

The report still permits **Not sure** and **Something else**. Selecting an item
does not publish a report, reveal a location or change the item status.

No points, rankings, public progress, item-specific checklists or new
navigation tab are introduced. Fresh Drops is reached through My Hunt and
through the public teaser return path.

## Initial item catalogue and media grouping

Use stable records and avoid duplicate items when multiple photographs show
the same object.

| Source | Item treatment |
| --- | --- |
| `04-IMG_5630.jpg` | Jewellery assortment |
| `05-IMG_5629.jpg` | Packaged miniature figures |
| `06-IMG_5628.jpg` | Toy car; initial public teaser |
| `07-IMG_5627.jpg` | Boxed collectible |
| `08-IMG_5625.jpg` | Wallet |
| `09-IMG_5622.jpg` | Beaded mystery item |
| `10-IMG_5621.jpg` | Gold-tone jewellery |
| `11-IMG_5620.jpg` | Spider brooch |
| `12-IMG_5619.jpg` | Attach to the existing Apple Watch record; alt text describes only what is visibly shown |
| `13-IMG_5618.jpg` | Analog wristwatch |
| `14-IMG_5617.jpg`, `19-IMG_5612.jpg` | One sunglasses-and-case item with two views |
| `15-IMG_5616.jpg` | Boxed mystery item; preserve the uncertainty |
| `16-IMG_5615.jpg` | Attach to the existing camera record; initial public teaser |
| `17-IMG_5613.jpg`, `18-IMG_5614.jpg` | One games/media stack with two views |
| `20-IMG_5610.jpg` | Assorted mystery items |

The existing purse record remains active without attaching an uncertain source
photograph. The implementation must update the existing camera and Apple Watch
records by stable identifier rather than seed duplicates.

All new item records begin as **Out there**. Existing audited statuses continue
to apply: Draft, Out there, Found, Paused and Archived. Ops may reverse or
change a status through the existing versioned workflow.

## Data and authorization design

Extend the existing dynamic case-item system rather than create an unrelated
content store.

Each item needs an audience value or equivalent authoritative setting:

- **public** — available through the public-safe item projection;
- **public teaser** — eligible for the Fresh Drops teaser; or
- **hunter only** — returned only to an authenticated, participation-unlocked
  hunter.

Media visibility must be enforced independently so an item cannot accidentally
make a private source or derivative public. New item media defaults to hunter
only. Enabling a public teaser requires an explicit item choice and explicit
teaser-safe media selection.

Existing public item interfaces keep their compatibility and exclude
hunter-only records and media. Add an authenticated Fresh Drops projection,
conceptually `GET /api/v1/me/fresh-drops`, which returns only the current
hunter-safe fields and media references after the server verifies:

- an active Clerk hunter session;
- a valid player record; and
- current participation access under the existing legal rules.

Hunter-only derivatives must be delivered through an authenticated media path
or an equally strong existing private-media mechanism. Object keys are not
returned as guessable public URLs. An expired session returns an authentication
response that the client can use to sign in and resume at Fresh Drops.

The selected item may be passed to the existing private-report flow by stable
item identifier. Report storage records the identifier and an immutable
public-safe title snapshot so later item renaming does not make an old report
ambiguous.

Item and media audience changes, ordering, status changes and source-media
changes append events to the existing item audit history and use optimistic
version checking.

## Media handling and privacy

- Preserve every supplied JPEG unchanged in a private source archive excluded
  from Git and the public build.
- Process uploads through the existing validation R2/media pipeline.
- Strip metadata from every web derivative even though this source set contains
  no usable GPS.
- Generate appropriately sized browser derivatives; do not enlarge these small
  photographs into hero images.
- Use small evidence cards and full-image containment so the entire image is
  visible without destructive cropping.
- Keep the original aspect ratio and provide a responsive WebP or equivalent
  derivative supported by the existing pipeline.
- Use factual alt text. Do not infer brand, material, value or provenance from
  an unclear photograph.
- If derivative processing fails, retain the previous working media, keep the
  failed replacement private and show Ops a recoverable error.
- A missing hunter image produces a readable evidence card rather than a broken
  image icon.

## Ops workflow

Extend the current **What's Out There** editor with clear controls for:

- item title, description, owner, status and order;
- up to three processed images and their order;
- alt text;
- hunter-only audience;
- explicit public-teaser selection; and
- an exact public and signed-in preview.

Hunter only is the safe default. The interface must state that selecting a
teaser makes the chosen item facts and chosen derivative publicly accessible.
Only one or two Fresh Drops items may be active in the homepage teaser at a
time; saving a third must require choosing which current teaser to replace.

The existing announcement action may create an Official Update draft from an
item. It never publishes automatically. Changing an item audience or status
also does not automatically publish Latest News.

## Authentication and return behavior

A signed-out visitor choosing the Fresh Drops action enters the existing
simplified account/sign-in flow. Preserve the intended destination through
sign-up, both separate legal acceptances, email verification and sign-in. After
successful verification, return the hunter directly to My Hunt with Fresh
Drops in view.

A signed-in but participation-locked account receives the existing clear legal
or profile-completion requirement. It does not receive hunter-only item data or
media until participation is unlocked.

If the account session expires while the gallery is open, already rendered
content may remain visible in that browser view, but subsequent private media
or data requests fail closed and offer the resume-after-sign-in path. The
client must not repeatedly retry an unauthorized request.

## Accessibility and responsive behavior

- Keep one semantic heading and card order independent of the desktop evidence
  board's visual placement.
- At mobile widths, use one stacked column with large touch targets and no
  pan-and-zoom canvas.
- The image viewer traps focus correctly, closes by button and Escape, restores
  focus to the originating thumbnail and supports swipe-independent controls.
- Status is expressed in text, not colour alone.
- Provide visible focus, reduced-motion behavior and at least 44-pixel primary
  targets.
- The teaser and full gallery remain understandable when images fail or custom
  styling is unavailable.

## Error handling

- Public item APIs never fall back to returning hunter-only records.
- A partial item/media seed is idempotent and may be retried without creating
  duplicates.
- The client distinguishes sign-in required, participation required, media
  processing, unavailable media and temporary network errors.
- Failed report prefill preserves the selected item locally and still opens the
  ordinary report choices.
- Concurrent Ops edits return a version conflict and require refreshing the
  current record before retrying.
- No automatic status, audience, report or publication change occurs after a
  failed request.

## Test strategy

### Data and authorization

- Prove all existing item records retain their identifiers and statuses.
- Prove new seeds are idempotent and the camera and Apple Watch are updated,
  not duplicated.
- Prove the public item API excludes every hunter-only item and media record.
- Prove hunter-only data and media return authorization failures to guests,
  incomplete accounts and expired sessions.
- Prove an eligible hunter receives every active Fresh Drops item in the
  configured order.
- Prove audience, status, media and order changes create append-only audit
  events and respect optimistic versions.

### Content and media

- Reconcile all 21 supplied images into used, grouped or deliberately omitted
  classifications.
- Confirm `02` is omitted and `01`, `03` and `21` form the hunter-only forest
  sequence.
- Confirm `14` plus `19` and `17` plus `18` create two multi-image items rather
  than four item records.
- Confirm every derivative is metadata-free and no GPS is exposed or invented.
- Confirm every active item image returns successfully and no broken placeholder
  appears.
- Confirm the complete uncropped image is available through the accessible
  viewer.

### User experience

- Verify signed-out visitors see the camera and toy-car teaser but none of the
  hunter-only gallery.
- Verify sign-up, legal acceptance, verification and sign-in return the hunter
  to Fresh Drops.
- Verify **I found this** opens a private report with the correct stable item
  selected and retains Not sure and Something else.
- Verify the established 13 places, their order, map gating and private
  progress are unchanged.
- Verify desktop, 390-pixel phone, 320-pixel phone, keyboard, reduced-motion
  and zoomed layouts without horizontal overflow.

### Regression and privacy

Run the complete existing typecheck, unit, integration, authorization, Clerk,
legal-ledger, route, report, moderation, Ops, media, accessibility, static
content, credential, output-privacy, broken-link, browser-console and
production-shaped build checks.

## Validation and release sequence

1. Inventory the exact working tree and preserve unrelated changes.
2. Copy the original source set into the approved private, Git-ignored source
   archive and process only derivatives into validation media storage.
3. Implement schema/API behavior test-first and apply any migration only to the
   isolated validation D1 database.
4. Seed or update the validation item records idempotently.
5. Exercise signed-out, incomplete-account, signed-in-hunter and Ops paths on
   desktop and phone.
6. Confirm production users, submissions, D1, R2, queues, Clerk configuration,
   Pages and DNS were not mutated.
7. Freeze an immutable validation candidate and provide the stable and
   immutable review links.
8. Promote only the exact approved candidate after separate explicit owner
   approval, a fresh production D1 backup/export and rollback preparation.

## Assumptions and decisions in force

- The 13 established places remain exactly as they are.
- Fresh Drops is a gallery inside My Hunt, not a new place list or progress
  system.
- The full July 31 gallery is available only to participation-unlocked hunters.
- The instant camera and toy car are the initial public teaser items.
- `01`, `03` and `21` are hunter-only story evidence; `02` is unused.
- No source photograph contains usable location metadata, and no location will
  be inferred.
- All pictured objects in `04` through `20` begin Out there.
- Newly pictured objects carry no finder-keeps promise until Ops explicitly
  confirms one.
- Existing legal documents and authoritative legal language remain unchanged.
- Production remains untouched until the validation candidate is separately
  approved.
