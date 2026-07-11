import type { HumanVerifier } from "./types";

interface TurnstileResult {
  success?: boolean;
  action?: string;
  hostname?: string;
}

export class TurnstileVerifier implements HumanVerifier {
  private readonly allowedHosts: string[];

  constructor(
    private readonly secret: string | null,
    allowedHosts: string[]
  ) {
    this.allowedHosts = allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  }

  async verify(token: string | null, action: string, _request: Request): Promise<boolean> {
    if (!this.secret || !token || token.length > 2048) return false;
    const body = new FormData();
    body.set("secret", this.secret);
    body.set("response", token);

    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) return false;
      const result = (await response.json()) as TurnstileResult;
      return Boolean(
        result.success &&
        result.action === action &&
        result.hostname &&
        isAllowedTurnstileHost(result.hostname, this.allowedHosts)
      );
    } catch {
      return false;
    }
  }
}

export function isAllowedTurnstileHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const candidate = hostname.trim().toLowerCase();
  return allowedHosts.some((rawHost) => {
    const allowed = rawHost.trim().toLowerCase();
    return Boolean(allowed) && (candidate === allowed || candidate.endsWith(`.${allowed}`));
  });
}
