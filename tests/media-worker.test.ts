import assert from "node:assert/strict";
import test from "node:test";

import { processMediaMessage, type MediaMessage } from "../src/media-worker";

const bytes = (...values: number[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(values));
      controller.close();
    },
  });

function makeEnv(
  format = "image/jpeg",
  databaseChanges: number | undefined = undefined,
  sentinel = "validation",
  fileSize = 4,
  expectedKey = "originals/2026-07-11/field_note/media-1",
) {
  const puts: Array<{ key: string; options: Record<string, unknown> }> = [];
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const env = {
    UPLOADS: {
      async get(key: string) {
        if (key !== expectedKey) return null;
        return { body: bytes(0xff, 0xd8, 0xff, 0xd9) };
      },
      async put(key: string, _value: unknown, options: Record<string, unknown>) {
        puts.push({ key, options });
        return {};
      },
    },
    IMAGES: {
      async info(stream: ReadableStream<Uint8Array>) {
        await new Response(stream).arrayBuffer();
        return { format, fileSize, width: 1200, height: 800 };
      },
      input(stream: ReadableStream<Uint8Array>) {
        const transformer = {
          transform() {
            return transformer;
          },
          async output() {
            await new Response(stream).arrayBuffer();
            return { image: () => bytes(1, 2, 3), contentType: () => "image/webp" };
          },
        };
        return transformer;
      },
    },
    DB: {
      prepare(sql: string) {
        const statement = {
          values: [] as unknown[],
          bind(...values: unknown[]) {
            statement.values = values;
            return statement;
          },
          async run() {
            statements.push({ sql, values: statement.values });
            return { success: true, ...(databaseChanges === undefined ? {} : { meta: { changes: databaseChanges } }) };
          },
          async first() {
            return { environment: sentinel };
          },
        };
        return statement;
      },
    },
    DEPLOYMENT_ENV: "validation",
  };

  return { env, puts, statements };
}

const message: MediaMessage = {
  mediaId: "media-1",
  key: "originals/2026-07-11/field_note/media-1",
  ownerKind: "field_note",
};

test("re-encodes private uploads into metadata-free private derivatives", async () => {
  const { env, puts, statements } = makeEnv();
  const result = await processMediaMessage(message, env as never);

  assert.deepEqual(result, {
    status: "ready",
    derivativeKey: "derivatives/media-1.webp",
  });
  assert.equal(puts.length, 1);
  assert.equal(puts[0]?.key, "derivatives/media-1.webp");
  assert.deepEqual(puts[0]?.options, {
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: "private, no-store",
    },
    customMetadata: { mediaId: "media-1", derivative: "moderation" },
  });
  assert.match(statements.at(-1)?.sql ?? "", /status = 'ready'/);
  assert.deepEqual(statements.at(-1)?.values.slice(0, 2), [
    "derivatives/media-1.webp",
    "image/webp",
  ]);
});

test("rejects non-raster content without creating a derivative", async () => {
  const { env, puts, statements } = makeEnv("image/svg+xml");
  const result = await processMediaMessage(message, env as never);

  assert.deepEqual(result, { status: "rejected" });
  assert.equal(puts.length, 0);
  assert.match(statements.at(-1)?.sql ?? "", /status = 'rejected'/);
});

test("updates only the dedicated Official Update upload row", async () => {
  const updateMessage: MediaMessage = {
    mediaId: "media-update-1",
    key: "originals/2026-07-11/official_update/media-update-1",
    ownerKind: "official_update",
  };
  const { env, statements } = makeEnv(
    "image/jpeg",
    undefined,
    "validation",
    4,
    updateMessage.key,
  );
  assert.equal((await processMediaMessage(updateMessage, env as never)).status, "ready");
  assert.match(statements.at(-1)?.sql ?? "", /UPDATE official_update_uploads/);
  assert.doesNotMatch(statements.at(-1)?.sql ?? "", /UPDATE media_uploads/);
});

test("accepts exactly 20 MB and rejects one byte more", async () => {
  const accepted = makeEnv("image/jpeg", undefined, "validation", 20_000_000);
  assert.equal((await processMediaMessage(message, accepted.env as never)).status, "ready");
  assert.equal(accepted.puts.length, 1);

  const rejected = makeEnv("image/jpeg", undefined, "validation", 20_000_001);
  assert.deepEqual(await processMediaMessage(message, rejected.env as never), { status: "rejected" });
  assert.equal(rejected.puts.length, 0);
});

test("rejects untrusted object keys before touching storage", async () => {
  const { env, puts, statements } = makeEnv();
  await assert.rejects(
    processMediaMessage({ ...message, key: "../../source.jpg" }, env as never),
    /invalid media message/i,
  );
  assert.equal(puts.length, 0);
  assert.equal(statements.length, 0);
});

test("retries when queue delivery wins the race with the D1 owner insert", async () => {
  const { env, puts } = makeEnv("image/jpeg", 0);
  await assert.rejects(processMediaMessage(message, env as never), /record is not ready/i);
  assert.equal(puts.length, 1, "the deterministic derivative can be overwritten safely on retry");
});

test("rejects media work before R2 access when the D1 sentinel does not match", async () => {
  const { env, puts, statements } = makeEnv("image/jpeg", undefined, "production");
  await assert.rejects(
    processMediaMessage(message, env as never),
    (error: { code?: string }) => error.code === "environment_mismatch"
  );
  assert.equal(puts.length, 0);
  assert.equal(statements.length, 0);
});
