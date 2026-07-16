import assert from "node:assert/strict";
import test from "node:test";

import { createSerializedSubmission } from "../src/client/identity-submission";

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
