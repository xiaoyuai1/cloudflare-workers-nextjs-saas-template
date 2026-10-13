import { connect } from "cloudflare:sockets";

import type { SmtpEmailConfig } from "../types";
import { buildMimeMessage, dotStuff } from "./message";

const SMTP_IMPLICIT_TLS_PORT = 465;
const CONNECT_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 15_000;
const CRLF = "\r\n";

/**
 * Minimal SMTP client for Workers: one message per connection over implicit TLS (port 465).
 * Deliberately no STARTTLS — the workerd `startTls()` path is unreliable for SMTP (workerd
 * #2712) — and no connection pool: the queue consumer sends at transactional volume, where
 * one TLS handshake per message is cheap and correctness is not.
 *
 * Throws on any non-2xx/3xx reply with the server's status code and text, which the queue
 * consumer's retries (max_retries: 5) then treat as a failed job.
 */
export async function sendViaSmtp(config: SmtpEmailConfig, message: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const socket = connect(
    { hostname: config.host, port: config.port || SMTP_IMPLICIT_TLS_PORT },
    { secureTransport: "on", allowHalfOpen: false },
  );

  try {
    await withTimeout(socket.opened, CONNECT_TIMEOUT_MS, `SMTP connect to ${config.host} timed out.`);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    await readReply(reader); // 220 greeting
    await writeCommand(writer, reader, `EHLO ${config.from.email.split("@")[1] ?? "localhost"}`);
    await writeCommand(writer, reader, `AUTH LOGIN`);
    await writeCommand(writer, reader, btoa(config.user));
    await writeCommand(writer, reader, btoa(config.pass));
    await writeCommand(writer, reader, `MAIL FROM:<${config.from.email}>`);
    await writeCommand(writer, reader, `RCPT TO:<${message.to}>`);

    const dataReply = await writeCommand(writer, reader, `DATA`);
    if (!dataReply.startsWith("354")) {
      throw new SmtpError(500, `DATA refused: ${dataReply}`);
    }

    const payload = `${buildMimeMessage(config, message).replaceAll(/\r?\n/g, CRLF).replace(/(?<!\r)\n/g, CRLF)}${CRLF}.${CRLF}`;
    await writer.write(new TextEncoder().encode(dotStuff(payload)));

    const accepted = await readReply(reader);
    if (!accepted.startsWith("250")) {
      throw new SmtpError(500, `Message rejected: ${accepted}`);
    }

    await writeCommand(writer, reader, `QUIT`);
    writer.releaseLock();
    reader.releaseLock();
  } finally {
    await socket.close().catch(() => {});
  }
}

export class SmtpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function writeCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  command: string,
): Promise<string> {
  await writer.write(new TextEncoder().encode(`${command}${CRLF}`));

  return readReply(reader);
}

/**
 * Reads one SMTP reply, joining multiline continuations (`250-...` followed by `250 ...`).
 * Enforces the read timeout so a silent server cannot hang the queue consumer.
 */
async function readReply(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + READ_TIMEOUT_MS;

  while (true) {
    const lineEnd = buffer.indexOf(CRLF);

    if (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + CRLF.length);

      if (line.length < 4 || line.at(3) !== "-") {
        return line;
      }

      continue;
    }

    if (Date.now() > deadline) {
      throw new Error("SMTP reply timed out.");
    }

    const { done, value } = await withTimeout(
      reader.read(),
      READ_TIMEOUT_MS,
      "SMTP reply timed out.",
    );

    if (done) {
      throw new Error(`SMTP connection closed mid-reply: ${buffer}`);
    }

    buffer += decoder.decode(value, { stream: true });
  }
}
