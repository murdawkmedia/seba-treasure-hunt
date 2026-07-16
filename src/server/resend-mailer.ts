import {
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMailer,
  type TransactionalMessage
} from "./transactional-mail";

export interface ResendMailerConfig {
  fetch: typeof globalThis.fetch;
  apiKey: string | null;
  now?: () => Date;
}

const resendEndpoint = "https://api.resend.com/emails";
const safeProviderReference = /^[\x20-\x7e]{1,128}$/;

function mailError(code: TransactionalMailError["code"]): TransactionalMailError {
  return new TransactionalMailError(code);
}

async function cancelUnusedBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Body cleanup must not replace the fixed provider outcome.
  }
}

function responseId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string") return null;
  const normalized = id.trim();
  return safeProviderReference.test(normalized) ? normalized : null;
}

export class ResendTransactionalMailer implements TransactionalMailer {
  constructor(private readonly config: ResendMailerConfig) {}

  async send(message: TransactionalMessage): Promise<TransactionalMailAcceptance> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw mailError("provider_unavailable");

    const payload: Record<string, unknown> = {
      from: `${message.from.name} <${message.from.address}>`,
      to: [message.to],
      reply_to: message.replyTo,
      subject: message.subject,
      text: message.text
    };
    if (message.html !== null) payload.html = message.html;

    let response: Response;
    try {
      response = await this.config.fetch(resendEndpoint, {
        method: "POST",
        redirect: "manual",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch {
      throw mailError("provider_delivery_uncertain");
    }

    if (!response.ok) {
      await cancelUnusedBody(response);
      throw mailError("provider_rejected");
    }

    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch {
      throw mailError("provider_response_invalid");
    }
    const providerReference = responseId(decoded);
    if (!providerReference) throw mailError("provider_response_invalid");

    return {
      provider: "resend",
      providerReference,
      providerReferenceKind: "resend_message_id",
      acceptedAt: (this.config.now ?? (() => new Date()))().toISOString()
    };
  }
}
