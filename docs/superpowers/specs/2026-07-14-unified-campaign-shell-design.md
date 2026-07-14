# Unified Campaign Shell Design

**Date:** July 14, 2026  
**Project:** Tim Lost Something? Hunter Platform  
**Status:** Owner-approved design  
**Applies to:** Public and hunter-facing website routes  
**Does not apply to:** The restricted `/ops` case-room interface

## Purpose

The website currently exposes multiple visual and navigational systems. The home, route, and interview pages use an older campaign header and footer; the newer hunter pages use a second shell; the Clue Board uses a third. Menu labels, destinations, mobile behavior, link formats, and overall styling change as visitors move through the site.

The unified campaign shell will make every public and hunter-facing page feel like one coherent Tim Lost Something? experience while preserving the useful personality and function of each route.

## Audience and project class

This is a public marketing/campaign site with authenticated hunter tools. Public visitors need immediate case status, clear hunt actions, trustworthy safety information, and consistent wayfinding. Signed-in hunters need the same campaign context around operational tools. Sponsor prospects and legal readers must not feel that they have entered a different website.

The invitation-only Ops case room remains a separate internal console. It may reuse brand tokens, but it will not receive the public campaign shell or public navigation.

## Chosen approach

Use a **build-time shared shell**.

A single source will define the status strip, brand row, navigation, mobile menu, skip-link pattern, and footer. The build will place complete accessible HTML into every public and hunter-facing page. Navigation will not depend on runtime JavaScript injection.

This approach was selected over:

- runtime shell injection, which would make navigation vulnerable to script failures and visual flashes; and
- manual markup normalization, which would allow the pages to drift apart again.

## Routes in scope

The shared shell applies to:

- `/`
- `/start`
- `/route`
- `/interview`
- `/updates`
- `/clue-board`
- `/report`
- `/rules`
- `/dashboard`
- `/sponsors`
- `/privacy`
- `/waiver`
- `/community-guidelines`

The shell must support both indexable campaign pages and noindex member/legal workflow pages without changing their metadata or privacy posture.

## Canonical navigation

Every in-scope page uses this exact primary-menu order and wording:

1. Start
2. 12-waypoint Route
3. Updates
4. Clue Board
5. Report
6. Rules
7. Dashboard
8. Sponsors

The brand links to `/`. Sponsors remains visually highlighted in treasure gold. The current primary route receives `aria-current="page"` when the current page is represented in the menu.

The full Interview remains a prominent contextual link from relevant campaign content rather than becoming a ninth persistent menu item.

All internal links use root-relative extensionless URLs. Older relative `.html` links are removed from shared navigation and footer markup.

## Shared shell anatomy

### Case-status strip

- Sticky at the top of the viewport.
- Uses the existing authoritative status data and live-region behavior.
- Shows the official state, short detail, next-clue information when available, and an Official Updates link.
- Retains open, paused, found, and unavailable treatments.
- Never manufactures a countdown or update time.

### Campaign header

- Sticky directly below the case-status strip on desktop.
- Brand copy is `Tim Lost Something?` with the sub-brand `This year: Tim lost his ID`.
- Uses one consistent mobile menu button, accessible name, expanded state, keyboard behavior, and focus treatment.
- Desktop and mobile shell heights are expressed as shared tokens so anchor and focus scrolling clears the stacked header.

### Skip navigation

- Every page begins with a visible-on-focus skip link.
- The link targets the page's primary content landmark.
- Each target is focusable when necessary for reliable keyboard movement.

### Footer

- Uses one consistent campaign identity block.
- Includes Privacy, Waiver, Community Guidelines, Current Rules, and Sponsors.
- Uses root-relative links and current-page state where relevant.
- Retains the approved SebaHub/SebaStays relationship and guarantee link only where already supported by public copy; it does not introduce new partner claims.

## Visual system

The current Seba Beach pirate-mystery direction remains in force:

- deep forest backgrounds;
- parchment reading surfaces;
- treasure-gold emphasis;
- restrained rust accents;
- Pirata One for campaign display type;
- IM Fell English for narrative and readable body copy;
- Special Elite for operational labels and case-file metadata.

The unification pass standardizes:

- page-width constraints and gutters;
- section spacing and vertical rhythm;
- heading scale and balanced wrapping;
- body measure and readable line height;
- buttons, text links, cards, notices, forms, and field states;
- focus rings, hover states, disabled states, and live status messages;
- border, radius, shadow, and surface hierarchy;
- stacked-header offsets and responsive breakpoints;
- footer structure and mobile wrapping.

The approved Sunny Pirate Mystery Chest remains a small-format campaign mark or favicon. It must not be enlarged into hero artwork.

## Page-specific character

The shared system must not flatten every route into one generic template.

- **Home:** cinematic campaign landing page with the real place and core mystery visible immediately.
- **Start:** concise permanent QR destination and field-ready action guide.
- **Route:** map-led waypoint field guide; route media and waypoints remain the dominant structure.
- **Interview:** editorial case file with readable long-form questions, answers, and Hunter's Notes.
- **Updates:** official dated case log.
- **Clue Board:** community evidence ledger with clear distinction between community observations and official clues.
- **Report:** private, reassuring, task-focused reporting flow.
- **Rules, Privacy, Waiver, and Community Guidelines:** calm parchment documents optimized for reading, printing, and legal clarity.
- **Dashboard:** operational hunter workspace with dense but readable progress, access, and legal-state panels.
- **Sponsors:** polished partnership page within the campaign shell; no unapproved logos, fixed public pricing, audience guarantees, or implied agreements.

## Build architecture

The shell source owns:

- status-strip markup;
- brand and sub-brand copy;
- menu order, labels, and destinations;
- Sponsors emphasis;
- mobile-menu markup;
- footer identity and links;
- route-to-current-page mapping.

Each page supplies:

- a stable route identifier;
- its skip-link label and target;
- page-specific metadata and body content;
- optional page-level styles or scripts that do not redefine the shared shell.

The build emits the complete shell into the final HTML. It must fail when an in-scope page:

- lacks the required shell marker or route identifier;
- supplies an unknown route identifier;
- lacks a valid skip target;
- cannot produce the canonical menu and footer; or
- produces conflicting current-page states.

The source and build structure should make future menu changes possible in one place without requiring manual edits across thirteen pages.

## Styling architecture

Shared tokens and shell components live in the common campaign styles. Page styles may define only content-area components or deliberate page variants.

The older home/route/interview shell selectors and the separate Clue Board shell selectors are retired or scoped away after migration. The final build must not contain multiple competing public header or footer systems.

The restricted Ops stylesheet remains independent.

## Behavior and error handling

- The status strip continues to fail safely to `Status unavailable`; exact directions remain locked and reporting remains available.
- Mobile navigation remains usable without pointer input and closes predictably after navigation, Escape, or a breakpoint change.
- A shell build failure stops the build rather than silently emitting incomplete navigation.
- Missing page-specific JavaScript must not remove navigation or footer content.
- Existing authentication, Turnstile, moderation, legal, media, and privacy gates remain unchanged.

## SEO, AEO, legal, and privacy boundaries

- Preserve each route's title, description, canonical URL, robots rules, Open Graph metadata, Twitter metadata, structured data, and sitemap behavior unless a separate verified defect is found.
- Preserve indexable versus noindex behavior.
- Preserve legal document bodies, versions, effective dates, generated artifacts, and hashes. Only surrounding navigation and decorative chrome may change.
- Do not expose private routes, evidence, location data, provider references, contact data, or authentication state through the shell.
- Do not add unapproved sponsor, partner, media, or prize claims.

## Accessibility requirements

- One primary campaign navigation landmark per public/hunter page.
- Correct `aria-current` behavior without duplicate current items.
- Keyboard-operable mobile menu with visible focus.
- Skip link reaches the primary content.
- Case status remains an appropriate live region without excessive announcements.
- Native disabled behavior remains visible and understandable.
- Colour is never the only status indicator.
- Layout remains usable at 200% zoom and narrow widths without covered content.
- Reduced-motion preferences are respected.

## Verification

Automated checks will cover:

- exact menu order, labels, and URLs across every in-scope page;
- exactly one shared shell and footer;
- correct route-specific `aria-current` behavior;
- valid skip-link targets;
- absence of legacy relative `.html` shell links;
- mobile-menu keyboard and expanded-state behavior;
- preservation of metadata, structured data, legal hashes, auth gates, and page scripts;
- build failure on malformed shell inputs.

Rendered QA will cover all in-scope routes at approximately:

- 360px mobile;
- 768px mobile/tablet;
- 1440px desktop;
- 200% zoom-equivalent layout.

QA will check overlap, horizontal overflow, sticky offsets, anchor clearance, menu wrapping, focus visibility, footer consistency, console errors, and accessibility findings. Route, Interview, Clue Board, Dashboard, Sponsors, legal pages, and the home hero receive explicit visual spot checks because they represent the site's distinct page types.

## Rollout boundary

This work is implemented and verified locally before the validation rollout. It does not authorize production changes, DNS changes, Cloudflare configuration, email delivery, or public deployment.

The unified shell will be included in the next approved validation deployment only after its implementation plan, automated verification, visual QA, and public-output privacy check pass.

## Decisions in force

- The public site gets one build-time shell; Ops remains a distinct internal console.
- The canonical menu has eight items and does not add Interview.
- Shared visual rules coexist with page-specific layouts.
- Complete navigation is emitted at build time, not injected at runtime.
- Root-relative extensionless internal links are canonical.
- Legal bodies and hashes are immutable during this pass.
- No deployment occurs until the later validation rollout step.
