# Email Providers

Transactional email goes through one dispatch (`sendTransactionalEmailNow` in
`src/utils/email.tsx`) onto a pluggable transport. The deployment picks the transport with the
`EMAIL_PROVIDER` variable; templates, the localhost preview, and the queue path are identical
for every provider.

| Provider | `EMAIL_PROVIDER` | Needs | Plan |
| --- | --- | --- | --- |
| Cloudflare Email Service (default) | `cloudflare` | The `EMAIL` `send_email` binding in `wrangler.jsonc` | Workers Paid |
| Generic SMTP (implicit TLS, port 465) | `smtp` | `EMAIL_SMTP_HOST`, `EMAIL_SMTP_USER` (secret), `EMAIL_SMTP_PASS` (secret) | any |

## Why an abstraction

The Cloudflare binding requires the Workers Paid plan and a domain onboarded to Cloudflare
Email Service. A generic SMTP provider covers mailboxes that expose plain SMTP — QQ Mail, 163,
Gmail, corporate relays — which is often exactly what a regional fork needs to send its
verification and password-reset mail. Both transports produce the same `OutgoingEmail`
(`src/lib/email/types.ts`), so a fork switches by setting variables, never by editing
`src/utils/email.tsx`.

Adding a future transport (Resend, SES, an HTTP API) means: one file under
`src/lib/email/providers/`, one `kind` in the `EmailProviderDecision` union, one case in
`send.ts`. The `EmailProvider` interface in `types.ts` is the extension point.

## Generic SMTP provider

Implementation: `src/lib/email/smtp/`. A minimal client built on `cloudflare:sockets`
(`connect` with `secureTransport: "on"`), one message per connection, fixed port 465. There is
deliberately no STARTTLS/587 support — workerd's `startTls()` is unreliable for SMTP
(workerd issue #2712) — and no connection pool. Non-2xx/3xx replies throw with the server's
status code and text, which the scheduler queue's retries (`max_retries: 5`) treat as a failed
job.

MIME construction (`src/lib/email/smtp/mime.ts`, `message.ts`) is pure and unit-tested:
RFC 2047 B-encoded headers, base64 bodies, `multipart/alternative`. This is what keeps Chinese
subjects and bodies intact on QQ Mail and other CJK-sensitive providers.

Configuration (`wrangler secret put` in production, `.dev.vars` locally):

```
EMAIL_PROVIDER=smtp
EMAIL_SMTP_HOST=smtp.qq.com        # the provider's SMTP host
EMAIL_SMTP_USER=you@qq.com         # secret: the login account
EMAIL_SMTP_PASS=...                # secret: the provider's SMTP credential
EMAIL_FROM=you@qq.com              # must equal EMAIL_SMTP_USER on QQ Mail
EMAIL_FROM_NAME=SaaS Template      # optional display name
EMAIL_REPLY_TO=support@example.com # optional
```

## QQ Mail setup

1. Sign in at [mail.qq.com](https://mail.qq.com) → **设置 → 帐户** → enable **POP3/SMTP 服务**
   (SMS verification). QQ Mail issues a 16-character **授权码** — that is `EMAIL_SMTP_PASS`,
   not the QQ password. Newly registered accounts may need to age before the service can be
   enabled.
2. Fill the configuration block above with `EMAIL_SMTP_HOST=smtp.qq.com`.
3. QQ Mail forces the envelope and `From:` sender to the authenticated account, so
   `EMAIL_FROM` must equal `EMAIL_SMTP_USER`. Sending as any other address is rejected with
   `501`/`554` at the `MAIL FROM`/`DATA` step.

### Limits and positioning

QQ Mail's SMTP is meant for low-volume personal/notification mail: daily send caps apply,
attachments and bulk sends are restricted, and a `@qq.com` sender often lands in spam
international-side. For production SaaS email at volume, a custom domain on Cloudflare Email
Service (or an HTTP-API provider) remains the recommended path. The abstraction exists so the
switch is configuration, not code.
