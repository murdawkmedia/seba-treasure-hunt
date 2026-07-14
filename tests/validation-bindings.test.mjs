import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagesConfig = await readFile("wrangler.toml", "utf8");
const mediaConfig = await readFile("wrangler.media.toml", "utf8");
const envExample = await readFile(".env.example", "utf8");
const readme = await readFile("README.md", "utf8");

const section = (source, heading) => {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `${heading} must exist`);
  const rest = source.slice(start + heading.length);
  const next = rest.search(/^\[(?!\[)/m);
  return next === -1 ? rest : rest.slice(0, next);
};

test("Pages preview overrides every stateful production binding", () => {
  const preview = pagesConfig.slice(pagesConfig.indexOf("[env.preview.vars]"));
  assert.match(preview, /DEPLOYMENT_ENV\s*=\s*"validation"/);
  assert.match(preview, /codex-validation\.seba-treasure-hunt\.pages\.dev/);
  assert.match(preview, /database_name\s*=\s*"tim-lost-hunter-platform-validation"/);
  assert.match(preview, /bucket_name\s*=\s*"tim-lost-private-media-validation"/);
  assert.match(preview, /queue\s*=\s*"tim-lost-media-processing-validation"/);
  assert.doesNotMatch(pagesConfig, /RATE_LIMITS|kv_namespaces/);
  assert.doesNotMatch(pagesConfig, /\[(?:env\.preview\.)?images\]/);

  assert.doesNotMatch(
    preview,
    /database_name\s*=\s*"tim-lost-hunter-platform"\s*$/m
  );
  assert.doesNotMatch(preview, /bucket_name\s*=\s*"tim-lost-private-media"\s*$/m);
  assert.doesNotMatch(preview, /queue\s*=\s*"tim-lost-media-processing"\s*$/m);
});

test("production is explicitly identified and keeps its current resource bindings", () => {
  const productionVars = section(pagesConfig, "[vars]");
  assert.match(productionVars, /DEPLOYMENT_ENV\s*=\s*"production"/);
  assert.match(pagesConfig, /database_name\s*=\s*"tim-lost-hunter-platform"\s*$/m);
  assert.match(pagesConfig, /bucket_name\s*=\s*"tim-lost-private-media"\s*$/m);
  assert.match(pagesConfig, /queue\s*=\s*"tim-lost-media-processing"\s*$/m);
});

test("the media worker has a validation environment with no production data binding", () => {
  const validation = mediaConfig.slice(mediaConfig.indexOf("[env.validation.vars]"));
  assert.match(validation, /DEPLOYMENT_ENV\s*=\s*"validation"/);
  assert.match(validation, /database_name\s*=\s*"tim-lost-hunter-platform-validation"/);
  assert.match(validation, /bucket_name\s*=\s*"tim-lost-private-media-validation"/);
  assert.match(validation, /queue\s*=\s*"tim-lost-media-processing-validation"/);
  assert.match(validation, /dead_letter_queue\s*=\s*"tim-lost-media-dlq-validation"/);
});

test("tracked Preview guidance names every Graph setting without credential values", () => {
  const providerSettings = [
    "TRANSACTIONAL_EMAIL_PROVIDER",
    "GRAPH_CLIENT_ID",
    "GRAPH_TENANT_ID",
    "GRAPH_REFRESH_TOKEN_BOOTSTRAP",
    "GRAPH_TOKEN_ENCRYPTION_KEY",
    "GRAPH_TOKEN_KEY_VERSION",
    "TRANSACTIONAL_EMAIL_FROM_ADDRESS",
    "TRANSACTIONAL_EMAIL_FROM_NAME",
    "TRANSACTIONAL_EMAIL_REPLY_TO"
  ];
  for (const setting of providerSettings) {
    assert.match(envExample, new RegExp(`^${setting}=$`, "m"));
    assert.match(readme, new RegExp(`\\b${setting}\\b`));
  }
  assert.match(readme, /Microsoft Graph is active only when `TRANSACTIONAL_EMAIL_PROVIDER=microsoft_graph`/);
  assert.match(readme, /casey@sebahub\.com/);
  assert.match(readme, /encrypted rotations/i);
  assert.match(readme, /revoked or expired/i);
  assert.match(readme, /scripts\/graph-device-login\.mjs/);
  assert.match(readme, /Cloudflare Pages Preview secret/i);
  assert.doesNotMatch(readme, /wrangler pages secret put/i);
  assert.doesNotMatch(envExample, /RESEND_API_KEY_SEBAHUB_PENDING/);
});
