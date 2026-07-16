# Tim Lost Something? Design Source

## Approved direction: Documentary Case File

The campaign is a genuine local mystery presented as a living documentary case file. It should feel suspenseful, conversational, community-led and lightly playful. SebaHub is the host and steward of the hunt, not the subject of the story.

The memorable idea is simple: real local evidence, route photography and community observations accumulate around one open case. The interface should support that story without turning the campaign into theatre.

## Visual language

- Use dark forest, cream and gold as the dominant palette. Use verification red sparingly for open-case or evidence-status signals, never as general decoration.
- Use Cormorant Garamond for display and editorial headings, Source Sans 3 for body copy and interface controls, and IBM Plex Mono sparingly for case labels, timestamps and verification metadata.
- Prefer real evidence and route photography. Images must be relevant, honestly captioned and clearly identify any campaign prop or dramatization.
- Keep copy short, direct and plain-English. Use local detail and human observation rather than lore.
- Use no pirate language, pirate art, pirate ornament or themed gimmicks. Do not introduce mascots, treasure-chest motifs, theatrical parchment props or decorative clutter.

## Interaction, mobile and media

- Design mobile-first down to the supported 320px minimum. Preserve the measured stacked-header geometry, usable touch targets, readable line lengths and overflow protections.
- Meet the existing accessibility contracts: semantic landmarks, keyboard access, visible high-contrast focus, sufficient color contrast, descriptive alternative text, balanced headings, clear form states and reduced-motion support.
- Keep media responsive and optimized. Use real photographs at useful resolution, reserve layout space where practical, avoid autoplay, and never make an image the only source of essential instructions.
- Keep the SebaStays Sunny Guarantee as a secondary host endorsement in the shared footer. It must never compete with case status, evidence or primary actions.

## Product invariants

- Existing URLs, canonicals, route keys, API names and data-model names remain stable. In particular, Case Notes continues to use the `/clue-board` route and `clue-board` identifiers.
- Exact route controls remain available only to authenticated hunters. Public route stories and operator-approved report locations remain public.
- Hunter and staff authentication remain separate. Staff and Ops access retain their company-domain gates, and account/sign-in/sign-out controls remain functional.
- Reports remain private by default. Private evidence is never auto-published; operators make a separate explicit publication decision, with media publication off by default. Moderation contracts remain in force.
- Legal body copy, document versions and document hashes are immutable unless a separately reviewed legal change explicitly authorizes them. Generated legal pages must be changed through their authoritative generator.
- Preserve APIs, schemas, auth controls, route gating, reports, moderation, deployment configuration and the private Ops console while applying this design direction.

This file is the design source for the live campaign and app. Material departures require explicit review before implementation or release.
