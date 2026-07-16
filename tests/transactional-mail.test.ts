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

function decodeBase64Text(base64: string): string {
  const bytes = Uint8Array.from(atob(base64.replaceAll("\r\n", "")), (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder().decode(bytes);
}

function assertPhysicalLineLimits(mime: string): void {
  for (const line of mime.split("\r\n")) {
    assert.ok(new TextEncoder().encode(line).byteLength <= 998, "MIME line exceeds 998 octets");
  }
}

function readHeader(mime: string, name: string): string {
  const headerLines = mime.slice(0, mime.indexOf("\r\n\r\n")).split("\r\n");
  const start = headerLines.findIndex((line) => line.startsWith(`${name}:`));
  assert.notEqual(start, -1, `${name} header is missing`);

  const values = [headerLines[start]!.slice(name.length + 1).trimStart()];
  for (let index = start + 1; index < headerLines.length; index += 1) {
    const line = headerLines[index]!;
    if (!/^[ \t]/.test(line)) break;
    values.push(line.trimStart());
  }
  return values.join(" ").trimStart();
}

function decodeEncodedWords(value: string): string {
  return value
    .replace(/(=\?UTF-8\?B\?[^?]+\?=)[ \t]+(?==\?UTF-8\?B\?)/gi, "$1")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_encodedWord, payload: string) =>
      decodeBase64Text(payload)
    );
}

interface DecodedPart {
  headers: string;
  text: string;
}

function multipartParts(mime: string): { boundary: string; parts: DecodedPart[] } {
  const boundary = mime.match(/boundary="([^"]+)"/)?.[1];
  assert.ok(boundary, "multipart boundary is missing");
  const marker = `--${boundary}`;
  const sections = mime.split(marker);
  assert.equal(sections.length, 4, "multipart must contain two delimiters and one closing delimiter");
  assert.equal(sections[3], "--\r\n");

  const parts = sections.slice(1, -1).map((section) => {
    assert.ok(section.startsWith("\r\n"));
    assert.ok(section.endsWith("\r\n"));
    const content = section.slice(2, -2);
    const separator = content.indexOf("\r\n\r\n");
    assert.notEqual(separator, -1);
    const headers = content.slice(0, separator);
    const payload = content.slice(separator + 4);
    assert.match(headers, /^Content-Transfer-Encoding: base64$/m);
    for (const line of payload.split("\r\n")) {
      assert.ok(line.length <= 76, "base64 body line exceeds 76 characters");
    }
    return { headers, text: decodeBase64Text(payload) };
  });

  return { boundary, parts };
}

function plainPart(mime: string): DecodedPart {
  const separator = mime.indexOf("\r\n\r\n");
  assert.notEqual(separator, -1);
  const headers = mime.slice(0, separator);
  const payloadWithTerminator = mime.slice(separator + 4);
  assert.ok(payloadWithTerminator.endsWith("\r\n"));
  const payload = payloadWithTerminator.slice(0, -2);
  assert.match(headers, /^Content-Type: text\/plain; charset=UTF-8$/m);
  assert.match(headers, /^Content-Transfer-Encoding: base64$/m);
  assert.doesNotMatch(headers, /multipart\/alternative/);
  assert.doesNotMatch(mime, /^--/m);
  for (const line of payload.split("\r\n")) {
    assert.ok(line.length <= 76, "base64 body line exceeds 76 characters");
  }
  return { headers, text: decodeBase64Text(payload) };
}

test("renders a correlated multipart message with Casey as Reply-To", () => {
  const decoded = decodeMime(renderTransactionalMime(baseMessage).base64);
  const { parts } = multipartParts(decoded);

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
  assert.equal(parts.length, 2);
  assert.match(parts[0]!.headers, /^Content-Type: text\/plain; charset=UTF-8$/m);
  assert.match(parts[1]!.headers, /^Content-Type: text\/html; charset=UTF-8$/m);
  assert.equal(parts[0]?.text, "Plain legal receipt");
  assert.equal(parts[1]?.text, "<p>HTML legal receipt</p>");
  assertPhysicalLineLimits(decoded);
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
  const { parts } = multipartParts(decoded);

  assert.equal(parts[0]?.text, unicodeText);
  assert.equal(parts[1]?.text, unicodeHtml);
});

test("renders a plain-only message with a single base64 part and canonical CRLF", () => {
  const decoded = decodeMime(
    renderTransactionalMime({
      ...baseMessage,
      text: "one\ntwo\rthree\r\nfour",
      html: null
    }).base64
  );
  const part = plainPart(decoded);

  assert.equal(part.text, "one\r\ntwo\r\nthree\r\nfour");
  assert.doesNotMatch(decoded.replaceAll("\r\n", ""), /[\r\n]/);
  assertPhysicalLineLimits(decoded);
});

test("folds long legal body lines and round-trips their exact UTF-8 content", () => {
  const longText = `Legal receipt: ${"é".repeat(700)}`;
  const decoded = decodeMime(
    renderTransactionalMime({ ...baseMessage, text: longText, html: null }).base64
  );
  const part = plainPart(decoded);

  assert.equal(part.text, longText);
  assertPhysicalLineLimits(decoded);
});

test("base64 parts prevent body text from becoming multipart delimiters", () => {
  const boundary = `=_tim_lost_${baseMessage.correlationId}`;
  const text = `Before\r\n--${boundary}\r\nAfter`;
  const html = `<p>Before</p>\r\n--${boundary}\r\n<p>After</p>`;
  const decoded = decodeMime(
    renderTransactionalMime({ ...baseMessage, text, html }).base64
  );
  const rendered = multipartParts(decoded);

  assert.equal(decoded.split(`--${boundary}`).length - 1, 3);
  assert.equal(rendered.parts[0]?.text, text);
  assert.equal(rendered.parts[1]?.text, html);
});

test("chunks and folds long Unicode subject and display-name encoded words", () => {
  const subject = "Waiver receipt — résumé 🧭 ".repeat(30).trimEnd();
  const fromName = "SébaHub field operations 🧭 ".repeat(20).trimEnd();
  const decoded = decodeMime(
    renderTransactionalMime({
      ...baseMessage,
      from: { ...baseMessage.from, name: fromName },
      subject
    }).base64
  );
  const encodedWords = decoded.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g) ?? [];

  assert.ok(encodedWords.length > 2);
  for (const encodedWord of encodedWords) assert.ok(encodedWord.length <= 75);
  assert.equal(decodeEncodedWords(readHeader(decoded, "Subject")), subject);
  assert.equal(
    decodeEncodedWords(readHeader(decoded, "From")),
    `${fromName} <tech@sebahub.com>`
  );
  assertPhysicalLineLimits(decoded);
});

test("encodes and folds a long unbroken ASCII subject without changing it", () => {
  const subject = "A".repeat(1_200);
  const decoded = decodeMime(
    renderTransactionalMime({ ...baseMessage, subject }).base64
  );
  const subjectHeader = readHeader(decoded, "Subject");
  const encodedWords = subjectHeader.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g) ?? [];

  assert.ok(encodedWords.length > 1);
  for (const encodedWord of encodedWords) assert.ok(encodedWord.length <= 75);
  assert.equal(decodeEncodedWords(subjectHeader), subject);
  assertPhysicalLineLimits(decoded);
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
