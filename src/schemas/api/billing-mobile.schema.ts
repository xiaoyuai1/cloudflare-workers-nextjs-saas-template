import { v } from "@/lib/validation";

// Mobile-app billing REST (AutoJs6 account module P2), contract table B of
// AutoJs6-noOperit-account/docs/账号模块开发文档.md. Wire format both ends compile against.
// Amounts are integer cents; days are integers; dates are ISO strings.

/** A purchasable membership tier, as the recharge list shows it. */
export const billingProductSchema = v.object({
  id: v.string(),
  name: v.string(),
  days: v.number(),
  priceCents: v.number(),
  enabled: v.boolean(),
});

export const billingProductsResponseSchema = v.object({
  products: v.array(billingProductSchema),
});

export const billingRedeemSchema = v.object({
  code: v.pipe(v.string(), v.minLength(4), v.maxLength(64)),
});

export const billingRedeemResponseSchema = v.object({
  daysGranted: v.number(),
  dateExpired: v.nullable(v.string()),
});

export const billingRedeemHistoryResponseSchema = v.object({
  entries: v.array(
    v.object({
      code: v.string(),
      days: v.number(),
      usedAt: v.string(),
    }),
  ),
});

export const billingOrderSchema = v.object({
  id: v.string(),
  outOrderNo: v.string(),
  productDays: v.number(),
  amountCents: v.number(),
  channel: v.string(),
  status: v.picklist(["PENDING", "PAID", "COMPLETED", "EXPIRED", "CANCELLED", "FAILED"]),
  expiresAt: v.nullable(v.string()),
  paidAt: v.nullable(v.string()),
  completedAt: v.nullable(v.string()),
  createdAt: v.string(),
});

export const billingOrderResponseSchema = v.object({ order: billingOrderSchema });

export const billingOrdersResponseSchema = v.object({
  orders: v.array(billingOrderSchema),
});

export const billingCreateOrderSchema = v.object({
  planId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  // P2 accepts only the internal card-key channel; P2.5 widens this picklist with real channels.
  channel: v.picklist(["card_key"]),
});

export const billingOrderParamSchema = v.object({
  orderId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
});

export type BillingProduct = v.InferOutput<typeof billingProductSchema>;
export type BillingOrder = v.InferOutput<typeof billingOrderSchema>;
