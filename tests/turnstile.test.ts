import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedTurnstileHost } from "../src/server/turnstile";

test("Turnstile hostname checks match Cloudflare's exact-or-subdomain rule", () => {
  const allowed = ["www.timlostsomething.com", "seba-treasure-hunt.pages.dev"];
  assert.equal(isAllowedTurnstileHost("www.timlostsomething.com", allowed), true);
  assert.equal(isAllowedTurnstileHost("codex-validation.seba-treasure-hunt.pages.dev", allowed), true);
  assert.equal(isAllowedTurnstileHost("d2d3e5b6.seba-treasure-hunt.pages.dev", allowed), true);
  assert.equal(isAllowedTurnstileHost("timlostsomething.com", allowed), false);
  assert.equal(isAllowedTurnstileHost("evilseba-treasure-hunt.pages.dev", allowed), false);
  assert.equal(isAllowedTurnstileHost("seba-treasure-hunt.pages.dev.attacker.test", allowed), false);
});
