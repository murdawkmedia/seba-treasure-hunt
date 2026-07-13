import assert from "node:assert/strict";
import test from "node:test";

import {
  createSponsorSubmissionController,
  type SponsorAttemptOutcome,
  type SponsorSubmissionUi,
} from "../src/client/sponsor-submission";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class FakeUi implements SponsorSubmissionUi {
  states: Array<{ busy: boolean; unavailable: boolean }> = [];
  results: Array<{ copy: string; kind: "error" | "success" }> = [];
  humanErrors: string[] = [];
  humanUnavailable: string[] = [];
  humanClears = 0;
  formResets = 0;
  turnstileResets = 0;
  formValue = "draft-a";

  setSubmissionState(busy: boolean, unavailable: boolean): void {
    this.states.push({ busy, unavailable });
  }

  showResult(copy: string, kind: "error" | "success"): void {
    this.results.push({ copy, kind });
  }

  resetForm(): void {
    this.formResets += 1;
    this.formValue = "";
  }

  resetTurnstile(): void {
    this.turnstileResets += 1;
  }

  showHumanError(copy: string): void {
    this.humanErrors.push(copy);
  }

  clearHumanError(): void {
    this.humanClears += 1;
  }

  showHumanUnavailable(copy: string): void {
    this.humanUnavailable.push(copy);
  }
}

const makeFixture = () => {
  const ui = new FakeUi();
  const keys = ["key-a", "key-b", "key-c"];
  let keyIndex = 0;
  const controller = createSponsorSubmissionController({
    ui,
    makeIdempotencyKey: () => keys[keyIndex++] ?? `key-${keyIndex}`,
    uncertainCopy: "Submission was not confirmed.",
  });
  controller.humanVerified("token-a");
  return { controller, ui };
};

test("ordinary network and service failures keep one idempotency key for retry", async () => {
  const { controller, ui } = makeFixture();
  const first = controller.beginAttempt();
  assert.ok(first);
  await controller.runAttempt(first, async () => Promise.reject(new Error("network")));
  assert.equal(controller.snapshot().pendingIdempotencyKey, "key-a");
  assert.match(ui.results.at(-1)?.copy ?? "", /not confirmed/i);

  controller.humanVerified("token-b");
  const retry = controller.beginAttempt();
  assert.ok(retry);
  assert.equal(retry.idempotencyKey, "key-a");
  await controller.runAttempt(retry, async () => ({
    kind: "error",
    copy: "Sponsor inquiries are temporarily unavailable.",
  }));
  assert.equal(controller.snapshot().pendingIdempotencyKey, "key-a");
});

test("editing after a failed attempt clears its key and the next attempt gets a new key", async () => {
  const { controller } = makeFixture();
  const first = controller.beginAttempt();
  assert.ok(first);
  await controller.runAttempt(first, async () => ({ kind: "error", copy: "Try again." }));

  controller.markEdited();
  controller.humanVerified("token-b");
  const next = controller.beginAttempt();
  assert.ok(next);
  assert.equal(next.idempotencyKey, "key-b");
  assert.equal(next.revision, 1);
});

test("editing during a deferred success preserves newer values and reports the earlier version", async () => {
  const { controller, ui } = makeFixture();
  const response = deferred<SponsorAttemptOutcome>();
  const attempt = controller.beginAttempt();
  assert.ok(attempt);
  const running = controller.runAttempt(attempt, () => response.promise);

  ui.formValue = "draft-b";
  controller.markEdited();
  response.resolve({ kind: "success", referenceCode: "SP-12AB34CD" });
  await running;

  assert.equal(ui.formValue, "draft-b");
  assert.equal(ui.formResets, 0);
  assert.equal(ui.turnstileResets, 1);
  assert.match(ui.results.at(-1)?.copy ?? "", /earlier form version/i);
  assert.match(ui.results.at(-1)?.copy ?? "", /newer edits were not included/i);
  assert.equal(ui.results.at(-1)?.kind, "success");
});

test("a stale error does not replace newer field state with an old result", async () => {
  const { controller, ui } = makeFixture();
  const response = deferred<SponsorAttemptOutcome>();
  const attempt = controller.beginAttempt();
  assert.ok(attempt);
  const running = controller.runAttempt(attempt, () => response.promise);

  ui.formValue = "draft-b-with-errors";
  controller.markEdited();
  response.resolve({ kind: "error", copy: "Review the old highlighted fields." });
  await running;

  assert.equal(ui.formValue, "draft-b-with-errors");
  assert.doesNotMatch(ui.results.at(-1)?.copy ?? "", /highlighted|old fields/i);
  assert.match(ui.results.at(-1)?.copy ?? "", /earlier submission was not confirmed/i);
  assert.match(ui.results.at(-1)?.copy ?? "", /newer edits remain/i);
});

test("duplicate attempts are blocked while one request is in flight", async () => {
  const { controller } = makeFixture();
  const response = deferred<SponsorAttemptOutcome>();
  let requests = 0;
  const attempt = controller.beginAttempt();
  assert.ok(attempt);
  const running = controller.runAttempt(attempt, () => {
    requests += 1;
    return response.promise;
  });

  assert.equal(controller.beginAttempt(), null);
  assert.equal(requests, 1);
  response.resolve({ kind: "error", copy: "Try again." });
  await running;
});

test("an old attempt cannot overwrite a newer attempt's UI or Turnstile state", async () => {
  const { controller, ui } = makeFixture();
  const first = controller.beginAttempt();
  assert.ok(first);
  await controller.runAttempt(first, async () => ({ kind: "error", copy: "First error." }));
  controller.markEdited();
  controller.humanVerified("token-b");

  const newer = controller.beginAttempt();
  assert.ok(newer);
  const before = {
    results: ui.results.length,
    resets: ui.turnstileResets,
    states: ui.states.length,
  };
  let oldRequests = 0;
  const accepted = await controller.runAttempt(first, async () => {
    oldRequests += 1;
    return { kind: "success", referenceCode: "SP-OLD00001" };
  });

  assert.equal(accepted, false);
  assert.equal(oldRequests, 0);
  assert.deepEqual(
    { results: ui.results.length, resets: ui.turnstileResets, states: ui.states.length },
    before,
  );
  assert.equal(controller.snapshot().activeAttemptId, newer.id);
  assert.equal(controller.snapshot().inFlight, true);
});

test("normal success resets once, clears the key and human token, and reports the receipt", async () => {
  const { controller, ui } = makeFixture();
  const attempt = controller.beginAttempt();
  assert.ok(attempt);
  await controller.runAttempt(attempt, async () => ({
    kind: "success",
    referenceCode: "SP-12AB34CD",
  }));

  assert.equal(ui.formResets, 1);
  assert.equal(ui.turnstileResets, 1);
  assert.equal(controller.snapshot().pendingIdempotencyKey, undefined);
  assert.equal(controller.humanToken(), "");
  assert.equal(
    ui.results.at(-1)?.copy,
    "Inquiry SP-12AB34CD was received privately. Submission does not create a sponsorship agreement.",
  );
});

test("human verification expiry, failure, and reset remain fail closed across attempts", async () => {
  const { controller, ui } = makeFixture();
  const attempt = controller.beginAttempt();
  assert.ok(attempt);
  controller.humanExpired("Complete the human check again.");
  assert.equal(controller.humanToken(), "");
  assert.equal(controller.snapshot().pendingIdempotencyKey, "key-a");
  assert.match(ui.humanErrors.at(-1) ?? "", /again/i);

  controller.humanUnavailableNow("Human verification is unavailable.");
  assert.equal(controller.humanToken(), "");
  assert.equal(ui.states.at(-1)?.unavailable, true);
  assert.equal(ui.humanUnavailable.length, 1);

  await controller.runAttempt(attempt, async () => ({ kind: "error", copy: "Try again." }));
  assert.equal(ui.states.at(-1)?.unavailable, true, "attempt cleanup must not re-enable submission");
  assert.equal(controller.beginAttempt(), null);
});
