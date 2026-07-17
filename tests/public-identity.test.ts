import assert from "node:assert/strict";
import test from "node:test";

import { privateAccountIdentity, publicHunterIdentity } from "../src/shared/public-identity";

test("public hunter identity prefers an adult custom display name", () => {
  assert.equal(
    publicHunterIdentity({
      participationBasis: "adult",
      publicDisplayName: "Nancy & Ron",
      publicHandle: "Hunter 43BA"
    }),
    "Nancy & Ron"
  );
});

test("public hunter identity falls back to an adult handle", () => {
  assert.equal(
    publicHunterIdentity({ participationBasis: "adult", publicHandle: "Hunter 43BA" }),
    "Hunter 43BA"
  );
});

test("public hunter identity never exposes a minor custom name or handle", () => {
  assert.equal(
    publicHunterIdentity({
      participationBasis: "minor_guardian_permission",
      publicDisplayName: "Private Minor Name",
      publicHandle: "Hunter Minor"
    }),
    "Young Hunter"
  );
});

test("private account identity may use a custom display name", () => {
  assert.equal(
    privateAccountIdentity({ publicDisplayName: "Nancy & Ron", publicHandle: "Hunter 43BA" }),
    "Nancy & Ron"
  );
});

test("identity resolvers ignore malformed profile name fields", () => {
  const malformedDisplayName = {
    publicDisplayName: 42 as unknown as string,
    publicHandle: "Hunter 43BA"
  };
  assert.equal(publicHunterIdentity(malformedDisplayName), "Hunter 43BA");
  assert.equal(privateAccountIdentity(malformedDisplayName), "Hunter 43BA");

  const malformedHandle = {
    publicDisplayName: null,
    publicHandle: 42 as unknown as string
  };
  assert.equal(publicHunterIdentity(malformedHandle), "Community Hunter");
  assert.equal(privateAccountIdentity(malformedHandle), "Hunter");

  const bothMalformed = {
    publicDisplayName: 42 as unknown as string,
    publicHandle: 7 as unknown as string
  };
  assert.equal(publicHunterIdentity(bothMalformed), "Community Hunter");
  assert.equal(privateAccountIdentity(bothMalformed), "Hunter");
});
