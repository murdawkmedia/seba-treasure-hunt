import assert from "node:assert/strict";
import test from "node:test";

import {
  createSerializedSubmission,
  resolvePublicAttribution,
} from "../src/client/identity-submission";

test("serialized identity submissions ignore a concurrent duplicate and unlock after settlement", async () => {
  let release!: () => void;
  let calls = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const submit = createSerializedSubmission(async () => {
    calls += 1;
    await pending;
    return calls;
  });

  const first = submit();
  const duplicate = await submit();
  assert.equal(duplicate, null);
  assert.equal(calls, 1);

  release();
  assert.equal(await first, 1);
  assert.equal(await submit(), 2);
});

test("public attribution uses only explicit adult choices and safe fixed fallbacks", () => {
  const adult = {
    participationBasis: "adult",
    publicDisplayName: "Nancy & Ron",
    publicHandle: "Hunter 43BA",
  } as const;
  assert.deepEqual(resolvePublicAttribution(adult, "display_name"), {
    kind: "display_name",
    label: "Nancy & Ron",
  });
  assert.deepEqual(resolvePublicAttribution(adult, "hunter_handle"), {
    kind: "hunter_handle",
    label: "Hunter 43BA",
  });
  assert.deepEqual(resolvePublicAttribution(adult, "community"), {
    kind: "community",
    label: "Community Hunter",
  });
  assert.deepEqual(
    resolvePublicAttribution({ ...adult, participationBasis: "minor_guardian_permission" }, "display_name"),
    { kind: "young_hunter", label: "Young Hunter" },
  );
  assert.deepEqual(resolvePublicAttribution(null, "display_name"), {
    kind: "community",
    label: "Community Hunter",
  });
});

test("public attribution falls back without exposing a legal name or email", () => {
  const resolved = resolvePublicAttribution({
    participationBasis: "adult",
    publicDisplayName: "",
    publicHandle: "",
  }, "display_name");
  assert.deepEqual(resolved, { kind: "community", label: "Community Hunter" });
  assert.equal(JSON.stringify(resolved).includes("private@example.ca"), false);
  assert.equal(JSON.stringify(resolved).includes("Private Legal Name"), false);
});
