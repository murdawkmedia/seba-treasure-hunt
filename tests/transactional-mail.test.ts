import assert from "node:assert/strict";
import test from "node:test";
import { renderTransactionalMime } from "../src/server/transactional-mail";

const baseMessage = {
  to: "hunter@example.test",
  from: {
    name: "Tim Lost Something? by SebaHub",
    address: "tech@sebahub.com"
  },
  replyTo: "casey@sebahub.com",
  subject: "Your waiver receipt — TLS-W-1234",
  text: "Plain legal receipt",
  html: "<p>HTML legal receipt</p>",
  correlationId: "8eecbe25-8db6-4c5c-91f8-f1095e608f95",
  sentAt: new Date("2026-07-14T18:00:00.000Z")
};

function decodeMime(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

test("renders a correlated multipart message with Casey as Reply-To", () => {
  const decoded = decodeMime(renderTransactionalMime(baseMessage).base64);

  assert.match(decoded, /^From: .+ <tech@sebahub\.com>\r\n/);
  assert.match(decoded, /^To: hunter@example\.test\r\n/m);
  assert.match(decoded, /^Reply-To: casey@sebahub\.com\r\n/m);
  assert.match(
    decoded,
    /^X-Tim-Lost-Delivery-Reference: 8eecbe25-8db6-4c5c-91f8-f1095e608f95\r\n/m
  );
  assert.match(decoded, /^Date: Tue, 14 Jul 2026 18:00:00 GMT\r\n/m);
  assert.match(decoded, /^MIME-Version: 1\.0\r\n/m);
  assert.match(decoded, /^Message-ID: <[^>]+@mail\.sebahub\.com>\r\n/m);
  assert.match(decoded, /Content-Type: multipart\/alternative; boundary="([A-Za-z0-9_=-]+)"/);
  assert.match(decoded, /Content-Type: text\/plain; charset=UTF-8\r\n/);
  assert.match(decoded, /Content-Type: text\/html; charset=UTF-8\r\n/);
  assert.match(decoded, /Plain legal receipt/);
  assert.match(decoded, /<p>HTML legal receipt<\/p>/);
});

test("uses deterministic MIME identifiers and strict CRLF line endings", () => {
  const first = decodeMime(renderTransactionalMime(baseMessage).base64);
  const second = decodeMime(renderTransactionalMime(baseMessage).base64);
  const firstBoundary = first.match(/boundary="([^"]+)"/)?.[1];
  const secondBoundary = second.match(/boundary="([^"]+)"/)?.[1];
  const firstMessageId = first.match(/^Message-ID: (.+)\r$/m)?.[1];
  const secondMessageId = second.match(/^Message-ID: (.+)\r$/m)?.[1];

  assert.ok(firstBoundary);
  assert.equal(firstBoundary, secondBoundary);
  assert.equal(firstMessageId, secondMessageId);
  assert.doesNotMatch(first.replaceAll("\r\n", ""), /[\r\n]/);
});

test("round-trips Unicode through the rendered base64 MIME document", () => {
  const unicodeText = "Résumé received — café ☕ 🧭";
  const unicodeHtml = "<p>Résumé received — café ☕ 🧭</p>";
  const decoded = decodeMime(
    renderTransactionalMime({
      ...baseMessage,
      text: unicodeText,
      html: unicodeHtml
    }).base64
  );

  assert.match(decoded, new RegExp(unicodeText));
  assert.match(decoded, new RegExp(unicodeHtml));
});

test("canonicalizes body newlines to CRLF", () => {
  const decoded = decodeMime(
    renderTransactionalMime({
      ...baseMessage,
      text: "one\ntwo\rthree\r\nfour",
      html: null
    }).base64
  );

  assert.match(decoded, /one\r\ntwo\r\nthree\r\nfour/);
  assert.doesNotMatch(decoded.replaceAll("\r\n", ""), /[\r\n]/);
});

test("rejects header control characters before rendering", () => {
  const unsafeMessages = [
    { ...baseMessage, to: "hunter@example.test\r\nBcc: attacker@example.test" },
    { ...baseMessage, from: { ...baseMessage.from, name: "SebaHub\nBcc: attacker" } },
    {
      ...baseMessage,
      from: { ...baseMessage.from, address: "tech@sebahub.com\u0000" }
    },
    { ...baseMessage, replyTo: "casey@sebahub.com\u007f" },
    { ...baseMessage, subject: "Receipt\r\nBcc: attacker@example.test" },
    { ...baseMessage, correlationId: "delivery\u0001reference" }
  ];

  for (const message of unsafeMessages) {
    assert.throws(() => renderTransactionalMime(message), /header/i);
  }
});

test("rejects malformed campaign email addresses", () => {
  for (const message of [
    { ...baseMessage, to: "not-an-address" },
    { ...baseMessage, from: { ...baseMessage.from, address: "tech@" } },
    { ...baseMessage, replyTo: "casey @sebahub.com" }
  ]) {
    assert.throws(() => renderTransactionalMime(message), /email header/i);
  }
});
