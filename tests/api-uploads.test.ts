import assert from "node:assert/strict";
import test from "node:test";
import { R2UploadStorage } from "../src/server/uploads";

class Bucket {
  objects = new Map<string, { body: unknown; type: string }>();
  deleted: string[] = [];

  async put(key: string, body: unknown, options: { httpMetadata: { contentType: string } }) {
    this.objects.set(key, { body, type: options.httpMetadata.contentType });
  }

  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

class Jobs {
  messages: unknown[] = [];
  async send(message: unknown) {
    this.messages.push(message);
  }
}

test("fails closed and removes an original when the required media queue is unavailable", async () => {
  const bucket = new Bucket();
  const storage = new R2UploadStorage(bucket as never, null);
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
    type: "image/jpeg"
  });

  await assert.rejects(
    storage.save([file], { kind: "report", subject: null }),
    (error: { code?: string }) => error.code === "uploads_unavailable"
  );
  assert.equal(bucket.objects.size, 0);
});

test("queues each private original for processing without returning a public URL", async () => {
  const bucket = new Bucket();
  const jobs = new Jobs();
  const storage = new R2UploadStorage(bucket as never, jobs as never);
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
    type: "image/jpeg"
  });

  const [media] = await storage.save([file], { kind: "field_note", subject: "hunter-1" });

  if (!media) throw new Error("expected one queued media record");
  assert.equal(media.status, "processing");
  assert.equal("url" in media, false);
  assert.equal(jobs.messages.length, 1);
  assert.deepEqual(jobs.messages[0], {
    mediaId: media.id,
    key: media.key,
    ownerKind: "field_note"
  });
});

test("queues direct Official Update media in its own private owner namespace", async () => {
  const bucket = new Bucket();
  const jobs = new Jobs();
  const storage = new R2UploadStorage(bucket as never, jobs as never);
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "update.jpg", {
    type: "image/jpeg"
  });

  const [media] = await storage.save([file], { kind: "official_update", subject: "staff-1" });
  assert.ok(media);
  assert.match(media.key, /^originals\/\d{4}-\d{2}-\d{2}\/official_update\//);
  assert.deepEqual(jobs.messages[0], {
    mediaId: media.id,
    key: media.key,
    ownerKind: "official_update"
  });
});
