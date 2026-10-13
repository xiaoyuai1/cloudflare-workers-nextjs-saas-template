import "server-only";

import type { OutgoingEmail, SmtpEmailConfig } from "../types";
import { SmtpError, sendViaSmtp } from "../smtp/client";

/** Generic SMTP transport over implicit TLS. QQ Mail, 163, Gmail, corporate relays: config only. */
export async function sendViaSmtpProvider(
  config: SmtpEmailConfig,
  message: OutgoingEmail,
): Promise<void> {
  try {
    await sendViaSmtp(config, {
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    });
  } catch (error) {
    // Preserve the SmtpError contract for the queue's retry logic; annotate the rest.
    if (error instanceof SmtpError) {
      throw error;
    }

    throw new Error(
      `SMTP send to ${message.to} via ${config.host} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
