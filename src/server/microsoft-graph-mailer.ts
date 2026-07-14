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
const tenantSegment = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const providerReference = /^[\x20-\x7e]{1,128}$/;

interface TokenResponseRecord {
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

function validTenant(value: string | null): value is string {
  return (
    nonEmpty(value) &&
    value !== "." &&
    value !== ".." &&
    tenantSegment.test(value)
  );
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

export class MicrosoftGraphTransactionalMailer implements TransactionalMailer {
  constructor(private readonly config: MicrosoftGraphMailerConfig) {}

  async send(message: TransactionalMessage): Promise<TransactionalMailAcceptance> {
    let storedToken: Awaited<ReturnType<GraphRefreshTokenStore["load"]>>;
    try {
      storedToken = await this.config.tokenStore.load();
    } catch {
      throw unavailable();
    }

    const clientId = this.config.clientId;
    const tenantId = this.config.tenantId;
    const refreshToken = storedToken?.refreshToken ?? this.config.bootstrapRefreshToken;
    if (!nonEmpty(clientId) || !validTenant(tenantId) || !nonEmpty(refreshToken)) {
      throw unavailable();
    }

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
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form
        }
      );
    } catch {
      throw unavailable();
    }
    if (!tokenResponse.ok) throw unavailable();

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

    const mime = renderTransactionalMime(message);
    let sendResponse: Response;
    try {
      sendResponse = await this.config.fetch(graphSendUrl, {
        method: "POST",
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
