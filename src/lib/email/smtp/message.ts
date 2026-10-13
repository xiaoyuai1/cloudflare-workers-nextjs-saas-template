import { encodeBody, encodeHeader, formatFromHeader } from "./mime";
import type { SmtpEmailConfig } from "../types";

/**
 * Assembles the RFC 5322 message for the SMTP DATA phase. Everything user-visible passes
 * through `mime.ts`, which is what keeps Chinese subjects and bodies intact on QQ Mail.
 */
export function buildMimeMessage(config: SmtpEmailConfig, message: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}): string {
  const boundary = `=_saas_${crypto.randomUUID().replaceAll("-", "")}`;
  const headerLines = [
    `From: ${formatFromHeader(config.from)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    ...(config.replyTo ? [`Reply-To: ${config.replyTo}`] : []),
    ...Object.entries(message.headers ?? {}).map(([name, value]) => `${name}: ${encodeHeader(value)}`),
    `MIME-Version: 1.0`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${config.from.email.split("@")[1] ?? "localhost"}>`,
  ];

  const textPart = message.text
    ? `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodeBody(message.text)}\r\n`
    : "";
  const htmlPart = message.html
    ? `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodeBody(message.html)}\r\n`
    : "";

  if (!textPart && !htmlPart) {
    throw new Error("SMTP message needs at least one of text or html.");
  }

  const body = [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `This is a multi-part message in MIME format.`,
    textPart,
    htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return [...headerLines, body].join("\r\n");
}

/** RFC 5321 dot-stuffing: a leading dot on a line would otherwise terminate the DATA payload. */
export function dotStuff(payload: string): string {
  return payload.replaceAll(/\r\n\./g, "\r\n..");
}
