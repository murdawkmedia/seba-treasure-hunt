# Sponsor Page and Persistent Navigation Design

Date: 2026-07-13

Status: Approved for implementation planning

Project: Tim Lost Something? Hunter Platform

## Purpose

Create a dedicated `/sponsors` conversion page for organizations interested in supporting the Tim Lost Something? campaign. Make Sponsors consistently discoverable in the desktop navigation and site footer, while preserving the hunt's primary participant actions and avoiding unsupported public promises.

The validation environment is the first and only deployment target for this work. Sponsor inquiries created during testing are disposable and must not be promoted into production.

## Goals

- Give serious sponsor prospects a clear, campaign-specific destination.
- Collect qualified sponsorship inquiries directly on the website.
- Keep the case state and primary navigation visible while scrolling on desktop.
- Add a visibly emphasized Sponsors item without allowing it to compete with urgent hunt actions on mobile.
- Offer flexible cash, prize, service and in-kind conversations without publishing unapproved prices or benefits.
- Give authorized staff a private workflow for reviewing and managing sponsor inquiries.
- Keep all sponsor names, logos, partner claims, reach figures and recognition commitments subject to explicit approval.
- Keep validation inquiries isolated and disposable.

## Non-goals

- Do not publish guaranteed audience size, social reach, media coverage, exclusivity or placement claims.
- Do not name a prospective organization as a sponsor before approval.
- Do not restore or imply any unconfirmed radio, media or partner relationship.
- Do not add automatic email delivery in this pass.
- Do not reuse the hunter-account profile or public Field Notes system for sponsor leads.
- Do not migrate validation inquiries into production.
- Do not change production domains, DNS, Cloudflare bindings or the live deployment during this phase.

## Approved Design Direction

The approved visual direction uses the existing campaign's dark forest, parchment and gold palette with a more polished sponsorship-conversion layout. It remains recognizably part of Tim Lost Something? rather than becoming a generic corporate partnership page.

The hero leads with:

> Put your name inside the mystery.

The supporting copy frames sponsorship as a way to help create a memorable Seba Beach experience and invites prospects to describe the support that fits their organization.

The page may use campaign-safe treasure, mystery, chest, map and pirate motifs already established by the Sunny Pirate Mystery Chest identity. Decorative imagery must not imply a prize, benefit or sponsor relationship that does not exist.

## Persistent Navigation

Use the approved **Option A: persistent stacked header** on desktop.

### Desktop behavior

- The first sticky row is the live case strip.
- It shows the authoritative OPEN, PAUSED or FOUND state from the existing case-status source.
- It may also show search hours, the last official update and a link to `/updates` when those values are available.
- It must not invent a next-clue time or countdown. Missing optional values collapse cleanly.
- The second sticky row contains the Tim Lost Something? brand and the main navigation.
- The navigation includes Start, Route, Updates, Report and Sponsors.
- Sponsors is visually emphasized in gold and shows an active state on `/sponsors`.
- Both rows remain visible while scrolling on desktop.
- The combined sticky height should remain close to the approved mockup and must not obscure anchored content. Anchor offsets and focus scrolling account for the full header height.

### Mobile behavior

- Keep a compact live-status row visible.
- Collapse the main navigation into the existing mobile menu pattern.
- Include Sponsors in the menu with a distinct but restrained treatment.
- Do not reserve two full desktop-height rows on small screens.
- Preserve keyboard operation, visible focus, screen-reader labels, reduced-motion behavior and sufficient touch targets.

### Sitewide placement

- Add Sponsors to the homepage and all public campaign-page headers that use the main navigation.
- Add a Sponsors link to every public footer.
- Reduce the existing homepage sponsor section to a concise teaser that links to `/sponsors`.
- Existing deep links to `/#sponsor` should continue to land on a useful teaser rather than becoming dead links.

## Sponsor Page Structure

### 1. Campaign hero

- Eyebrow: Sponsor the Seba Beach Treasure Hunt.
- Headline: Put your name inside the mystery.
- Short explanation of the community-focused opportunity.
- Primary action scrolls to the inquiry form.
- Secondary action scrolls to participation options.
- The approved stacked header remains visible above the page.

### 2. Trust strip

Use three concise points:

- a real local story connected to the current campaign;
- flexible cash, prize, service or practical in-kind support;
- recognition agreed before a sponsor name or logo is published.

These are positioning statements, not performance claims.

### 3. Ways to participate

Present three conversational opportunity types without fixed public pricing:

1. **Community Sponsor** — straightforward local participation and recognition options discussed with the team.
2. **Lead Sponsor** — a larger, tailored role subject to campaign-fit and safety review.
3. **Prize & In-Kind Partner** — useful goods, services, printing, prizes or operational support confirmed before promotion.

Lead Sponsor receives the strongest visual emphasis. The cards invite a discussion and do not promise specific deliverables.

### 4. Recognition boundary

State in plain language that audience size, media coverage, exclusivity, social reach and placements are not guaranteed unless formally agreed. The internal implementation must make it difficult to accidentally reintroduce unapproved partner copy through seeded content or stale markup.

### 5. Qualified inquiry form

Collect only information needed to understand and follow up on the opportunity:

- contact name, required;
- organization, required;
- work email, required;
- callback phone, optional;
- support type, required;
- estimated contribution range, optional;
- desired outcome or partnership idea, required;
- privacy/accuracy acknowledgement, required.

The contribution-range control uses neutral ranges plus “Not sure yet” and “Prefer to discuss.” It must not imply published sponsorship prices.

Link the acknowledgement to the current Privacy Policy & Media Notice. Do not add marketing consent, SMS consent or a participation-waiver acceptance to this form.

### 6. FAQ and footer

Include a compact FAQ addressing:

- cash versus in-kind support;
- whether packages are flexible;
- when recognition is published;
- how the campaign team follows up;
- whether submitting the form creates an agreement.

Submitting an inquiry does not create a sponsorship agreement or authorize publication of the organization's name or logo.

## Inquiry Data Model

Add a private `sponsor_inquiries` table in D1 with server-generated identifiers and fields sufficient for the approved form and staff workflow:

- inquiry ID and public-safe reference code;
- contact and organization fields;
- support type and contribution range;
- proposal text;
- acknowledgement version and timestamp;
- workflow state;
- creation and update timestamps;
- environment marker or equivalent validation guard.

Use a separate append-only `sponsor_inquiry_events` table for state transitions and staff actions. Private staff notes must not be exposed in public responses. Do not store Turnstile tokens, IP addresses in raw form, browser fingerprints or unrelated hunter-profile data.

Workflow states are:

- New;
- Contacted;
- Qualified;
- Accepted;
- Closed.

An Accepted state records internal pipeline status only. It does not automatically publish the organization as a sponsor.

## Public Submission Flow

1. The visitor completes the public form.
2. The browser validates required fields and accessible error associations.
3. The server verifies input, the validation/production environment sentinel, Turnstile and the independent rate limit.
4. The server writes the inquiry and its initial event atomically.
5. The response returns only a confirmation message and public-safe reference code.
6. The visitor sees a durable success state that does not expose internal identifiers or other inquiries.
7. A duplicate network retry uses an idempotency key and must not create multiple leads.

No inquiry is sent to a public board or sponsor list. No automatic email is sent in this pass. The success message explains that the campaign team will review the inquiry and that submission is not an agreement.

## Operations Workflow

Add a private **Sponsors** area to `/ops` for already-authorized staff.

It provides:

- counts by workflow state;
- a newest-first inquiry ledger;
- search by organization or contact;
- filters for support type and state;
- a private inquiry detail view;
- state transitions with append-only audit events;
- private internal notes;
- CSV export only if the existing Ops authorization and privacy-output controls can protect it safely.

Authorized staff can review and update inquiries. Public users, hunter accounts and unauthenticated callers cannot list or retrieve them. Staff actions use the existing repeated D1 authorization model and audit approach.

## Abuse, Privacy and Security Controls

- Require server-verified Turnstile for submission.
- Apply the existing salted-identifier rate-limit pattern independently of Turnstile.
- Validate field lengths, normalized email, enumerated support values and safe text encoding on the server.
- Use parameterized D1 statements.
- Do not render prospect text as HTML.
- Keep contact details, notes, inquiry history and reference mappings private.
- Exclude sponsor inquiries from public APIs, search indexes, sitemaps, analytics payloads and logs.
- Log request IDs and failure categories without proposal text or contact data.
- Add a short campaign-specific disclosure to the current Privacy Policy if the existing policy does not already describe sponsorship inquiries adequately.
- Keep validation inquiries subject to the already-approved disposable-data purge and environment-mismatch guard.

## Failure Handling

- Missing Turnstile or required validation configuration fails closed with a service-unavailable form state.
- Invalid form input returns field-specific errors without echoing unsafe content.
- Rate-limited callers receive a neutral retry response.
- Duplicate idempotent submissions return the original success reference when safe.
- A D1 or transaction failure returns a retryable error and no success message.
- Ops authorization failures reveal neither inquiry existence nor counts.
- Optional case-strip values failing to load must not prevent navigation from rendering.

## SEO and AEO

- Publish `/sponsors` with a unique title, meta description, canonical URL and social metadata.
- Describe the page as the official sponsorship-inquiry destination for the Tim Lost Something? Seba Beach Treasure Hunt.
- Add the route to the sitemap only when it is promoted to production; validation remains noindex.
- Use semantic headings, concise FAQ content and `FAQPage` structured data only when the rendered FAQ and schema match exactly.
- Do not add review, event attendance, organization-partner or offer markup unsupported by public facts.
- Keep sponsor form and Ops data out of structured data.

## Accessibility and Responsive Requirements

- Meet WCAG 2.1 AA color contrast and focus visibility.
- Make both sticky rows navigable and understandable at 200% zoom.
- Ensure sticky content does not cover focused controls, headings or skip-link targets.
- Provide a working skip link that lands below both sticky rows.
- Associate labels, help text and errors programmatically with form controls.
- Announce submission success and failure without moving focus unpredictably.
- Verify desktop, tablet and 390-pixel mobile layouts without horizontal overflow.
- Do not rely on color alone for current page, case state or form errors.

## Validation and Rollout

Implement and deploy this work only to `codex-validation.seba-treasure-hunt.pages.dev` first.

- Apply the sponsor-inquiry migration to validation D1 only.
- Keep the public form visibly subject to the validation disposable-data notice.
- Exercise Turnstile, rate limits, idempotency, successful submission and failure states.
- Verify Ops listing, state transitions, audit history and authorization boundaries.
- Confirm inquiries never appear in public output or community content.
- Confirm production pages, bindings and databases remain unchanged.
- Purge all validation inquiries and associated events before production promotion.
- Production promotion requires a separate explicit approval and a clean production migration.

## Verification Matrix

Before the validation implementation is considered ready for owner testing:

- new sponsor-page content and metadata tests pass;
- sitewide navigation and footer-link contracts pass;
- desktop sticky-header and anchor-offset behavior is visually verified;
- mobile menu and compact status behavior are visually verified;
- form validation, Turnstile, rate limit, idempotency and D1 transaction tests pass;
- Ops authorization and state-transition tests pass;
- accessibility scans report no WCAG 2.1 A/AA violations on the sponsor page and Sponsors Ops view;
- public-output scans contain no inquiry data, internal notes, private addresses, unconfirmed partners or stale media claims;
- the full existing automated suite, type checks and production build pass;
- live validation smoke tests return `X-Robots-Tag: noindex, nofollow` and the disposable-data notice;
- production remains on its prior release.

## Completion Criteria

The design is implemented successfully when:

- `/sponsors` presents the approved campaign-specific conversion page;
- the Option A stacked header and sitewide Sponsors links work across public pages;
- qualified inquiries can be safely submitted in validation;
- authorized staff can manage those inquiries privately with audited state changes;
- unsupported claims and unapproved sponsor identities remain absent;
- accessibility, privacy, mobile, SEO/AEO and automated checks pass;
- validation inquiries are demonstrably isolated and disposable; and
- no production deployment or data change has occurred.
