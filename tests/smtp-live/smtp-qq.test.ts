/**
 * Live smoke test: sends one real email through smtp.qq.com:465 (implicit TLS) to the test
 * account itself, using Node's net/tls stack as the transport oracle.
 *
 * Not part of `pnpm run test:unit` / `test:integration` — it costs a real send and needs real
 * credentials. Run it on demand:
 *
 *   EMAIL_SMTP_USER=... EMAIL_SMTP_PASS=... npx pnpm exec tsx tests/smtp-live/smtp-qq.test.ts
 *
 * Credentials come from `.dev.vars` (QQ Mail auth code), which is gitignored.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

import { buildNodeMimeMessage } from "./node-mime.ts";
import type { SmtpEmailConfig } from "../../src/lib/email/types.ts";

const SMTP_PORT = 465;
const READ_TIMEOUT_MS = 15_000;
const CRLF = "\r\n";

function loadDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(join(import.meta.dirname, "..", "..", ".dev.vars"), "utf8");

    return Object.fromEntries(
      raw.split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const eq = line.indexOf("=");

          return [line.slice(0, eq), line.slice(eq + 1)];
        }),
    );
  } catch {
    return {};
  }
}

const devVars = loadDevVars();
const user = process.env.EMAIL_SMTP_USER || devVars.EMAIL_SMTP_USER;
const pass = process.env.EMAIL_SMTP_PASS || devVars.EMAIL_SMTP_PASS;
const host = process.env.EMAIL_SMTP_HOST || devVars.EMAIL_SMTP_HOST || "smtp.qq.com";

if (!user || !pass) {
  console.error("SKIP: EMAIL_SMTP_USER / EMAIL_SMTP_PASS not set (.dev.vars or env).");
  process.exit(0);
}

const config: SmtpEmailConfig = {
  host,
  port: SMTP_PORT,
  user,
  pass,
  from: { email: user, name: "SaaS Template" },
};

interface Conversation {
  commands: string[];
  replies: string[];
}

/** Node TLS transport speaking the same protocol as `src/lib/email/smtp/client.ts`. */
async function sendViaNodeTls(config: SmtpEmailConfig, message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<Conversation> {
  const conversation: Conversation = { commands: [], replies: [] };
  const socket = tls.connect({
    host: config.host,
    port: config.port,
    servername: config.host,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
    socket.setTimeout(READ_TIMEOUT_MS, () => reject(new Error("connect timed out")));
  });

  let buffer = "";

  const readReply = () => new Promise<string>((resolve, reject) => {
    const deadline = Date.now() + READ_TIMEOUT_MS;

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");

      const lineEnd = buffer.indexOf(CRLF);

      if (lineEnd < 0) {
        if (Date.now() > deadline) {
          socket.off("data", onData);
          reject(new Error("reply timed out"));

          return;
        }

        return;
      }

      socket.off("data", onData);
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + CRLF.length);

      // Multiline replies keep arriving with `250-` continuations; keep reading.
      if (line.length >= 4 && line.at(3) === "-") {
        socket.once("data", onData);
        onData(Buffer.alloc(0));

        return;
      }

      resolve(line);
    };

    socket.once("data", onData);
  });

  const command = async (cmd: string): Promise<string> => {
    conversation.commands.push(cmd.replace(/(?<=AUTH LOGIN \r\n)^.*$/m, "***"));
    socket.write(`${cmd}${CRLF}`);
    const reply = await readReply();
    conversation.replies.push(reply);

    if (!/^[23]/.test(reply)) {
      throw new Error(`SMTP ${reply.split(" ")[0]}: ${reply}`);
    }

    return reply;
  };

  const greeting = await readReply();
  conversation.replies.push(greeting);

  if (!greeting.startsWith("220")) {
    throw new Error(`bad greeting: ${greeting}`);
  }

  await command(`EHLO ${config.host}`);
  await command("AUTH LOGIN");
  await command(Buffer.from(config.user).toString("base64"));
  await command(Buffer.from(config.pass).toString("base64"));
  await command(`MAIL FROM:<${config.from.email}>`);
  await command(`RCPT TO:<${message.to}>`);

  const dataReply = await command("DATA");
  if (!dataReply.startsWith("354")) {
    throw new Error(`DATA refused: ${dataReply}`);
  }

  const payload = `${buildNodeMimeMessage(config, message).replaceAll(/\r?\n/g, CRLF)}.${CRLF}`
    .replaceAll(/\r\n\./g, `${CRLF}..`)
    // The terminator must stay a bare dot; undo the stuffing on the final line only.
    .replace(/\.\.\r\n$/, `.${CRLF}`);
  socket.write(payload);

  const accepted = await readReply();
  conversation.replies.push(accepted);

  if (!accepted.startsWith("250")) {
    throw new Error(`message rejected: ${accepted}`);
  }

  await command("QUIT");
  socket.end();

  return conversation;
}

const nonce = crypto.randomUUID().slice(0, 8);
const result = await sendViaNodeTls(config, {
  to: config.user,
  subject: `[saas-template] SMTP live test ${nonce}`,
  text: `这是 SaaS 模板 SMTP 真发测试邮件(${nonce})。收到即表示 smtp.qq.com:465 链路可用。`,
  html: `<p>这是 SaaS 模板 SMTP 真发测试邮件(<strong>${nonce}</strong>)。收到即表示 smtp.qq.com:465 链路可用。</p>`,
});

console.log("SMTP live test PASSED.");
console.log(`  host: ${config.host}:${config.port}`);
console.log(`  from: ${config.from.email}`);
console.log(`  to:   ${config.user}  (check the inbox, subject nonce: ${nonce})`);
console.log(`  replies: ${result.replies.join(" | ")}`);
