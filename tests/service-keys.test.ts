import assert from "node:assert/strict";
import test from "node:test";
import {
  createServiceKeyMaterial,
  hashServiceKey,
  parseServiceKey,
  serviceKeyPrefix,
} from "../src/server/service-keys";

test("creates an environment-bound key and stores only non-secret material", async () => {
  const material = await createServiceKeyMaterial({
    environment: "validation",
    pepper: "test-pepper",
    id: "key-123",
    randomBytes: new Uint8Array(32).fill(7),
  });

  assert.match(material.plaintext, /^tls_val_key-123_[A-Za-z0-9_-]{43}$/);
  assert.equal(material.record.id, "key-123");
  assert.equal(material.record.environment, "validation");
  assert.equal(material.record.prefix, serviceKeyPrefix(material.plaintext));
  assert.equal(material.record.hash, await hashServiceKey(material.plaintext, "test-pepper"));
  assert.equal(JSON.stringify(material.record).includes(material.plaintext), false);
});

test("parses production and validation keys but rejects malformed or cross-environment keys", () => {
  const validation = "tls_val_12345678_secret";
  const production = "tls_prod_abcdefgh_secret";

  assert.deepEqual(parseServiceKey(validation, "validation"), {
    environment: "validation",
    id: "12345678",
  });
  assert.deepEqual(parseServiceKey(production, "production"), {
    environment: "production",
    id: "abcdefgh",
  });
  assert.equal(parseServiceKey(validation, "production"), null);
  assert.equal(parseServiceKey("Bearer tls_val_123_secret", "validation"), null);
  assert.equal(parseServiceKey("tls_val_missing-secret", "validation"), null);
});

test("hashes the entire key with a required pepper", async () => {
  const first = await hashServiceKey("tls_val_key_secret-a", "pepper-a");
  const second = await hashServiceKey("tls_val_key_secret-b", "pepper-a");
  const third = await hashServiceKey("tls_val_key_secret-a", "pepper-b");

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  await assert.rejects(() => hashServiceKey("tls_val_key_secret", ""), /pepper/i);
});
