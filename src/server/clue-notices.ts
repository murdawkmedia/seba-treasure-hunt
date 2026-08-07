import {
  isValidTransactionalEmailAddress,
  isValidTransactionalHeaderValue,
  TransactionalMailError,
  type TransactionalMailAcceptance,
  type TransactionalMailer,
  type TransactionalMessage,
} from "./transactional-mail";
import type {
  ClueNoticeKind,
  ClueNoticeRecipientClaim,
  ClueNoticeRecipientCompletion,
  DataStore,
} from "./types";

export type ClueNoticeStore = Pick<
  DataStore,
  "claimClueNoticeRecipients" | "completeClueNoticeRecipient" | "failClueNoticeConfiguration" | "reconcileClueNoticeJob"
>;

export interface ClueNoticeMessage {
  subject: string;
  text: string;
  html: string;
}

interface ManagedClueNoticeConfig {
  mailer?: TransactionalMailer | null;
  sender?: TransactionalMessage["from"] | null;
  replyTo?: string | null;
  canonicalOrigin?: string | null;
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const absoluteOrigin = (raw: string) => {
  try {
    const url = new URL(raw);
    return new Set(["https:", "http:"]).has(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
};

export const renderClueNotice = (kind: ClueNoticeKind, canonicalOrigin: string): ClueNoticeMessage => {
  const origin = absoluteOrigin(canonicalOrigin);
  if (!origin) throw new Error("A campaign base URL must be configured.");
  const isApproval = kind === "clue_order_approved";
  const title = isApproval ? "Your decoder access is ready" : "A new clue is ready";
  const detail = isApproval
    ? "Your payment was confirmed. Your decoder access is now available in My Hunt."
    : "A new Tim Lost Something? clue is available in My Hunt.";
  const huntUrl = `${origin}/dashboard.html`;
  const text = [title, "", detail, "", `Open My Hunt: ${huntUrl}`].join("\n");
  const html = `<!doctype html><html lang="en-CA"><body style="margin:0;background:#f4efe3;color:#26221b;font-family:Arial,sans-serif">
<main style="max-width:640px;margin:0 auto;padding:32px;background:#fff"><h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(detail)}</p><p><a href="${escapeHtml(huntUrl)}">Open My Hunt</a></p></main></body></html>`;
  return { subject: title, text, html };
};

const retryAt = (attempts: number) =>
  new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000).toISOString();

const completionForError = (error: unknown, attempts: number): Exclude<ClueNoticeRecipientCompletion, { status: "sent" }> => {
  const errorCode = error instanceof TransactionalMailError ? error.code : "provider_unavailable";
  if (errorCode === "provider_delivery_uncertain") return { status: "uncertain", errorCode };
  if (errorCode === "provider_unavailable") return { status: "retry", errorCode, nextAttemptAt: retryAt(attempts) };
  return { status: "failed", errorCode };
};

export class ManagedClueNotices {
  constructor(private readonly store: ClueNoticeStore, private readonly config: ManagedClueNoticeConfig) {}

  async deliver(jobId: string): Promise<{ status: "sent" | "partial" | "failed"; sent: number; failed: number }> {
    const mailer = this.config.mailer ?? null;
    const senderName = this.config.sender?.name.trim() ?? "";
    const senderAddress = this.config.sender?.address.trim() ?? "";
    const replyTo = this.config.replyTo?.trim() ?? "";
    const origin = absoluteOrigin(this.config.canonicalOrigin?.trim() ?? "");
    if (!mailer || !isValidTransactionalHeaderValue(senderName) || !isValidTransactionalEmailAddress(senderAddress)
      || !isValidTransactionalEmailAddress(replyTo) || !origin) {
      await this.store.failClueNoticeConfiguration(jobId);
      await this.store.reconcileClueNoticeJob(jobId);
      return { status: "failed", sent: 0, failed: 0 };
    }
    let sent = 0;
    let failed = 0;
    while (true) {
      const recipients = await this.store.claimClueNoticeRecipients(jobId);
      if (!recipients.length) break;
      for (const recipient of recipients) {
        const message = renderClueNotice(recipient.kind, origin);
        let acceptance: TransactionalMailAcceptance;
        try {
          acceptance = await mailer.send({
            to: recipient.email, from: { name: senderName, address: senderAddress }, replyTo,
            subject: message.subject, text: message.text, html: message.html, correlationId: recipient.correlationId,
          });
        } catch (error) {
          failed += 1;
          await this.store.completeClueNoticeRecipient(recipient, completionForError(error, recipient.attempts));
          continue;
        }
        // If persistence fails after provider acceptance, leave the lease in
        // processing so it becomes uncertain rather than risking a duplicate.
        await this.store.completeClueNoticeRecipient(recipient, { status: "sent", ...acceptance });
        sent += 1;
      }
    }
    await this.store.reconcileClueNoticeJob(jobId);
    return { status: failed === 0 ? "sent" : sent > 0 ? "partial" : "failed", sent, failed };
  }
}
