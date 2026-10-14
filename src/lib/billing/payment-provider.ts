import "server-only";

// Payment provider seam for the AutoJs6 account module (P2.5). P2 ships the interface and the
// notify-route skeleton only: no channel is configured, nothing here performs network I/O, and
// the first real adapter lands with the chosen provider. Keeping the contract in a dependency-free
// module means P2.5 fills in implementations without touching the order state machine.
//
// design reference: sub2api (Wei-Shaw/sub2api, LGPL-3.0) docs/PAYMENT.md — Provider contract.

export interface PaymentProviderRequest {
  orderId: string;
  outOrderNo: string;
  amountCents: number;
  subject: string;
  notifyUrl: string;
  returnUrl: string;
  isMobile: boolean;
}

export interface PaymentProviderResult {
  /** Hosted checkout URL to open in a WebView / Custom Tab. */
  payUrl?: string;
  /** QR payload to render in-app. */
  qrCode?: string;
  tradeNo: string;
}

export interface PaymentProviderQuery {
  paid: boolean;
  amountCents?: number;
  tradeNo?: string;
}

/** A verified, amount-checked notification. `null` = not an event this provider handles. */
export interface PaymentNotification {
  outOrderNo: string;
  tradeNo: string;
  status: "success" | "failed";
  amountCents?: number;
}

export interface PaymentProvider {
  /** Channel key as stored in `billing_order.channel` (e.g. "alipay"). */
  key(): string;
  supportedTypes(): string[];
  createPayment(req: PaymentProviderRequest, config: Record<string, string>): Promise<PaymentProviderResult>;
  queryOrder(outOrderNo: string, config: Record<string, string>): Promise<PaymentProviderQuery | null>;
  /** Verify then parse one notification. Signature failure throws; unrelated events return null. */
  verifyNotification(rawBody: string, headers: Headers, config: Record<string, string>): Promise<PaymentNotification | null>;
}

const PROVIDERS = new Map<string, PaymentProvider>();

/** Register at startup (or lazily per channel); unknown channels refuse at notify time. */
export function registerPaymentProvider(provider: PaymentProvider): void {
  PROVIDERS.set(provider.key(), provider);
}

export function getPaymentProvider(channel: string): PaymentProvider | null {
  return PROVIDERS.get(channel) ?? null;
}

export function listPaymentProviders(): string[] {
  return [...PROVIDERS.keys()];
}
