import assert from "node:assert/strict";
import test from "node:test";

import {
  applySponsorErrorTargetState,
  buildSponsorPayload,
  parseSponsorReceipt,
  presentSponsorErrors,
  sponsorErrorCopy,
  validateSponsorDraft,
  type SponsorDraft,
} from "../src/client/sponsors";

class MinimalErrorTarget {
  readonly attributes = new Map<string, string>();
  readonly events: string[] = [];
  private currentTabIndex = 0;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.events.push(`${name}:${value}`);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    this.events.push(`remove:${name}`);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  set tabIndex(value: number) {
    this.currentTabIndex = value;
    this.attributes.set("tabindex", String(value));
    this.events.push(`tabindex:${value}`);
  }

  get tabIndex(): number {
    return this.currentTabIndex;
  }

  focus(): void {
    this.events.push("focus");
  }
}

const approvedMinimum: SponsorDraft = {
  contactName: "A",
  organization: "B",
  email: "a@b.co",
  phone: "",
  supportType: "community",
  contributionRange: "",
  desiredOutcome: "1234567890",
  acknowledgementAccepted: true,
  acknowledgementVersion: "2026.1",
  turnstileToken: "verified-token",
};

test("approved minimum sponsor draft validates", () => {
  assert.deepEqual(validateSponsorDraft(approvedMinimum), {});
});

test("human-check validation makes the shell programmatically focusable before focus", () => {
  const shell = new MinimalErrorTarget();

  const focusTarget = applySponsorErrorTargetState(shell, "turnstileToken", true);
  focusTarget?.focus();

  assert.equal(shell.attributes.get("aria-invalid"), "true");
  assert.equal(shell.attributes.get("tabindex"), "-1");
  assert.deepEqual(shell.events, ["aria-invalid:true", "tabindex:-1", "focus"]);

  applySponsorErrorTargetState(shell, "turnstileToken", false);
  assert.equal(shell.attributes.has("aria-invalid"), false);
  assert.equal(shell.attributes.get("tabindex"), "-1", "tabindex remains stable for future error focus");
});

test("error presentation announces a summary and focuses the first invalid shell", () => {
  const shell = new MinimalErrorTarget();
  const summaries: string[][] = [];

  presentSponsorErrors(
    { turnstileToken: "Complete the human check." },
    {
      setFieldError(key, _copy, invalid) {
        return key === "turnstileToken"
          ? applySponsorErrorTargetState(shell, key, invalid)
          : null;
      },
      setSummary(messages) {
        summaries.push([...messages]);
      },
    },
  );

  assert.deepEqual(summaries, [["Complete the human check."]]);
  assert.deepEqual(shell.events, ["aria-invalid:true", "tabindex:-1", "focus"]);
});

test("sponsor validation returns only the exact public field error keys", () => {
  const errors = validateSponsorDraft({
    ...approvedMinimum,
    contactName: " ",
    organization: "x".repeat(161),
    email: "not-an-email",
    phone: "x".repeat(41),
    supportType: "billboard" as SponsorDraft["supportType"],
    contributionRange: "millions" as SponsorDraft["contributionRange"],
    desiredOutcome: "too short",
    acknowledgementAccepted: false,
    acknowledgementVersion: "2025.9",
    turnstileToken: "",
  });

  assert.deepEqual(Object.keys(errors).sort(), [
    "acknowledgementAccepted",
    "acknowledgementVersion",
    "contactName",
    "contributionRange",
    "desiredOutcome",
    "email",
    "organization",
    "phone",
    "supportType",
    "turnstileToken",
  ]);
  for (const message of Object.values(errors)) {
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0);
    assert.equal(/[<>]/.test(message), false);
  }
});

test("sponsor validation enforces text length boundaries", () => {
  assert.deepEqual(Object.keys(validateSponsorDraft({
    ...approvedMinimum,
    contactName: "x".repeat(101),
    organization: " ",
    email: `${"x".repeat(250)}@b.co`,
    desiredOutcome: "x".repeat(3001),
  })).sort(), ["contactName", "desiredOutcome", "email", "organization"]);
});

test("sponsor payload trims, normalizes, omits empty optionals, and uses an exact allowlist", () => {
  const draftWithUntrustedExtras = Object.assign(
    {},
    approvedMinimum,
    {
      contactName: "  Pat Sponsor  ",
      organization: "  Community Co-op  ",
      email: "  SPONSOR@EXAMPLE.TEST  ",
      phone: "   ",
      desiredOutcome: "  Help fund a welcoming community event.  ",
      turnstileToken: "  verified-token  ",
    },
    {
      password: "secret",
      sms: true,
      marketing: true,
      waiverAccepted: true,
      images: ["proposal.jpg"],
      hiddenArbitraryKey: "must-not-leak",
    },
  ) as SponsorDraft;

  const payload = buildSponsorPayload(draftWithUntrustedExtras);

  assert.deepEqual(payload, {
    contactName: "Pat Sponsor",
    organization: "Community Co-op",
    email: "sponsor@example.test",
    supportType: "community",
    desiredOutcome: "Help fund a welcoming community event.",
    acknowledgementAccepted: true,
    acknowledgementVersion: "2026.1",
    cfTurnstileResponse: "verified-token",
  });
  for (const forbidden of [
    "password",
    "sms",
    "marketing",
    "waiverAccepted",
    "images",
    "hiddenArbitraryKey",
  ]) {
    assert.equal(forbidden in payload, false);
  }
});

test("sponsor payload includes nonempty phone and contribution range", () => {
  assert.deepEqual(
    buildSponsorPayload({
      ...approvedMinimum,
      phone: "  +1 555 010 0200  ",
      contributionRange: "2500_4999",
    }),
    {
      contactName: "A",
      organization: "B",
      email: "a@b.co",
      phone: "+1 555 010 0200",
      supportType: "community",
      contributionRange: "2500_4999",
      desiredOutcome: "1234567890",
      acknowledgementAccepted: true,
      acknowledgementVersion: "2026.1",
      cfTurnstileResponse: "verified-token",
    },
  );
});

test("sponsor receipt parsing fails closed on malformed or incomplete envelopes", () => {
  assert.equal(parseSponsorReceipt(null), null);
  assert.equal(parseSponsorReceipt({ data: { referenceCode: "SP-12345678", state: "new" } }), null);
  assert.equal(parseSponsorReceipt({ data: { referenceCode: "", state: "received" } }), null);
  assert.deepEqual(
    parseSponsorReceipt({ data: { referenceCode: "SP-12AB34CD", state: "received", email: "private" } }),
    { referenceCode: "SP-12AB34CD" },
  );
});

test("sponsor response errors map to safe fixed copy", () => {
  assert.match(sponsorErrorCopy(409, "privacy_version_outdated"), /Privacy page/i);
  assert.match(sponsorErrorCopy(413), /too large/i);
  assert.match(sponsorErrorCopy(415), /unsupported/i);
  assert.equal(sponsorErrorCopy(422), "Review the form fields and try again.");
  assert.match(sponsorErrorCopy(429), /wait/i);
  assert.match(sponsorErrorCopy(503, "environment_mismatch"), /temporarily unavailable/i);
  assert.match(sponsorErrorCopy(0), /not confirmed/i);
  assert.equal(sponsorErrorCopy(500, "server-secret").includes("server-secret"), false);
});
