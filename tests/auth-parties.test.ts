import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedAuthorizedParty } from "../src/server/auth";

test("identity authorized parties allow production and this project's Pages previews only", () => {
  const configured = "https://www.timlostsomething.com,https://seba-treasure-hunt.pages.dev";
  assert.equal(isAllowedAuthorizedParty("https://www.timlostsomething.com", configured), true);
  assert.equal(isAllowedAuthorizedParty("https://codex-validation.seba-treasure-hunt.pages.dev", configured), true);
  assert.equal(isAllowedAuthorizedParty("https://d2d3e5b6.seba-treasure-hunt.pages.dev", configured), true);
  assert.equal(isAllowedAuthorizedParty("https://timlostsomething.com", configured), false);
  assert.equal(isAllowedAuthorizedParty("http://www.timlostsomething.com", configured), false);
  assert.equal(isAllowedAuthorizedParty("https://seba-treasure-hunt.pages.dev.attacker.test", configured), false);
  assert.equal(isAllowedAuthorizedParty("https://attacker.test/?next=https://www.timlostsomething.com", configured), false);
});

test("the validation party does not authorize immutable Pages deployment hosts", () => {
  const configured = "https://codex-validation.seba-treasure-hunt.pages.dev";
  assert.equal(
    isAllowedAuthorizedParty("https://codex-validation.seba-treasure-hunt.pages.dev", configured),
    true
  );
  assert.equal(
    isAllowedAuthorizedParty("https://d2d3e5b6.seba-treasure-hunt.pages.dev", configured),
    false
  );
});
