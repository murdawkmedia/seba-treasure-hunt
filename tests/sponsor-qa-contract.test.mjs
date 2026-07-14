import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("sponsor QA has a durable read-only command, evidence record, and machine-neutral handoff", async () => {
  const [packageText, script, record, status] = await Promise.all([
    read("package.json"),
    read("scripts/verify-sponsor-qa.mjs"),
    read("docs/qa/2026-07-13-sponsor-feature-verification.md"),
    read("STATUS.md"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.scripts["verify:sponsor-qa"], "node scripts/verify-sponsor-qa.mjs");

  assert.match(script, /from ["']@playwright\/test["']/);
  assert.match(script, /from ["']axe-core["']/);
  assert.match(script, /SPONSOR_QA_BASE_URL/);
  assert.match(script, /http:\/\/127\.0\.0\.1:8788/);
  assert.match(script, /path\.join\(os\.tmpdir\(\),\s*["']tim-lost-task10["']\)/);
  assert.match(script, /sha256/i);
  assert.match(script, /wcag2a["'],\s*["']wcag2aa["'],\s*["']wcag21a["'],\s*["']wcag21aa/);
  assert.match(script, /1440[^\n]+1000/);
  assert.match(script, /390[^\n]+844/);
  assert.match(script, /720[^\n]+500/);
  assert.match(script, /alex@example\.test\|Good local fit\|staff_subject/);
  assert.match(script, /sponsor_inquiries\|sponsor_inquiry_events\|private note\|@sebahub/);
  assert.match(script, /CFCW/);
  assert.match(script, /\/_worker\.js/);
  assert.match(script, /\/api\/v1\/ops\/sponsors/);
  assert.match(script, /\/api\/v1\/sponsors\/inquiries/);
  assert.match(script, /sponsorPosts/);
  assert.match(script, /staff_auth_required/);
  assert.match(script, /data-sponsor-form/);
  assert.match(script, /data-sponsor-turnstile/);
  assert.match(script, /aria-invalid/);
  assert.match(script, /test-only mocked/i);
  assert.match(script, /\.validation-environment-notice/);
  assert.match(script, /initial validation notice must remain non-sticky/i);
  assert.match(script, /initial first-row top after validation notice/i);
  assert.match(script, /initial first-row top without validation notice/i);
  assert.match(script, /window\.scrollTo/);
  assert.match(script, /mouse\.wheel/);
  assert.match(script, /#inquiry[^\n]*scrollIntoView\([^\n]*block:\s*["']start["']/);
  assert.match(script, /inquiryTop\s*>=\s*postScrollGeometry\.stack/);
  assert.match(script, /atInitialFlow[^]*scrollPastNoticeAndAssertStickyRows/);
  assert.match(script, /assertStickyRowsAfterSurfaceScroll/);
  assert.match(script, /scroll action must move past the validation notice/i);
  assert.doesNotMatch(script, /a\[href=["']#inquiry["']\][^\n]*\.click\(/);
  assert.match(script, /waitForFunction[^]*scrolled first-row/i);
  assert.match(script, /scrolled first-row top/);
  assert.match(script, /const validationNoticeFixture/);
  assert.match(script, /async function validationNoticeGeometry/);
  assert.match(script, /beforeCount === 0[^]*insertAdjacentHTML/);
  assert.match(script, /afterCount[^]*assert\.equal\([^,]+,\s*1/);
  assert.match(script, /checks\.validationNoticeGeometry\s*=\s*await validationNoticeGeometry/);
  assert.match(script, /Validation notice fixture[^]*sponsorPosts/);

  assert.match(record, /2026-07-13/);
  assert.match(record, /npm run build/);
  assert.match(record, /npm run dev/);
  assert.match(record, /npm run verify:sponsor-qa/);
  assert.match(record, /@playwright\/test[^\n]*1\.61\.1/);
  assert.match(record, /axe-core[^\n]*4\.12\.1/);
  assert.match(record, /WCAG 2\.0 A\/AA[^\n]*WCAG 2\.1 A\/AA/i);
  assert.match(record, /zero sponsor POST/i);
  assert.match(record, /authenticated Ops[^\n]*Task 11/i);
  assert.match(record, /sponsor_inquiries\|sponsor_inquiry_events\|private note\|@sebahub/);
  assert.match(record, /SHA-256/i);
  assert.match(record, /initial validation notice[^\n]*non-sticky/i);
  assert.match(record, /after[^\n]*scroll[^\n]*sticky[^\n]*top 0/i);
  assert.match(record, /injects[^\n]*validation notice[^\n]*only when[^\n]*lacks/i);

  assert.match(status, /docs\/qa\/2026-07-13-sponsor-feature-verification\.md/);
  assert.match(status, /scripts\/verify-sponsor-qa\.mjs/);
  assert.match(status, /%TEMP%\\tim-lost-task10/);
  assert.doesNotMatch(status, /C:\/Users\/Murphy\/AppData\/Local\/Temp\/tim-lost-task10/i);
  assert.doesNotMatch(status, /launcher PID|listening Worker PID/i);
});
