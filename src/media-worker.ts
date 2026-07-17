import { D1EnvironmentGuard } from "./server/environment-guard";
import { REPORT_IMAGE_DIRECT_BYTES } from "./shared/report-image-limits";
import type { DeploymentEnvironment } from "./server/types";

export interface MediaMessage {
  mediaId: string;
  key: string;
  ownerKind: "field_note" | "report";
}

export interface MediaEnv {
  UPLOADS: R2Bucket;
  DB: D1Database;
  IMAGES: ImagesBinding;
  DEPLOYMENT_ENV?: DeploymentEnvironment;
}

type MediaResult =
  | { status: "ready"; derivativeKey: string }
  | { status: "rejected" };

class InvalidMediaMessageError extends Error {
  constructor() {
    super("Invalid media message.");
  }
}

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const safeRasterFormats = new Set(["image/jpeg", "image/png", "image/webp"]);

function assertMessage(message: MediaMessage): void {
  if (!message || !idPattern.test(message.mediaId)) throw new InvalidMediaMessageError();
  if (message.ownerKind !== "field_note" && message.ownerKind !== "report") {
    throw new InvalidMediaMessageError();
  }

  const escapedId = message.mediaId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expected = new RegExp(
    `^originals/\\d{4}-\\d{2}-\\d{2}/${message.ownerKind}/${escapedId}$`,
  );
  if (!expected.test(message.key) || message.key.includes("..")) {
    throw new InvalidMediaMessageError();
  }
}

async function rejectMedia(mediaId: string, env: MediaEnv): Promise<MediaResult> {
  const update = await env.DB.prepare(
    `UPDATE media_uploads
     SET status = 'rejected', processed_at = datetime('now')
     WHERE id = ? AND status = 'processing'`,
  )
    .bind(mediaId)
    .run();
  const changes = (update as { meta?: { changes?: number } }).meta?.changes;
  if (changes === 0) throw new Error("Media database record is not ready.");
  return { status: "rejected" };
}

export async function processMediaMessage(
  message: MediaMessage,
  env: MediaEnv,
): Promise<MediaResult> {
  assertMessage(message);
  await new D1EnvironmentGuard(env.DB, env.DEPLOYMENT_ENV ?? null).assertWritable();

  const original = await env.UPLOADS.get(message.key);
  if (!original) throw new Error("Private media object is temporarily unavailable.");

  const [infoStream, transformStream] = original.body.tee();
  const info = await env.IMAGES.info(infoStream);
  const isRaster = "width" in info && "height" in info && "fileSize" in info;
  const isSafe =
    isRaster &&
    safeRasterFormats.has(info.format) &&
    info.fileSize > 0 &&
    info.fileSize <= REPORT_IMAGE_DIRECT_BYTES &&
    info.width > 0 &&
    info.height > 0 &&
    info.width <= 12_000 &&
    info.height <= 12_000 &&
    info.width * info.height <= 40_000_000;

  if (!isSafe) {
    await transformStream.cancel();
    return rejectMedia(message.mediaId, env);
  }

  // A new WebP derivative intentionally carries pixels only. It is the sole
  // representation eligible for moderated public delivery; the original stays
  // private as evidence and is never returned by the public API.
  const transformed = await env.IMAGES.input(transformStream)
    .transform({ width: 1600, height: 1600, fit: "scale-down" })
    .output({ format: "image/webp", quality: 82, anim: false });

  const derivativeKey = `derivatives/${message.mediaId}.webp`;
  await env.UPLOADS.put(derivativeKey, transformed.image(), {
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: "private, no-store",
    },
    customMetadata: {
      mediaId: message.mediaId,
      derivative: "moderation",
    },
  });

  const update = await env.DB.prepare(
    `UPDATE media_uploads
     SET derivative_object_key = ?, content_type = ?, status = 'ready',
         processed_at = datetime('now')
     WHERE id = ? AND private_object_key = ? AND status = 'processing'`,
  )
    .bind(derivativeKey, transformed.contentType(), message.mediaId, message.key)
    .run();

  // The upload producer intentionally queues immediately after the private R2
  // write, so a fast consumer can beat the request's D1 owner insert. Do not
  // acknowledge that race: retry until the authoritative row exists.
  const changes = (update as { meta?: { changes?: number } }).meta?.changes;
  if (changes === 0) throw new Error("Media database record is not ready.");

  return { status: "ready", derivativeKey };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        { ok: true, service: "media-processor" },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },

  async queue(batch: MessageBatch<MediaMessage>, env: MediaEnv): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processMediaMessage(message.body, env);
        message.ack();
      } catch (error) {
        if (error instanceof InvalidMediaMessageError) {
          // Poison messages contain no trusted record identifier and cannot be
          // repaired by retrying. Acknowledge them without touching storage.
          message.ack();
          continue;
        }
        const delaySeconds = Math.min(900, 15 * 2 ** Math.max(0, message.attempts - 1));
        message.retry({ delaySeconds });
      }
    }
  },
} satisfies ExportedHandler<MediaEnv, MediaMessage>;
