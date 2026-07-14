# Participation Waiver, Guardian Flow, and Receipt Email Design

Date: 2026-07-13
Status: Approved design
Campaign: Tim Lost Something?
Document version: `2026.1`
Effective date: July 13, 2026

## Goal

Activate the supplied participation waiver as a separate legal requirement for the Tim Lost Something? hunter platform. An authenticated adult must open the waiver for review, actively accept it, and receive a complete email copy of what was accepted. A parent or legal guardian may include supervised minors without creating child accounts or collecting child contact information.

The implementation must preserve the platform's existing privacy, moderation, and safety boundaries. A valid waiver unlocks participation tools; it does not open restricted areas, publish private evidence, bypass moderation, or create marketing consent.

## Authoritative document

The owner-supplied document is the authoritative legal body. The following owner-approved corrections are part of the published version:

- Replace every campaign reference to “SebaHub Tim's Lost Wallet Mystery” or “Seba Beach Lost Wallet Mystery” with **“Tim Lost Something?”**.
- Publish the title as **“SebaHub Tim Lost Something? Participant Acknowledgement, Waiver and Release.”**
- Replace the emergency-number placeholder with **“In an emergency, I will call 911.”**
- Replace the unavailable campaign-hotline reference with **“the official website form or another contact method published on the campaign website.”**
- Normalize corrupted apostrophes and checkbox glyphs without changing meaning.

The canonical source will be one versioned structured legal document in the repository. The `/waiver` page, acceptance hash, plain-text receipt, HTML receipt, dashboard rendering, and tests must all derive from that source so the legal body cannot drift between surfaces.

The implementation records the exact canonical document SHA-256. Decorative page chrome, navigation, favicons, and unrelated markup do not affect the legal hash. Any material change to the legal body, participant obligations, release, guardian terms, or acceptance statement requires a new document version and fresh acceptance.

Publishing this owner-supplied text is an implementation action, not a legal opinion about enforceability. Production promotion remains subject to the owner's normal legal and operational sign-off.

## Final acceptance statement

The required checkbox will say:

> I have read and agree to the Tim Lost Something? Participation Waiver, Release and Rules. I understand that participation involves outdoor risks, that I must search only in approved areas, and that I participate voluntarily and at my own risk.

When minors are listed, a second required guardian confirmation will say:

> I confirm that I am the parent or legal guardian of each minor listed, that the information is accurate, and that I accept this agreement on their behalf. I will directly supervise them throughout their participation.

## Participant experience

1. A player creates or signs into a verified email/password hunter account through Clerk.
2. The player completes the required adult profile and separately accepts the Privacy Policy & Media Notice.
3. The onboarding screen links to `/waiver`. The waiver acceptance checkbox remains disabled until the active waiver has been opened for review.
4. Opening the link expands or opens the accessible waiver and records a version/hash-specific review event for the authenticated player. This proves that the document was opened, not that every word was read; the required checkbox is the participant's affirmative agreement.
5. The adult may enable **“I am registering supervised minors.”** Each minor row collects only:
   - full name;
   - birth year; and
   - the adult's parent/legal-guardian confirmation.
6. The player may add multiple minors, up to a defensive maximum of ten per acceptance. The platform collects no child email, phone, exact birth date, photo, login credential, public handle, progress record, or separate account.
7. The adult accepts the waiver. The server validates the active document version and hash, the matching review event, the acceptance statements, and all minor rows.
8. D1 records the acceptance and immutable participant snapshot, queues one legal receipt, and returns a confirmation reference.
9. Participation tools unlock immediately after the valid acceptance is stored. Email delivery status is reported separately and cannot undo or invalidate acceptance.
10. The success state says **“You're registered.”** It includes this approved operational reminder:

   > Save this confirmation and show it at the official clue station to receive your first clue. Registration does not permit entry into private, restricted or unsafe areas. Always follow the official map, posted signs and staff directions.

11. The dashboard exposes **View accepted waiver**, **Print**, and a rate-limited **Email my receipt again** action.

## Signed-in hunter capabilities

After profile completion and current legal acceptance, a player can:

- privately save and update their own waypoint progress;
- view gated exact guidance only while the case and applicable zone are open;
- submit Field Notes, comments, and images to the clue board for moderation;
- reply to published notes and flag unsafe or inappropriate content;
- submit a private tip, safety report, or potential find;
- upload the required private photo for a find claim; and
- view and resend their own waiver receipt.

These boundaries remain in force:

- A potential find is a private report and never auto-publishes.
- Public notes and images remain premoderated.
- Private evidence, exact locations, ID details, cash evidence, contact information, progress, legal records, and minor data never enter public or promotional output.
- Authentication and waiver acceptance never override restricted, hazardous, temporarily closed, or otherwise unavailable areas.

## Communication permissions

Legal receipt delivery is an essential transactional communication. It is sent to the account's verified email regardless of optional communication choices.

The two existing optional permissions remain separate and unchecked:

- **Email me Tim Lost Something? clue and hunt updates.**
- **Email me other SebaHub news and offers.**

Neither is required for registration or participation. The waiver checkbox never creates marketing consent, and receipt delivery never changes either permission.

## Privacy Policy version update

Collecting a supervised minor's name and birth year and delivering a legal receipt are material additions to the campaign's disclosed data handling. The Privacy Policy & Media Notice will therefore advance from `2026.1` to `2026.2`, effective July 13, 2026, with a newly computed canonical hash.

Version `2026.2` will disclose:

- the guardian flow's collection of each supervised minor's full name and birth year;
- the purpose of identifying who the adult accepted the waiver for;
- transactional waiver-receipt delivery to the adult's verified email;
- use of the configured email service provider for that delivery;
- the separation between legal receipts and optional hunt/marketing permissions; and
- the legal-acceptance retention and restricted staff-access boundaries for minor snapshots and receipt audit events.

Existing validation players who accepted `2026.1` must actively accept `2026.2` before using affected tools. The waiver remains a separate document and separate acceptance event; accepting either document never implies acceptance of the other.

## Data model

A new idempotent D1 migration will add:

### Legal review events

An append-only `legal_document_review_events` table records:

- event ID;
- hunter subject;
- document type, version, and hash;
- reviewed-at timestamp.

Acceptance requires a review event for the same authenticated subject and active waiver version/hash.

### Acceptance participant snapshots

An append-only `waiver_acceptance_participants` table links each participant snapshot to the existing `legal_acceptance_events` acceptance ID. It records:

- participant role: `adult` or `minor`;
- full name at acceptance;
- birth year for minors only;
- guardian-attested flag for minor rows.

The adult row snapshots the profile name at acceptance. Minor rows are not mutable profiles. A later waiver version creates a new acceptance and a new snapshot rather than rewriting history.

### Delivery audit

The existing `notification_jobs` outbox stores one automatic `waiver_receipt` job per acceptance. A unique kind/target constraint prevents accidental duplicate automatic jobs. A new append-only `notification_delivery_events` ledger records queued, attempted, sent, and failed events with:

- job ID;
- event type;
- provider name;
- provider message reference when returned;
- timestamp; and
- concise non-sensitive error code.

No email body, API key, raw provider response, or private route data is stored in the delivery ledger.

Legal and minor snapshots follow the Privacy Policy's legal-acceptance retention rule: they may be retained for 12 months or as long as reasonably required to document consent, resolve disputes, enforce agreements, or meet legal obligations, then deleted or anonymized where practical.

## API and transaction boundaries

The authenticated interfaces will be:

- `GET /api/v1/legal/waiver` — active public-safe document metadata and body projection.
- `POST /api/v1/me/waiver/review` — records that the authenticated player opened the active version.
- `POST /api/v1/me/waiver/accept` — validates and records acceptance, participant snapshots, and receipt job idempotently.
- `GET /api/v1/me/waiver` — returns only the current player's acceptance, covered participants, and receipt status.
- `POST /api/v1/me/waiver/receipt` — rate-limited deliberate resend for the current player.
- Staff-only receipt retry/read actions under the existing Ops authorization boundary.

The acceptance write is a single D1 batch/transaction boundary: legal acceptance, adult/minor snapshots, receipt job, and audit metadata either all persist or none do. Replaying the same idempotency key returns the original acceptance and does not create another legal event or automatic email job.

Profile/privacy completion and waiver acceptance remain separate operations and separate legal records. If waiver acceptance fails, the completed account/profile remains usable for retry but participation stays locked.

## Receipt email

Use the existing Resend integration pattern with a dedicated transactional sender configuration. The code will reference environment variable names only:

- `RESEND_API_KEY`;
- `LEGAL_RECEIPT_EMAIL_FROM`; and
- `LEGAL_RECEIPT_EMAIL_REPLY_TO`.

The full receipt is delivered as print-friendly HTML with a complete plain-text fallback. No PDF is generated. It contains:

- Tim Lost Something? and SebaHub identity;
- the adult participant's name and verified email;
- each covered minor's name and birth year;
- waiver title, version, effective date, and acceptance timestamp;
- confirmation reference;
- the exact acceptance and guardian statements;
- the complete canonical waiver body;
- current rules and `/waiver` links; and
- the clue-station/restricted-area reminder.

User-controlled names are escaped before HTML interpolation. The receipt contains no password, session information, exact directions, progress, report evidence, private location, or marketing content.

Only the first successful automatic delivery is automatic. A participant or authorized operator may deliberately resend the same accepted version; a resend creates another delivery event, not another acceptance.

## Delivery and failure handling

Recommended delivery model: **recorded acceptance plus transactional D1 outbox**.

- Acceptance succeeds when the legal records and pending receipt job are stored.
- The Worker attempts Resend delivery after the accepted response using the Cloudflare execution context.
- Provider acceptance marks the job sent and appends a sent event.
- A configuration or provider failure records a concise failed event and leaves a retryable job. It never deletes the acceptance or locks the participant out.
- The UI says **receipt queued** until provider acceptance is confirmed and **receipt emailed** only after a sent event exists.
- Participant resends are authenticated, rate-limited, scoped to the player's own acceptance, and suppressed while another attempt is in progress.
- Ops sees version, acceptance time, minor count, and receipt status in the player ledger. Minor names and birth years are excluded from list/export surfaces and appear only in a deliberate authorized legal-detail view.

The initial release uses the existing outbox plus participant/staff retry rather than adding a new Cloudflare queue. A dedicated email queue can be introduced later if real volume or retry requirements justify the additional deployment surface.

## Clerk boundary

The Tim Lost Something? source already has separate environment-driven Clerk architecture for public hunters and invitation-only staff. Nearby SebaStays source checkouts do not currently contain a committed Clerk implementation, so no local credential or application can be assumed from those repositories.

Implementation will keep the existing Tim Lost Something? Clerk interfaces and provider-key environment isolation. If an existing compatible Clerk application is available outside source control, it may be connected only after verifying its environment, allowed origins, redirect URLs, webhook, password/recovery policy, and ownership. Credential stores or private sessions will not be opened without Murphy's explicit approval in that session.

## Accessibility and content behavior

- `/waiver` uses semantic headings, numbered sections, lists, an effective-date label, and a print stylesheet.
- The onboarding link is a real link and the expandable rendering remains keyboard operable.
- Disabled acceptance explains that the waiver must first be opened for review.
- Minor rows have explicit labels, per-row validation, accessible add/remove controls, and live error summaries.
- Receipt status changes use a polite live region.
- The legal body is provided in English without automated paraphrase or machine translation.

## Verification

Automated coverage must prove:

- canonical legal text, title, version, effective date, hash, and approved `911` correction;
- `/waiver` accessibility and print rendering;
- the checkbox cannot activate before a matching review event;
- acceptance rejects stale version/hash, missing guardian confirmation, malformed minors, excess minors, and unverified accounts;
- one idempotent acceptance produces one legal event, exact participant snapshots, and one automatic receipt job;
- current acceptance unlocks progress, exact guidance, Field Notes, replies, moderated images, and private reports while safety gates remain authoritative;
- private find evidence and minor information have no public projection;
- transactional receipt delivery is independent of both optional permissions;
- HTML escaping, plain-text completeness, duplicate suppression, delivery failure, participant resend, staff retry, and audit events;
- Ops lists minor count but not minor identity and exports no minor information;
- policy/waiver version changes require fresh review and acceptance; and
- Privacy Policy version `2026.2` discloses guardian/minor and receipt handling and requires fresh active acceptance;
- account deletion and retention behavior preserve only the records allowed by the published policy and legal requirements.

Local and validation QA will cover desktop, 390-pixel mobile, keyboard, screen-reader semantics, axe, print preview, fail-closed missing-provider state, mocked successful delivery, and a controlled real-email acceptance only after explicit external-action and credential approval.

## Rollout boundaries

Code, tests, generated legal hash, and mock email behavior may be completed locally without external changes.

The following remain separately gated:

- validation D1 migration reconciliation and application;
- Clerk application or credential access;
- Resend sender/domain configuration and secrets;
- Turnstile configuration;
- sending a real controlled receipt;
- validation deployment; and
- any production migration, deployment, DNS, secret, or email action.

Validation accounts, acceptances, minor snapshots, reports, and emails are disposable test data and must not be promoted to production.

## Appendix A — approved waiver body

# SebaHub Tim Lost Something? Participant Acknowledgement, Waiver and Release

By registering for and participating in Tim Lost Something?, I confirm and agree that:

## 1. Voluntary participation

I am choosing to participate voluntarily. I understand that participation may involve walking outdoors on trails, grass, sand and uneven ground and may include exposure to weather, insects, vegetation, water, other visitors and changing property conditions.

## 2. Eligibility and minors

I confirm that I am at least 18 years old.

A participant under 18 may participate only while directly supervised by a parent or legal guardian who has registered and accepted this agreement on the minor's behalf.

## 3. Approved areas only

I will search only during posted hunt hours and only in areas marked as approved on the official search map or by SebaHub staff.

I will not enter:

- Private homes or neighbouring properties
- Guest accommodations or occupied campsites
- Event spaces during private bookings
- Farmyard or animal enclosures
- Construction, maintenance or storage areas
- Fenced, locked or signed restricted areas
- Water, shorelines marked as restricted, steep slopes or cliff-edge areas
- Any location closed by SebaHub staff

I understand that appearing on Tim's original route does not automatically mean that a location is open for public searching.

## 4. Prohibited conduct

I will not:

- Dig, cut trees or remove vegetation
- Climb buildings, fences, trees or structures
- Move heavy objects or damage landscaping
- Enter locked, closed or restricted areas
- Start fires
- Use vehicles, machinery, drones or excavation equipment to search
- Disturb guests, residents, staff or private events
- Feed, touch, chase or otherwise pester the Farmyard Friends
- Leave garbage or damage any part of the village

I will follow all signs and staff instructions immediately.

## 5. Assumption of risk

I understand that outdoor participation carries risks, including slips, trips, falls, uneven surfaces, weather, insects, water hazards, natural obstacles and the actions of other people.

I voluntarily accept the ordinary risks associated with participating in the activity.

## 6. Release and responsibility

To the fullest extent permitted by law, I release and hold harmless SebaHub, the participating property owners and operators, and their directors, employees, contractors, volunteers and representatives from claims arising from my participation, including claims connected with personal injury, property loss or property damage.

This release is not intended to exclude liability that cannot legally be excluded.

I understand that I remain responsible for my own conduct, safety and belongings.

## 7. Reporting finds and clues

I will report any potential find through the official website form or another contact method published on the campaign website.

I will not publish photographs or identifying details from Tim's ID or other personal documents.

I understand that a reported find may need to be photographed, documented and verified before it is confirmed.

## 8. Clue coin

After completing registration, I may be asked to show my confirmation to receive a SebaHub clue coin.

The coin identifies me as a registered participant for clue access. It does not grant access to restricted areas and does not replace my responsibility to follow the rules.

## 9. Removal from the activity

I understand that SebaHub may remove or disqualify anyone who:

- Enters restricted areas
- Damages property
- Disturbs animals, guests or residents
- Creates a safety concern
- Ignores staff instructions
- Provides false registration information

## 10. Emergency acknowledgement

I understand that campaign contact methods are not an emergency service. In an emergency, I will call 911.

## 11. Electronic agreement

By checking the required box and submitting the form, I confirm that:

- I have read and understood this agreement
- I have had the opportunity to ask questions
- The name and contact information entered belong to me
- I agree to be bound by this acknowledgement, waiver, release and the official hunt rules
