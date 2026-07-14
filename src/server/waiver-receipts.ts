import { generatedParticipationWaiver } from "../generated/participation-waiver";
import type {
  DataStore,
  LegalReceiptSender,
  WaiverReceiptEnvelope,
  WaiverReceiptErrorCode,
  WaiverReceiptJob,
} from "./types";

export interface WaiverReceiptMessage {
  subject: string;
  text: string;
  html: string;
}

export interface ManagedWaiverReceiptConfig {
  fetch: typeof globalThis.fetch;
  apiKey: string | null;
  from: string | null;
  replyTo: string | null;
  canonicalOrigin: string;
}

const escapeHtml = (input: string) =>
  input.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const absoluteOrigin = (origin: string) => origin.replace(/\/+$/, "");

const participantText = (envelope: WaiverReceiptEnvelope) =>
  envelope.acceptance.participants.map((participant) =>
    participant.role === "minor"
      ? `${participant.fullName} (birth year ${participant.birthYear})`
      : `${participant.fullName} (adult registrant)`,
  );

const legalText = () =>
  generatedParticipationWaiver.sections.flatMap((section) => [
    `${section.number}. ${section.title}`,
    ...section.blocks.flatMap((block) =>
      block.kind === "paragraph"
        ? [block.text]
        : block.items.map((item) => `- ${item}`),
    ),
    "",
  ]);

const legalHtml = () =>
  generatedParticipationWaiver.sections
    .map((section) => {
      const blocks = section.blocks
        .map((block) =>
          block.kind === "paragraph"
            ? `<p>${escapeHtml(block.text)}</p>`
            : `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
        )
        .join("");
      return `<section><h2>${section.number}. ${escapeHtml(section.title)}</h2>${blocks}</section>`;
    })
    .join("");

export const renderWaiverReceipt = (
  envelope: WaiverReceiptEnvelope,
  canonicalOrigin = "https://www.timlostsomething.com",
): WaiverReceiptMessage => {
  const { acceptance, verifiedEmail } = envelope;
  const origin = absoluteOrigin(canonicalOrigin);
  const waiverUrl = `${origin}/waiver`;
  const rulesUrl = `${origin}/rules`;
  const participants = participantText(envelope);
  const hasMinors = acceptance.participants.some((participant) => participant.role === "minor");
  const statements = [
    generatedParticipationWaiver.acceptanceStatement,
    ...(hasMinors ? [generatedParticipationWaiver.guardianStatement] : []),
  ];
  const acceptedLabel = new Date(acceptance.acceptedAt).toLocaleString("en-CA", {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: "America/Edmonton",
  });

  const text = [
    generatedParticipationWaiver.title,
    "",
    `Reference: ${acceptance.referenceCode}`,
    `Version ${acceptance.documentVersion}`,
    `Effective ${generatedParticipationWaiver.effectiveDateLabel}`,
    `Accepted ${acceptedLabel}`,
    `Verified email: ${verifiedEmail}`,
    "",
    "Covered participants",
    ...participants.map((participant) => `- ${participant}`),
    "",
    "Acceptance statements",
    ...statements,
    "",
    generatedParticipationWaiver.intro,
    "",
    ...legalText(),
    "Keep this receipt as your registration confirmation. You may be asked to show it when receiving a clue coin.",
    `Read the current participation waiver: ${waiverUrl}`,
    `Read the current hunt rules: ${rulesUrl}`,
  ].join("\n");

  const participantItems = acceptance.participants
    .map((participant) => {
      const label =
        participant.role === "minor"
          ? `${participant.fullName} (birth year ${participant.birthYear})`
          : `${participant.fullName} (adult registrant)`;
      return `<li>${escapeHtml(label)}</li>`;
    })
    .join("");
  const statementHtml = statements.map((statement) => `<p>${escapeHtml(statement)}</p>`).join("");
  const html = `<!doctype html>
<html lang="en-CA">
<body style="margin:0;background:#f4efe3;color:#26221b;font-family:Arial,sans-serif">
  <main style="max-width:720px;margin:0 auto;padding:32px;background:#fff">
    <h1>${escapeHtml(generatedParticipationWaiver.title)}</h1>
    <dl>
      <dt><strong>Reference</strong></dt><dd>${escapeHtml(acceptance.referenceCode)}</dd>
      <dt><strong>Version</strong></dt><dd>${escapeHtml(acceptance.documentVersion)}</dd>
      <dt><strong>Effective</strong></dt><dd>${escapeHtml(generatedParticipationWaiver.effectiveDateLabel)}</dd>
      <dt><strong>Accepted</strong></dt><dd>${escapeHtml(acceptedLabel)}</dd>
      <dt><strong>Verified email</strong></dt><dd>${escapeHtml(verifiedEmail)}</dd>
    </dl>
    <h2>Covered participants</h2>
    <ul>${participantItems}</ul>
    <h2>Acceptance statements</h2>
    ${statementHtml}
    <p>${escapeHtml(generatedParticipationWaiver.intro)}</p>
    ${legalHtml()}
    <hr>
    <p><strong>Keep this receipt as your registration confirmation.</strong> You may be asked to show it when receiving a clue coin.</p>
    <p><a href="${escapeHtml(waiverUrl)}">Read the current participation waiver</a><br>
       <a href="${escapeHtml(rulesUrl)}">Read the current hunt rules</a></p>
  </main>
</body>
</html>`;

  return {
    subject: `Your Tim Lost Something? waiver receipt — ${acceptance.referenceCode}`,
    text,
    html,
  };
};

export class ManagedWaiverReceipts implements LegalReceiptSender {
  constructor(
    private readonly store: DataStore,
    private readonly config: ManagedWaiverReceiptConfig,
  ) {}

  private async fail(job: WaiverReceiptJob, errorCode: WaiverReceiptErrorCode) {
    await this.store.completeWaiverReceiptJob(job, { status: "failed", errorCode });
    return { status: "failed" as const };
  }

  async deliver(acceptanceId: string): Promise<{ status: "sent" | "failed" }> {
    const job = await this.store.claimWaiverReceiptJob(acceptanceId);
    if (!job) return { status: "sent" };

    const envelope = await this.store.getWaiverReceiptEnvelope(acceptanceId);
    if (!envelope) return this.fail(job, "provider_unavailable");
    if (
      envelope.acceptance.documentVersion !== generatedParticipationWaiver.version ||
      envelope.acceptance.documentHash !== generatedParticipationWaiver.hash
    ) {
      return this.fail(job, "document_mismatch");
    }

    const apiKey = this.config.apiKey?.trim() ?? "";
    const from = this.config.from?.trim() ?? "";
    const replyTo = this.config.replyTo?.trim() ?? "";
    if (!apiKey || !from || !replyTo || !this.config.canonicalOrigin.trim()) {
      return this.fail(job, "provider_unavailable");
    }

    const message = renderWaiverReceipt(envelope, this.config.canonicalOrigin);
    let response: Response;
    try {
      response = await this.config.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [envelope.verifiedEmail],
          reply_to: replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
    } catch {
      return this.fail(job, "provider_unavailable");
    }
    if (!response.ok) return this.fail(job, "provider_rejected");

    let providerMessageId: string | null = null;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      providerMessageId =
        typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : null;
    } catch {
      providerMessageId = null;
    }
    if (!providerMessageId) return this.fail(job, "provider_response_invalid");

    await this.store.completeWaiverReceiptJob(job, {
      status: "sent",
      providerMessageId,
    });
    return { status: "sent" };
  }
}
