import { ApiError } from "./errors";
import type { RateLimiter, RateLimitInput } from "./types";

const encoder = new TextEncoder();

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export class KvRateLimiter implements RateLimiter {
  constructor(
    private readonly kv: KVNamespace | null,
    private readonly salt: string | null
  ) {}

  async consume(input: RateLimitInput): Promise<{ allowed: boolean; retryAfter: number }> {
    if (!this.kv || !this.salt || this.salt.length < 8) {
      throw new ApiError(
        503,
        "rate_limit_unavailable",
        "Abuse protection is temporarily unavailable. Try again later."
      );
    }
    const windowMs = input.windowSeconds * 1_000;
    const currentTime = Date.now();
    const bucket = Math.floor(currentTime / windowMs);
    const identifiers = input.identifiers.length > 0 ? input.identifiers : ["client-unavailable"];
    const hash = await sha256(`${this.salt}\0${input.scope}\0${identifiers.join("\0")}`);
    const key = `rl:v1:${input.scope}:${hash}:${bucket}`;
    const retryAfter = Math.max(1, Math.ceil(((bucket + 1) * windowMs - currentTime) / 1_000));

    try {
      const stored = await this.kv.get(key);
      const count = stored && /^\d+$/.test(stored) ? Number(stored) : 0;
      if (count >= input.limit) return { allowed: false, retryAfter };
      await this.kv.put(key, String(count + 1), {
        expirationTtl: input.windowSeconds + 60
      });
      return { allowed: true, retryAfter };
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
