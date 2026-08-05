# Cock on the Walk title release

Date: 2026-08-05

## Approved change

The governed Casey item keeps its stable ID `case-item-coop-escape-artist`,
slug `coop-escape-artist`, status, description, reward terms, media and
placement. Its visitor-facing title is now **Cock on the Walk**.

The supplied wanted-poster artwork remains unchanged. The website's image
alternative text uses the new item name while continuing to describe the
return requirement and stated reward.

## Release record

Validation and production each moved the existing item from version 2 to
version 3 with an append-only item event and audit event. The item remained
Out there, kept its existing media, and changed only its title plus alternative
text.

Before the production write, D1 was exported to the ignored private backup
`source-media/production-backups/2026-08-05-pre-cock-on-the-walk-title-production.sql`
(1,030,427 bytes; SHA-256
`1517a8c6c170f4aaad8766f88a33453c74cecba5359e352f6c5d7ce96442d079`).

Verification passed:

- the 12-test manifest/importer suite;
- all TypeScript projects;
- the 325-test static, browser and privacy suite;
- the production build and exact legal-document check;
- the 53-file served-output privacy scan;
- validation and production item, media, event and audit queries;
- production foreign-key checking; and
- live browser smoke testing with the new heading, updated image description,
  no old heading and no console errors.

The real-D1 unit runner reproduced its known local Miniflare shutdown hang and
was terminated after producing no failure output. No worker or database code
changed in this release; the changed manifest contract is covered by the
passing focused suite.
