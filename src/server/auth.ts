import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { IdentityVerifier, Principal } from "./types";

interface ProviderConfig {
  issuer: string | null;
  jwksUrl: string | null;
  authorizedParty: string | null;
}

export function isAllowedAuthorizedParty(candidate: unknown, configured: string | null): boolean {
  if (typeof candidate !== "string" || !configured) return false;
  let presented: URL;
  try {
    presented = new URL(candidate);
  } catch {
    return false;
  }
  if (presented.protocol !== "https:" || presented.username || presented.password || presented.pathname !== "/" || presented.search || presented.hash) {
    return false;
  }
  return configured.split(",").some((entry) => {
    let allowed: URL;
    try {
      allowed = new URL(entry.trim());
    } catch {
      return false;
    }
    return (
      allowed.protocol === "https:" &&
      allowed.port === presented.port &&
      (presented.hostname === allowed.hostname || presented.hostname.endsWith(`.${allowed.hostname}`))
    );
  });
}

const bearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token.length > 0 ? token : null;
};

const claimEmail = (payload: JWTPayload): string | null => {
  const candidate = payload.email ?? payload.primary_email_address;
  return typeof candidate === "string" && candidate.includes("@")
    ? candidate.trim().toLowerCase()
    : null;
};

class JwtProvider {
  private readonly jwks;

  constructor(private readonly config: ProviderConfig) {
    const url = config.jwksUrl ?? (config.issuer ? `${config.issuer.replace(/\/$/, "")}/.well-known/jwks.json` : null);
    this.jwks = url ? createRemoteJWKSet(new URL(url)) : null;
  }

  async verify(request: Request, kind: Principal["kind"]): Promise<Principal | null> {
    const token = bearerToken(request);
    if (!token || !this.config.issuer || !this.config.authorizedParty || !this.jwks) return null;

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        clockTolerance: 5
      });
      if (!isAllowedAuthorizedParty(payload.azp, this.config.authorizedParty) || typeof payload.sub !== "string") return null;
      const email = claimEmail(payload);
      if (kind === "staff" && !email) return null;
      return { kind, subject: payload.sub, email };
    } catch {
      return null;
    }
  }
}

export class ManagedIdentityVerifier implements IdentityVerifier {
  private readonly hunter: JwtProvider;
  private readonly staff: JwtProvider;
  private readonly issuersAreSeparated: boolean;

  constructor(options: {
    hunterIssuer: string | null;
    hunterJwksUrl: string | null;
    staffIssuer: string | null;
    staffJwksUrl: string | null;
    authorizedParty: string | null;
  }) {
    this.hunter = new JwtProvider({
      issuer: options.hunterIssuer,
      jwksUrl: options.hunterJwksUrl,
      authorizedParty: options.authorizedParty
    });
    this.staff = new JwtProvider({
      issuer: options.staffIssuer,
      jwksUrl: options.staffJwksUrl,
      authorizedParty: options.authorizedParty
    });
    this.issuersAreSeparated = Boolean(
      options.hunterIssuer &&
      options.staffIssuer &&
      options.hunterIssuer.replace(/\/$/, "") !== options.staffIssuer.replace(/\/$/, "")
    );
  }

  authenticateHunter(request: Request) {
    return this.hunter.verify(request, "hunter");
  }

  authenticateStaff(request: Request) {
    if (!this.issuersAreSeparated) return Promise.resolve(null);
    return this.staff.verify(request, "staff");
  }
}
