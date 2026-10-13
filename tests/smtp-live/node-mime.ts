// MIME builder for the live SMTP smoke test only — runs under plain Node, not the Worker
// runtime, so no `import "server-only"`. Mirrors `src/lib/email/smtp/message.ts`.

import type { SmtpEmailConfig } from "../../src/lib/email/types.ts";

const BOUNDARY_PREFIX = "----saas-test-";

export function buildNodeMimeMessage(config: SmtpEmailConfig, message: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  replyTo?: string;
}): string {
  const boundary = `${BOUNDARY_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
  const encodedSubject = encodeRfc2047(message.subject);
  const headers = [
    `From: ${config.from.name ? `${encodeRfc2047(config.from.name)} <${config.from.email}>` : config.from.email}`,
    `To: ${message.to}`,
    `Subject: ${encodedSubject}`,
    ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
    ...Object.entries(message.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
    "MIME-Version: 1.0",
    `Date: ${new Date().toUTCString()}`,
  ];

  const parts = [
    message.text
      ? `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${foldBase64(btoa64(message.text))}\r\n`
      : "",
    message.html
      ? `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${foldBase64(btoa64(message.html))}\r\n`
      : "",
  ].join("");

  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
    parts,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function btoa64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function foldBase64(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** RFC 2047 B-encoding. The smoke test only sends ASCII or CJK subjects, so chunking is simple. */
function encodeRfc2047(text: string): string {
  if (!/[^\x20-\x7e]/.test(text)) {
    return text;
  }

  const base64 = btoa64(text);
  const chunks: string[] = [];
  // Split on byte-safe boundaries: re-encode each half from its own UTF-8 bytes.
  const bytes = Buffer.from(text, "utf8");
  const half = Math.ceil(bytes.length / 2);

  if (base64.length + "=?UTF-8?B??=".length <= 76) {
    chunks.push(base64);
  } else {
    chunks.push(
      bytes.subarray(0, half).toString("base64"),
      bytes.subarray(half).toString("base64"),
    );
  }

  return chunks
    .map((chunk) => `=?UTF-8?B?${chunk}?=`)
    .join("\r\n ");
}
