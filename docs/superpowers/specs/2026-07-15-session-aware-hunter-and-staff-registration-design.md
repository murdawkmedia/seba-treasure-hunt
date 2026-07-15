# Session-Aware Hunter and Staff Registration Design

## Outcome

The validation campaign makes legal review part of hunter account creation, shows protected route links where hunters expect them, exposes a conventional account control on every public page, and lets verified company-domain staff create their own separate Ops identity.

## Hunter registration and legal records

The Create Account form collects the hunter's email, password and full name. Before Clerk receives the signup request, the hunter must open the current Privacy Policy & Media Notice and Participation Waiver, affirm the adult eligibility statement, and check two separate acceptance boxes. The current documents remain directly viewable from the signup panel.

The browser does not pretend an anonymous checkbox is a completed legal record. It retains the reviewed document identities only for the active signup attempt. After Clerk verifies the email and activates the session, the application waits for the signed lifecycle webhook, creates the private profile and Privacy/Media acceptance, records the waiver review, and stores the waiver acceptance against the verified Clerk subject. Exact directions remain locked unless this verified finalization succeeds. Existing incomplete validation accounts are sent through the same legal onboarding before protected tools unlock.

The signup and recovery forms serialize submissions. While Clerk is sending a code, the relevant button is disabled and reports an in-progress label. A second click cannot issue a second request.

## Global hunter identity

The canonical campaign shell owns a final account item in the primary navigation. Signed-out visitors see **Sign in**. Signed-in hunters see a Clerk avatar when available, otherwise an initial, plus their privacy-safe D1 public handle. The compact menu offers Dashboard, Edit profile and Sign out. Email prefixes and full legal names are never made public by default. On mobile, the control is part of the expanded navigation.

## Session-aware route

The public route page keeps only its campaign introduction while signed out and presents a direct sign-in action instead of the detailed twelve-stop field ledger. After Clerk authentication, the route client requests the protected member waypoint projection. A fully registered hunter sees all twelve waypoint sections plus current zone state and an approved Google Maps link when the case and zone are open. A signed-in but incomplete hunter sees a precise prompt to finish legal onboarding; the server remains the authority for every protected URL.

No waypoint progress controls are added in this pass.

## Staff self-registration

Ops continues to use its separate Clerk application. The Ops gateway adds Create staff account and email-code verification. Only verified staff identities with an exact normalized domain of `sebahub.com` or `businessasaforceforgood.ca` may become operators.

The server, not browser JavaScript, enforces this rule. On the first authenticated Ops request it atomically creates and activates a D1 staff principal for a previously unseen allowed-domain address. Existing suspended or revoked records are never recreated or reactivated. Lookalike domains, subdomains, missing email claims and hunter-issuer tokens are rejected. Activation is audit logged. This deliberately grants equal administrator access to every mailbox controlled under either approved company domain.

## Failure behavior

- Legal documents unavailable: account creation remains disabled.
- Clerk code request in flight: repeated submits are ignored.
- Clerk webhook delayed: finalization retries briefly, then leaves the account signed in but locked with a recoverable message.
- Legal finalization fails: no exact directions or participation tools unlock.
- Staff address outside the approved domains: Clerk identity may exist, but Ops returns 403 and no D1 principal is created.
- Case status or zone state not open: exact Google Maps links remain absent.

## Verification

Automated tests cover legal-gated signup ordering, serialized code delivery, domain matching and D1 activation, global account shell markup, route authentication states and protected-link rendering. The complete test, typecheck, legal verification, build, privacy-output and unified-shell suites must pass. Browser QA covers signed-out signup, hunter verification/finalization, signed-in route links, sign out, allowed-domain staff signup and rejection of a non-company address on the noindex validation alias.

Production, DNS and production data remain unchanged.
