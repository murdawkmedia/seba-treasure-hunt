# Tim Lost Something? Design Source

## Approved direction: B2 Full Investigation Board

The public experience is a genuine local mystery presented as an energetic evidence wall. It should feel theatrical, funny, suspenseful and unmistakably easy to use. Real evidence keeps the story believable; affectionate jokes about Tim give it personality. SebaHub is the host and steward of the search, not the subject of the story.

The memorable idea is simple: Tim found his ID, but the rest keeps appearing. Real photographs, taped notes, stamps and evidence cards show what is found and what is still out there. Every public screen must make the next action obvious even when the visual treatment is intentionally over the top.

## Visual language

- Use dark forest, cream and gold as the dominant palette. Use verification red for evidence-status stamps such as FOUND, never as a substitute for accessible text.
- Use Cormorant Garamond for display and editorial headings, Source Sans 3 for body copy and interface controls, and IBM Plex Mono sparingly for case labels, timestamps and verification metadata.
- Prefer real evidence and route photography. Generated evidence-wall artwork is atmosphere only. Images must be relevant, honestly captioned and clearly identify any prop or visual representation.
- Use taped-paper, pinned-note and rubber-stamp treatments with restraint around real content. Relationships that are communicated spatially must also have a semantic, non-spatial reading order.
- Keep copy short, direct and plain-English. Use local detail, affectionate humour and human observation rather than lore.
- Use no pirate language, pirate art, treasure-chest motifs or pirate mascots.

## Interaction, mobile and media

- Desktop may use the full investigation-board composition. Mobile must convert it into ordered stacked evidence cards, never a pan-and-zoom canvas. Design down to the supported 320px minimum and preserve measured header geometry, touch targets, readable line lengths and overflow protections.
- Meet the existing accessibility contracts: semantic landmarks, keyboard access, visible high-contrast focus, sufficient color contrast, descriptive alternative text, balanced headings, clear form states and reduced-motion support.
- Keep media responsive and optimized. Use real photographs at useful resolution, reserve layout space where practical, avoid autoplay, and never make an image the only source of essential instructions.
- Keep the SebaStays Sunny Guarantee as a secondary host endorsement in the shared footer. It must never compete with case status, evidence or primary actions.

## Product invariants

- Existing URLs, canonicals, route keys, API names and data-model names remain stable. Visitor-facing names are Where to Look, Latest News, What People Found, I Found Something and My Hunt; internal waypoint/update/case-note identifiers remain unchanged.
- The shared public navigation exposes only Where to Look, I Found Something and My Hunt as primary actions. Latest News, What People Found, Tim's Story and Rules & Safety live under More.
- The public item board is dynamic and status-driven. Draft and Archived items are private; Out there, Found and Paused are public. FOUND is a reversible presentation overlay and never alters source media.
- Exact route controls remain available only to authenticated hunters. Public route stories and operator-approved report locations remain public.
- Hunter and staff authentication remain separate. Staff and Ops access retain their company-domain gates, and account/sign-in/sign-out controls remain functional.
- Reports remain private by default. Private evidence is never auto-published; operators make a separate explicit publication decision, with media publication off by default. Moderation contracts remain in force.
- Legal body copy, document versions and document hashes are immutable unless a separately reviewed legal change explicitly authorizes them. Generated legal pages must be changed through their authoritative generator.
- Preserve auth controls, route gating, reports, moderation, deployment configuration and the private Ops console. Item-board schema/API changes must retain audited staff authorization, optimistic versions and append-only history.

This file is the design source for the live campaign and app. Material departures require explicit review before implementation or release.
