// Types only — no `import "server-only"` here: the live SMTP smoke test imports this module
// under plain Node, and every runtime importer below already carries the marker itself.

/**
 * Provider-neutral transactional email. `dispatchEmail` maps this onto whatever transport the
 * deployment selected: the Cloudflare `send_email` binding or a generic SMTP server. The
 * Cloudflare binding's message shape is a superset, so every field must survive the mapping —
 * including the template-type header the ban/unban trails rely on.
 */
export interface OutgoingEmail {
  to: string;
  from: { email: string; name?: string };
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  replyTo?: string;
}

/**
 * The reserved extension point for future transports (Resend, SES, …). Nothing imports it yet
 * by design: implement it next to `providers/smtp.ts`, add a `kind` to the decision union, and
 * register the new provider in `send.ts`.
 */
// oxlint-disable project/no-unused-module-exports -- Deliberately reserved for future providers.
export interface EmailProvider {
  send(message: OutgoingEmail): Promise<void>;
}
// oxlint-enable project/no-unused-module-exports

/** Host-side SMTP settings. The port is fixed: implicit TLS on 465, per the provider decision. */
export interface SmtpEmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: { email: string; name?: string };
  replyTo?: string;
}

export type EmailProviderDecision =
  | { kind: "cloudflare" }
  | { kind: "smtp"; smtp: SmtpEmailConfig }
  | { kind: "unavailable"; reason: string };
