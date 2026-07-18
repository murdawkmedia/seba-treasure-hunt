import assert from "node:assert/strict";
import test from "node:test";

import { campaignAccountModel } from "../src/client/account";
import { provisioningFailureMessage } from "../src/client/dashboard";

test("campaign account presentation uses the privacy-safe handle and never derives identity from email", () => {
  assert.deepEqual(campaignAccountModel(null, null), {
    signedIn: false,
    handle: "Sign in",
    avatarUrl: null,
    initial: "?",
  });
  assert.deepEqual(
    campaignAccountModel(
      { imageUrl: "https://img.clerk.test/avatar.png" },
      { publicHandle: "Hunter A1B2", email: "private.name@example.test", fullName: "Private Name" },
    ),
    {
      signedIn: true,
      handle: "Hunter A1B2",
      avatarUrl: "https://img.clerk.test/avatar.png",
      initial: "H",
    },
  );
});

test("campaign account presentation uses the custom public display name", () => {
  assert.deepEqual(
    campaignAccountModel(
      { imageUrl: "https://img.clerk.test/avatar.png" },
      { publicDisplayName: "Nancy & Ron", publicHandle: "Hunter 43BA" },
    ),
    {
      signedIn: true,
      handle: "Nancy & Ron",
      avatarUrl: "https://img.clerk.test/avatar.png",
      initial: "N",
    },
  );
});

test("verified-account provisioning guidance never presents a password or bad-login failure", () => {
  const transient = provisioningFailureMessage("retryable");
  const terminal = provisioningFailureMessage("terminal");
  for (const copy of [transient, terminal]) {
    assert.match(copy, /email (?:is )?verified/i);
    assert.match(copy, /try again|refresh/i);
    assert.doesNotMatch(copy, /password|bad login|invalid credentials|database|webhook|Clerk/i);
  }
});
