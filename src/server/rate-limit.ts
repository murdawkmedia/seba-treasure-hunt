import { ApiError } from "./errors";
import type { RateLimiter, RateLimitInput } from "./types";

const encoder = new TextEncoder();

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

type RateLimitCountRow = { identifier_hash: string };

export class D1RateLimiter implements RateLimiter {
  constructor(
    private readonly database: D1Database | null,
    private readonly salt: string | null,
    private readonly clock: () => number = Date.now
  ) {}

  async consume(input: RateLimitInput): Promise<{ allowed: boolean; retryAfter: number }> {
    if (
      !this.database ||
      !this.salt ||
      this.salt.length < 8 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      !Number.isSafeInteger(input.windowSeconds) ||
      input.windowSeconds < 1
    ) {
      throw new ApiError(
        503,
        "rate_limit_unavailable",
        "Abuse protection is temporarily unavailable. Try again later."
      );
    }
    const currentTime = Math.floor(this.clock() / 1_000);
    const windowStartedAt = Math.floor(currentTime / input.windowSeconds) * input.windowSeconds;
    const windowExpiresAt = windowStartedAt + input.windowSeconds;
    const identifiers = [
      ...new Set(input.identifiers.length > 0 ? input.identifiers : ["client-unavailable"])
    ];
    const hashes = await Promise.all(
      identifiers.map((identifier) =>
        sha256(`tim-lost-rate-limit:v2\0${this.salt}\0${input.scope}\0${identifier}`)
      )
    );
    const retryAfter = Math.max(1, windowExpiresAt - currentTime);

    try {
      await this.database
        .prepare("DELETE FROM campaign_rate_limit_buckets WHERE window_expires_at <= ?")
        .bind(currentTime)
        .run();
      const values = hashes.map(() => "(?, ?, ?, ?, 1)").join(", ");
      const bindings = hashes.flatMap((hash) => [
        input.scope,
        hash,
        windowStartedAt,
        windowExpiresAt
      ]);
      const result = await this.database
        .prepare(
          `INSERT INTO campaign_rate_limit_buckets
           (scope, identifier_hash, window_started_at, window_expires_at, request_count)
           VALUES ${values}
           ON CONFLICT(scope, identifier_hash, window_started_at) DO UPDATE SET
             request_count = campaign_rate_limit_buckets.request_count + 1
           WHERE campaign_rate_limit_buckets.request_count < ?
           RETURNING identifier_hash`
        )
        .bind(...bindings, input.limit)
        .all<RateLimitCountRow>();
      // The one atomic statement charges every non-exhausted bucket even if another bucket
      // rejects the request. Denied attempts therefore cannot preserve a fresh rotating bucket.
      return { allowed: result.results.length === hashes.length, retryAfter };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "rate_limit_unavailable",
        "Abuse protection is temporarily unavailable. Try again later."
      );
    }
  }
}
