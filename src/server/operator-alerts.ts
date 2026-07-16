import {
  isValidTransactionalEmailAddress,
  isValidTransactionalHeaderValue,
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMailErrorCode,
  type TransactionalMailer,
  type TransactionalMessage,
} from "./transactional-mail";
import type {
  DataStore,
  OperatorAlertKind,
  OperatorAlertRecipientClaim,
  OperatorAlertRecipientCompletion,
} from "./types";

export type {
  OperatorAlertKind,
  OperatorAlertRecipientClaim,
  OperatorAlertRecipientCompletion,
} from "./types";

export type OperatorAlertStore = Pick<
  DataStore,
  | "claimOperatorAlertRecipients"
  | "completeOperatorAlertRecipient"
  | "reconcileOperatorAlertJob"
>;

export interface OperatorAlertMessage {
  subject: string;
  text: string;
  html: string;
}

interface ManagedOperatorAlertConfig {
  mailer?: TransactionalMailer | null;
  sender?: TransactionalMessage["from"] | null;
  replyTo?: string | null;
  canonicalOrigin?: string | null;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const absoluteOrigin = (raw: string) => {
  try {
    const url = new URL(raw);
    if (!new Set(["https:", "http:"]).has(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
};

export function renderOperatorAlert(
  kind: OperatorAlertKind,
  targetRecordId: string,
  canonicalOrigin: string,
): OperatorAlertMessage {
  const origin = absoluteOrigin(canonicalOrigin);
  if (!origin) throw new Error("A campaign base URL must be configured.");
  const isReport = kind === "operator_private_report";
  const label = isReport ? "private report" : "moderation item";
  const title = isReport ? "New private report awaiting review" : "New moderation item awaiting review";
  const reviewUrl = `${origin}/ops#${isReport ? "reports" : "moderation"}`;
  const text = [
    title,
    "",
    `A new ${label} has been added to the Tim Lost Something? Case Room.`,
    `Reference: ${targetRecordId}`,
    "",
    `Review it securely: ${reviewUrl}`,
    "",
    "Sign-in is required. Private submission details and evidence are intentionally not included in this email.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en-CA"><body style="margin:0;background:#f4efe3;color:#26221b;font-family:Arial,sans-serif">
<main style="max-width:640px;margin:0 auto;padding:32px;background:#fff">
  <h1>${escapeHtml(title)}</h1>
  <p>A new ${escapeHtml(label)} has been added to the Tim Lost Something? Case Room.</p>
  <p><strong>Reference:</strong> ${escapeHtml(targetRecordId)}</p>
  <p><a href="${escapeHtml(reviewUrl)}">Review it securely in the Case Room</a></p>
  <p>Sign-in is required. Private submission details and evidence are intentionally not included in this email.</p>
</main></body></html>`;
  return { subject: title, text, html };
}

const retryAt = (attempts: number) =>
  new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000).toISOString();

const completionForError = (
  error: unknown,
  attempts: number,
): Exclude<OperatorAlertRecipientCompletion, { status: "sent" }> => {
  const code = error instanceof TransactionalMailError ? error.code : "provider_unavailable";
  if (code === "provider_delivery_uncertain") return { status: "uncertain", errorCode: code };
  if (code === "provider_unavailable") {
    return { status: "retry", errorCode: code, nextAttemptAt: retryAt(attempts) };
  }
  return { status: "failed", errorCode: code };
};

export class ManagedOperatorAlerts {
  constructor(
    private readonly store: OperatorAlertStore,
    private readonly config: ManagedOperatorAlertConfig,
  ) {}

  async deliver(jobId: string): Promise<{ status: "sent" | "partial" | "failed"; sent: number; failed: number }> {
    const mailer = this.config.mailer ?? null;
    const senderName = this.config.sender?.name.trim() ?? "";
    const senderAddress = this.config.sender?.address.trim() ?? "";
    const replyTo = this.config.replyTo?.trim() ?? "";
    const origin = absoluteOrigin(this.config.canonicalOrigin?.trim() ?? "");
    if (
      !mailer ||
      !isValidTransactionalHeaderValue(senderName) ||
      !isValidTransactionalEmailAddress(senderAddress) ||
      !isValidTransactionalEmailAddress(replyTo) ||
      !origin
    ) {
      // Keep the durable recipients pending. A corrected deployment can send
      // them later; a configuration problem must not discard an alert.
      return { status: "failed", sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    while (true) {
      const recipients = await this.store.claimOperatorAlertRecipients(jobId);
      if (recipients.length === 0) break;

      for (const recipient of recipients) {
        const message = renderOperatorAlert(recipient.kind, recipient.targetRecordId, origin);
        let acceptance: TransactionalMailAcceptance;
        try {
          acceptance = await mailer.send({
            to: recipient.email,
            from: { name: senderName, address: senderAddress },
            replyTo,
            subject: message.subject,
            text: message.text,
            html: message.html,
            correlationId: recipient.correlationId,
          });
        } catch (error) {
          failed += 1;
          await this.store.completeOperatorAlertRecipient(
            recipient,
            completionForError(error, recipient.attempts),
          );
          continue;
        }

        // Provider acceptance and persistence are deliberately outside the same
        // catch. If the evidential write fails after acceptance, leave the lease
        // processing so expiry can mark it uncertain instead of blindly retrying.
        await this.store.completeOperatorAlertRecipient(recipient, { status: "sent", ...acceptance });
        sent += 1;
      }
    }

    await this.store.reconcileOperatorAlertJob(jobId);
    return {
      status: failed === 0 ? "sent" : sent > 0 ? "partial" : "failed",
      sent,
      failed,
    };
  }
}
