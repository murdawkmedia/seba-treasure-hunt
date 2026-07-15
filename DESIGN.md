# Tim Lost Something? Design System

## Reader and outcome

Public hunters must find case status and hunt actions immediately. Sponsor prospects must reach a qualified inquiry without the site implying an agreement, guaranteed reach, or an unapproved partner.

## Direction

Use a playful Seba Beach mystery aesthetic: dark forest, parchment, treasure gold, the Sunny Pirate Mystery Chest, restrained pirate language, and real campaign imagery. Keep forms and operational states plain enough to scan once.

## Tokens

- Forest: #14261c, #1c3527, #234331
- Gold: #e0a01e, #eab63f, #f2cd6a
- Parchment: #f6efdd, #efe4c6, #e5d5ac
- Ink: #241b0f, #3a2e1c
- Rust accent: #a6452a
- Display: Pirata One with Georgia fallback
- Body: IM Fell English with Georgia fallback
- Operational/meta: Special Elite with Courier fallback
- Radius: 8–16px; cards use visible borders and restrained shadows

## Persistent header

Desktop uses two sticky rows: the authoritative case strip at top 0 and the navigation row directly below it. Mobile keeps the compact case strip and collapses navigation behind an explicit menu button. Sponsors is gold-highlighted; current page uses aria-current="page". Anchor and focus scrolling clear both rows.

## Canonical public shell

`scripts/campaign-shell.mjs` is the only source for public campaign status-strip, header, navigation, skip-link and footer markup. The thirteen public and hunter pages declare route markers; `npm run build` validates those declarations and renders the complete shell. Do not hand-edit generated shell markup in individual pages.

The primary menu order is fixed: Start, 12-waypoint Route, Updates, Clue Board, Report, Rules, Dashboard, Sponsors. Interview and the legal routes remain reachable without inventing a primary-menu current state. The private Ops console intentionally keeps its separate markup, styling and authorization-oriented information architecture.

`css/campaign-shell.css` is the only public chrome owner and defines the shared forest, gold, parchment, typography, geometry and focus tokens. Page-family classes preserve route character without forking the shell:

- `campaign-page--landing`: home, start and updates;
- `campaign-page--route`: the 12-waypoint visual route;
- `campaign-page--editorial`: the full interview;
- `campaign-page--ledger`: the public Clue Board;
- `campaign-page--workspace`: dashboard and private report;
- `campaign-page--document`: rules, privacy, waiver and community guidelines; and
- `campaign-page--sponsors`: sponsor storytelling and inquiry.

## Sponsor page

Order: campaign hero, three-point trust strip, three opportunity cards, recognition boundary, qualified inquiry, FAQ, footer. Lead Sponsor is visually featured. No fixed public prices, audience claims, media promises, exclusivity, or unapproved logos.

## Media

Use existing campaign-safe treasure and mystery assets. Do not generate fake sponsors, crowds, prize evidence, or media coverage. Decorative imagery never communicates a factual benefit.

## Forms

Always show labels, required marks, hints, field errors, Turnstile state, a summary alert, and a focusable success region. Never rely on color alone.

## Mobile and motion

Verify 390px without horizontal overflow. Do not keep two desktop-height rows on mobile. Respect reduced motion and 200% zoom.

Any shell change requires the complete route matrix: all thirteen routes at 360, 768 and 1440 CSS pixels; all thirteen routes at the 720x500 200%-zoom equivalent; 390x844 mobile accessibility with collapsed and expanded menus; representative 1440x1000 desktop accessibility; short-menu focus traversal; and checks for sticky-row geometry, skip targets, current state, Escape/link closure, overflow, console errors and serious/critical axe findings.
