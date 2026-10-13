import "server-only";

import { resolveEmailProvider } from "./resolve-provider";
import type { OutgoingEmail } from "./types";

/** Maps the provider-neutral message onto the selected transport. Throws when unconfigured. */
export async function dispatchEmail(message: OutgoingEmail): Promise<void> {
  const decision = await resolveEmailProvider();

  if (decision.kind === "unavailable") {
    throw new Error(decision.reason);
  }

  if (decision.kind === "cloudflare") {
    // Lazy imports keep the SMTP protocol layer out of the bundle of deployments on the
    // default Cloudflare path.
    const { sendViaCloudflareEmail } = await import("./providers/cloudflare");

    await sendViaCloudflareEmail(message);

    return;
  }

  const { sendViaSmtpProvider } = await import("./providers/smtp");

  await sendViaSmtpProvider(decision.smtp, message);
}
