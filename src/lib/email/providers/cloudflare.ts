import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import type { OutgoingEmail } from "../types";

/**
 * Avoids `Pick<>` from `SendEmail.send()` params: `EmailDestinations` is a to|cc|bcc union, so
 * `Pick` makes `to` optional and breaks assignment. Same structural shape as the pre-provider
 * code in email.tsx, so behavior on the default path is byte-for-byte identical.
 */
type CloudflareSendEmail = {
  send: (message: unknown) => Promise<unknown>;
};

export async function sendViaCloudflareEmail(message: OutgoingEmail): Promise<void> {
  const { env } = await getCloudflareContext();
  const email = (env as { EMAIL?: CloudflareSendEmail }).EMAIL;

  // Unreachable through `dispatchEmail` (the resolver already checked), but this module is
  // reachable directly, so fail with the same message the resolver would produce.
  if (!email) {
    throw new Error("Cloudflare Email Service binding EMAIL is not configured.");
  }

  const cloudflareMessage = {
    to: message.to,
    from: message.from.name
      ? {
          email: message.from.email,
          name: message.from.name,
        }
      : message.from.email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
  };

  await email.send(cloudflareMessage);
}
