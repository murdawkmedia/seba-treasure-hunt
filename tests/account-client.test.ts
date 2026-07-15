import assert from "node:assert/strict";
import test from "node:test";

import { campaignAccountModel } from "../src/client/account";

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
