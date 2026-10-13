import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import type { EmailProviderDecision } from "./types";

const EMAIL_PROVIDER_CLOUDFLARE = "cloudflare";
const EMAIL_PROVIDER_SMTP = "smtp";

/**
 * The one predicate for "is a real send configured". Both the dispatch behind
 * `sendTransactionalEmailNow` and the skip gate in `queueTransactionalEmail` read this, so a
 * provider can never look enabled to one and disabled to the other.
 */
export async function resolveEmailProvider(): Promise<EmailProviderDecision> {
  const { env } = await getCloudflareContext();

  const provider = env.EMAIL_PROVIDER || EMAIL_PROVIDER_CLOUDFLARE;

  if (provider === EMAIL_PROVIDER_SMTP) {
    return resolveSmtpProvider(env);
  }

  if (provider !== EMAIL_PROVIDER_CLOUDFLARE) {
    return { kind: "unavailable", reason: `Unknown EMAIL_PROVIDER "${provider}".` };
  }

  // Free-plan forks omit the EMAIL binding and the generated Env no longer declares it, so the
  // lookup stays structural (like the pre-provider check in email.tsx) instead of a hard read.
  const email = (env as { EMAIL?: { send: (message: unknown) => Promise<unknown> } }).EMAIL;

  if (!email) {
    return {
      kind: "unavailable",
      reason: "Cloudflare Email Service binding EMAIL is not configured.",
    };
  }

  if (!env.EMAIL_FROM) {
    return { kind: "unavailable", reason: "EMAIL_FROM is not configured." };
  }

  return { kind: "cloudflare" };
}

function resolveSmtpProvider(env: {
  EMAIL_SMTP_HOST?: string;
  EMAIL_SMTP_USER?: string;
  EMAIL_SMTP_PASS?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_REPLY_TO?: string;
}): EmailProviderDecision {
  const missing = (["EMAIL_SMTP_HOST", "EMAIL_SMTP_USER", "EMAIL_SMTP_PASS", "EMAIL_FROM"] as const)
    .filter((name) => !env[name]);

  if (missing.length > 0) {
    return { kind: "unavailable", reason: `SMTP provider requires ${missing.join(", ")}.` };
  }

  return {
    kind: "smtp",
    smtp: {
      host: env.EMAIL_SMTP_HOST!,
      // Fixed per the provider decision: implicit TLS only, no STARTTLS on 587.
      port: 465,
      user: env.EMAIL_SMTP_USER!,
      pass: env.EMAIL_SMTP_PASS!,
      from: {
        email: env.EMAIL_FROM!,
        ...(env.EMAIL_FROM_NAME ? { name: env.EMAIL_FROM_NAME } : {}),
      },
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
    },
  };
}
