import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedTurnstileHost, TurnstileVerifier } from "../src/server/turnstile";

test("Turnstile hostname checks match Cloudflare's exact-or-subdomain rule", () => {
  const allowed = ["www.timlostsomething.com", "seba-treasure-hunt.pages.dev"];
  assert.equal(isAllowedTurnstileHost("www.timlostsomething.com", allowed), true);
  assert.equal(isAllowedTurnstileHost("codex-validation.seba-treasure-hunt.pages.dev", allowed), true);
  assert.equal(isAllowedTurnstileHost("d2d3e5b6.seba-treasure-hunt.pages.dev", allowed), true);
  assert.equal(isAllowedTurnstileHost("timlostsomething.com", allowed), false);
  assert.equal(isAllowedTurnstileHost("evilseba-treasure-hunt.pages.dev", allowed), false);
  assert.equal(isAllowedTurnstileHost("seba-treasure-hunt.pages.dev.attacker.test", allowed), false);
});

test("Cloudflare's always-pass test key is accepted only when validation explicitly enables it", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    action: "test",
    hostname: "example.com"
  }), { headers: { "content-type": "application/json" } });
  try {
    const secret = "1x0000000000000000000000000000000AA";
    const request = new Request("https://codex-validation.seba-treasure-hunt.pages.dev/report");
    assert.equal(await new TurnstileVerifier(secret, ["codex-validation.seba-treasure-hunt.pages.dev"], true).verify("token", "report", request), true);
    assert.equal(await new TurnstileVerifier(secret, ["codex-validation.seba-treasure-hunt.pages.dev"], false).verify("token", "report", request), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
