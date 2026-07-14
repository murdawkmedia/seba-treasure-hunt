import type { GraphRefreshTokenStore } from "./graph-token-store";
import {
  renderTransactionalMime,
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMailer,
  type TransactionalMessage
} from "./transactional-mail";

export interface MicrosoftGraphMailerConfig {
  fetch: typeof globalThis.fetch;
  clientId: string | null;
  tenantId: string | null;
  bootstrapRefreshToken: string | null;
  tokenStore: GraphRefreshTokenStore;
  now?: () => Date;
}

const graphScope = "offline_access https://graph.microsoft.com/Mail.Send";
const graphSendUrl = "https://graph.microsoft.com/v1.0/me/sendMail";
const canonicalGuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providerReference = /^[\x20-\x7e]{1,128}$/;

interface TokenResponseRecord {
  token_type?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  error?: unknown;
}

function unavailable(): TransactionalMailError {
  return new TransactionalMailError("provider_unavailable");
}

function nonEmpty(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedGuid(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return canonicalGuid.test(normalized) ? normalized : null;
}

function tokenRecord(value: unknown): TokenResponseRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as TokenResponseRecord;
}

function safeProviderReference(response: Response): string | null {
  try {
    const value = response.headers.get("request-id")?.trim();
    return value && providerReference.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function cancelUnusedBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body cleanup failure must not expose or replace the safe provider outcome.
  }
}

export class MicrosoftGraphTransactionalMailer implements TransactionalMailer {
  constructor(private readonly config: MicrosoftGraphMailerConfig) {}

  async send(message: TransactionalMessage): Promise<TransactionalMailAcceptance> {
    let mime: ReturnType<typeof renderTransactionalMime>;
    try {
      mime = renderTransactionalMime(message);
    } catch {
      throw new TransactionalMailError("provider_response_invalid");
    }

    const clientId = normalizedGuid(this.config.clientId);
    const tenantId = normalizedGuid(this.config.tenantId);
    if (!clientId || !tenantId) throw unavailable();

    let storedToken: Awaited<ReturnType<GraphRefreshTokenStore["load"]>>;
    try {
      storedToken = await this.config.tokenStore.load();
    } catch {
      throw unavailable();
    }

    const refreshToken = storedToken?.refreshToken ?? this.config.bootstrapRefreshToken;
    if (!nonEmpty(refreshToken)) throw unavailable();

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      scope: graphScope,
      refresh_token: refreshToken
    });

    let tokenResponse: Response;
    try {
      tokenResponse = await this.config.fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form
        }
      );
    } catch {
      throw unavailable();
    }
    if (!tokenResponse.ok) {
      await cancelUnusedBody(tokenResponse);
      throw unavailable();
    }

    let decoded: unknown;
    try {
      decoded = await tokenResponse.json();
    } catch {
      throw unavailable();
    }
    const token = tokenRecord(decoded);
    if (
      !token ||
      Object.prototype.hasOwnProperty.call(token, "error") ||
      typeof token.token_type !== "string" ||
      token.token_type.trim().toLowerCase() !== "bearer" ||
      typeof token.access_token !== "string" ||
      !nonEmpty(token.access_token)
    ) {
      throw unavailable();
    }
    const accessToken = token.access_token.trim();

    if (typeof token.refresh_token === "string" && nonEmpty(token.refresh_token)) {
      try {
        await this.config.tokenStore.save(
          storedToken?.stateVersion ?? null,
          token.refresh_token
        );
      } catch {
        throw unavailable();
      }
    }

    let sendResponse: Response;
    try {
      sendResponse = await this.config.fetch(graphSendUrl, {
        method: "POST",
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          "client-request-id": message.correlationId,
          "return-client-request-id": "true"
        },
        body: mime.base64
      });
    } catch {
      throw new TransactionalMailError("provider_delivery_uncertain");
    }

    await cancelUnusedBody(sendResponse);
    if (sendResponse.status !== 202) {
      throw new TransactionalMailError("provider_rejected");
    }

    const graphReference = safeProviderReference(sendResponse);
    return {
      provider: "microsoft_graph",
      providerReference: graphReference ?? message.correlationId,
      providerReferenceKind: graphReference ? "graph_request_id" : "client_request_id",
      acceptedAt: (this.config.now ?? (() => new Date()))().toISOString()
    };
  }
}
