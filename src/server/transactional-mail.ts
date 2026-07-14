export interface TransactionalMessage {
  to: string;
  from: { name: string; address: string };
  replyTo: string;
  subject: string;
  text: string;
  html: string | null;
  correlationId: string;
  sentAt?: Date;
}

export type ProviderReferenceKind =
  | "graph_request_id"
  | "client_request_id"
  | "resend_message_id";

export interface TransactionalMailAcceptance {
  provider: "microsoft_graph" | "resend";
  providerReference: string;
  providerReferenceKind: ProviderReferenceKind;
  acceptedAt: string;
}

export type TransactionalMailErrorCode =
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_response_invalid"
  | "provider_delivery_uncertain";

export class TransactionalMailError extends Error {
  constructor(readonly code: TransactionalMailErrorCode) {
    super(code);
  }
}

export interface TransactionalMailer {
  send(message: TransactionalMessage): Promise<TransactionalMailAcceptance>;
}

const headerControl = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const emailAddress =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const correlationReference = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;

function validatedHeader(label: string, value: string): string {
  if (!value || headerControl.test(value)) {
    throw new Error(`Invalid ${label} header value.`);
  }
  return value;
}

function validatedEmailHeader(label: string, value: string): string {
  const validated = validatedHeader(label, value);
  if (!emailAddress.test(validated)) {
    throw new Error(`Invalid ${label} email header value.`);
  }
  return validated;
}

function toUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodedHeaderText(value: string): string {
  return /^[\x20-\x7e]+$/.test(value) ? value : `=?UTF-8?B?${toUtf8Base64(value)}?=`;
}

function formattedDisplayName(value: string): string {
  if (!/^[\x20-\x7e]+$/.test(value)) return encodedHeaderText(value);
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function canonicalBody(value: string): string {
  return value.replace(/\r\n|\r|\n/g, "\r\n");
}

export function renderTransactionalMime(message: TransactionalMessage): { base64: string } {
  const to = validatedEmailHeader("To", message.to);
  const fromName = validatedHeader("From name", message.from.name);
  const fromAddress = validatedEmailHeader("From", message.from.address);
  const replyTo = validatedEmailHeader("Reply-To", message.replyTo);
  const subject = validatedHeader("Subject", message.subject);
  const correlationId = validatedHeader("correlation", message.correlationId);
  if (!correlationReference.test(correlationId)) {
    throw new Error("Invalid correlation header value.");
  }

  const sentAt = message.sentAt ?? new Date();
  if (Number.isNaN(sentAt.getTime())) throw new Error("Invalid message date.");

  const boundary = `=_tim_lost_${correlationId}`;
  const headers = [
    `From: ${formattedDisplayName(fromName)} <${fromAddress}>`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${encodedHeaderText(subject)}`,
    `Date: ${sentAt.toUTCString()}`,
    "MIME-Version: 1.0",
    `Message-ID: <${correlationId}@mail.sebahub.com>`,
    `X-Tim-Lost-Delivery-Reference: ${correlationId}`
  ];

  let mime: string;
  if (message.html !== null) {
    mime = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      canonicalBody(message.text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      canonicalBody(message.html),
      `--${boundary}--`,
      ""
    ].join("\r\n");
  } else {
    mime = [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      canonicalBody(message.text),
      ""
    ].join("\r\n");
  }

  return { base64: toUtf8Base64(mime) };
}
