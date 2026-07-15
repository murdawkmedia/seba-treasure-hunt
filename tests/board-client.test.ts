import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/client/board.ts", import.meta.url), "utf8");

const occurrences = (value: string): number => source.split(value).length - 1;

test("board initialization uses only the dashboard session request for auth state", () => {
  assert.equal(occurrences('requestJson("/api/v1/me/dashboard")'), 1);
  assert.equal(occurrences('requestJson("/api/v1/status")'), 0);
  assert.doesNotMatch(source, /\bsetCaseStatus\b|#case-signal/);
});

test("dashboard session success and failure keep board participation fail closed", () => {
  assert.match(
    source,
    /try\s*\{\s*const session = await requestJson\("\/api\/v1\/me\/dashboard"\);\s*signedIn = session\.response\.ok;\s*noteForm\.hidden = !signedIn;\s*authPrompt\.hidden = signedIn;\s*\}\s*catch\s*\{\s*signedIn = false;\s*noteForm\.hidden = true;\s*authPrompt\.hidden = false;\s*\}/s,
  );
  assert.match(source, /render\(\{ kind: "ready", notes, canReply: signedIn \}\)/);
  assert.match(source, /if \(!signedIn\)\s*\{\s*window\.location\.assign\("\/dashboard#sign-in"\)/s);
});

test("board writes retain auth, moderation, Turnstile, and upload guardrails", () => {
  assert.match(source, /const maxImages = 3/);
  assert.match(source, /const maxImageBytes = 10 \* 1024 \* 1024/);
  assert.match(source, /allowedImageTypes = new Set\(\["image\/jpeg", "image\/png", "image\/webp"\]\)/);
  assert.match(source, /action: "field_note"/);
  assert.match(source, /action: "reply"/);
  assert.match(source, /action: "flag"/);
  assert.match(source, /authHeaders\(/);
  assert.match(source, /requestJson\("\/api\/v1\/board\/notes", \{ method: "POST"/);
  assert.match(source, /\/api\/v1\/board\/notes\/\$\{encodeURIComponent\(noteId\)\}\/replies/);
  assert.match(source, /\/api\/v1\/board\/\$\{encodeURIComponent\(target\.kind\)\}\/\$\{encodeURIComponent\(target\.id\)\}\/flags/);
  assert.doesNotMatch(source, /dataset\.state[\s\S]{0,240}(?:method: "POST"|authHeaders\()/);
});
