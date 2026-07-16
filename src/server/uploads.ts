import { ApiError } from "./errors";
import type { MediaJob, StoredMedia, UploadStorage } from "./types";

const objectDate = () => new Date().toISOString().slice(0, 10);

export class R2UploadStorage implements UploadStorage {
  constructor(
    private readonly bucket: R2Bucket | null,
    private readonly queue: Queue<MediaJob> | null
  ) {}

  async save(
    files: File[],
    context: { kind: "field_note" | "report"; subject: string | null }
  ): Promise<StoredMedia[]> {
    if (files.length === 0) return [];
    if (!this.bucket || !this.queue) {
      throw new ApiError(503, "uploads_unavailable", "Private image uploads are temporarily unavailable.");
    }

    const saved: StoredMedia[] = [];
    try {
      for (const file of files) {
        const id = crypto.randomUUID();
        const key = `originals/${objectDate()}/${context.kind}/${id}`;
        await this.bucket.put(key, file.stream(), {
          httpMetadata: { contentType: file.type }
        });
        saved.push({
          id,
          key,
          contentType: file.type,
          size: file.size,
          status: "processing"
        });
        await this.queue.send({ mediaId: id, key, ownerKind: context.kind });
      }
      return saved;
    } catch {
      await Promise.all(saved.map((media) => this.bucket!.delete(media.key).catch(() => undefined)));
      throw new ApiError(503, "uploads_unavailable", "Private image uploads are temporarily unavailable.");
    }
  }

  async read(key: string) {
    if (!this.bucket || !key.startsWith("derivatives/")) return null;
    const object = await this.bucket.get(key);
    if (!object?.body) return null;
    const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
    return {
      body: object.body,
      contentType,
      etag: object.httpEtag ?? null
    };
  }
}
