import "server-only";

import { Hono } from "hono";

import { apiValidator } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { getDB } from "@/db";
import { membershipPlanTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { redeemCardKey, listRedeemHistory } from "@/lib/billing/card-keys";
import { cancelOrder, getOrder, listOrdersForUser } from "@/lib/billing/orders";
import { __INTERNAL_TRUSTED_CLIENT_IP_HEADER } from "@/utils/trusted-client-ip";
import { getCurrentSession, requireVerifiedEmail } from "@/utils/auth";
import {
  billingCreateOrderSchema,
  billingOrderParamSchema,
  billingOrdersResponseSchema,
  billingOrderResponseSchema,
  billingProductsResponseSchema,
  billingRedeemHistoryResponseSchema,
  billingRedeemResponseSchema,
  billingRedeemSchema,
} from "@/schemas/api/billing-mobile.schema";
import { successSchema } from "@/schemas/api/common.schema";

// Mobile-app billing REST (AutoJs6 account module P2), contract table B. Redeem and order
// management require the Bearer msession plus a verified email (buying is a content feature);
// the products list is public-read so the recharge page renders before sign-in.

// Session helpers for the route handlers. Read endpoints tolerate an unverified email
// (read-only); write endpoints go through `requireVerifiedEmail` — buying is a content feature,
// which is a no-op gate while the deployment runs with the verification bypass.
async function requireSession(): Promise<{ userId: string; email: string | null }> {
  const session = await getCurrentSession();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  return { userId: session.user.id, email: session.user.email };
}

function orderToJson(row: {
  id: string;
  outOrderNo: string;
  productDays: number;
  amountCents: number;
  channel: string;
  status: string;
  expiresAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    outOrderNo: row.outOrderNo,
    productDays: row.productDays,
    amountCents: row.amountCents,
    channel: row.channel,
    status: row.status as "PENDING" | "PAID" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "FAILED",
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const billingMobileRoutes = new Hono<ApiEnv>()
  .get(
    "/billing/products",
    ...apiOperation({
      operationId: "mobileListBillingProducts",
      tags: [API_TAGS.billing],
      summary: "List purchasable membership plans",
      description:
        "The recharge page's tier list: enabled plans with their days and price in cents. " +
        "Public read — the app renders the list before the user signs in, so no scope can be " +
        "required of the anonymous caller (same deliberate-unscoped shape as the auth handshake).",
      scope: null,
      audience: "any",
      responses: {
        200: jsonResponse({
          description: "The enabled plans, cheapest-first by sort order.",
          schema: billingProductsResponseSchema,
        }),
      },
    }),
    async (c) => {
      const rows = await getDB()
        .select({
          id: membershipPlanTable.id,
          name: membershipPlanTable.name,
          days: membershipPlanTable.days,
          priceCents: membershipPlanTable.priceCents,
          enabled: membershipPlanTable.enabled,
          sortOrder: membershipPlanTable.sortOrder,
          createdAt: membershipPlanTable.createdAt,
        })
        .from(membershipPlanTable)
        .orderBy(membershipPlanTable.sortOrder, membershipPlanTable.createdAt)
        .limit(100);

      return c.json({
        products: rows
          .filter((row) => row.enabled === 1)
          .map((row) => ({
            id: row.id,
            name: row.name,
            days: row.days,
            priceCents: row.priceCents,
            enabled: true,
          })),
      });
    },
  )
  .post(
    "/billing/redeem",
    ...apiOperation({
      operationId: "mobileRedeemCardKey",
      tags: [API_TAGS.billing],
      summary: "Redeem a membership card key",
      description:
        "Claims the code (concurrent redeems of one code: exactly one caller wins), extends the " +
        "account's membership, and answers the new expiry. Failure limiter: 30 attempts per " +
        "10 minutes, reset on success — enumeration is not a legitimate use.",
      scope: "billing:write",
      audience: "account",
      responses: {
        200: jsonResponse({
          description: "The granted days and the new membership expiry.",
          schema: billingRedeemResponseSchema,
        }),
      },
    }),
    apiValidator("json", billingRedeemSchema),
    async (c) => {
      // Buying membership is a content feature: the verified-email gate applies (and is a no-op
      // while the deployment runs with the verification bypass).
      const session = await requireVerifiedEmail();
      const { code } = c.req.valid("json");

      const result = await redeemCardKey({
        userId: session.userId,
        code,
        clientIp: c.req.header(__INTERNAL_TRUSTED_CLIENT_IP_HEADER) ?? null,
      });

      return c.json(result);
    },
  )
  .get(
    "/billing/card-key/redeem-history",
    ...apiOperation({
      operationId: "mobileRedeemHistory",
      tags: [API_TAGS.billing],
      summary: "List the caller's card-key redemptions",
      description: "The account's own redeem journal, newest first (max 50).",
      scope: "billing:read",
      audience: "account",
      responses: {
        200: jsonResponse({
          description: "The redeemed card keys.",
          schema: billingRedeemHistoryResponseSchema,
        }),
      },
    }),
    async (c) => {
      const { userId } = await requireSession();

      return c.json({ entries: await listRedeemHistory({ userId }) });
    },
  )
  .post(
    "/billing/orders",
    ...apiOperation({
      operationId: "mobileCreateOrder",
      tags: [API_TAGS.billing],
      summary: "Create a membership order",
      description:
        "Freezes the plan snapshot into a PENDING order for an online-payment channel (P2.5). " +
        "P2 ships no real channel yet, so the endpoint refuses every request with 400 — the " +
        "card-key path completes atomically inside /billing/redeem instead.",
      scope: "billing:write",
      audience: "account",
      responses: {
        201: jsonResponse({ description: "The created order.", schema: billingOrderResponseSchema }),
      },
    }),
    apiValidator("json", billingCreateOrderSchema),
    async (c) => {
      await requireVerifiedEmail();
      const { planId, channel } = c.req.valid("json");

      // P2: no live payment channel exists. The plan must still resolve so a caller sees the
      // right refusal, and the 400 keeps the endpoint honest until P2.5 wires a real channel.
      const plan = await getDB().query.membershipPlanTable.findFirst({
        where: { id: planId },
        columns: { id: true, enabled: true },
      });

      if (!plan || !plan.enabled) {
        throw new ActionError("NOT_FOUND", "That membership plan does not exist or is not enabled.");
      }

      throw new ActionError(
        "BAD_REQUEST",
        `Online payment is not open yet (channel ${channel}); redeem a card key instead.`,
      );
    },
  )
  .get(
    "/billing/orders",
    ...apiOperation({
      operationId: "mobileListOrders",
      tags: [API_TAGS.billing],
      summary: "List the caller's orders",
      description:
        "The account's own orders, newest first; `?status=pending` drives the app's " +
        "unfinished-transaction recovery prompt.",
      scope: "billing:read",
      audience: "account",
      responses: {
        200: jsonResponse({
          description: "The orders.",
          schema: billingOrdersResponseSchema,
        }),
      },
    }),
    async (c) => {
      const { userId } = await requireSession();
      const status = c.req.query("status");

      const orders = await listOrdersForUser({
        userId,
        status: status ? status.toUpperCase() : undefined,
      });

      return c.json({ orders: orders.map(orderToJson) });
    },
  )
  .get(
    "/billing/orders/:orderId",
    ...apiOperation({
      operationId: "mobileGetOrder",
      tags: [API_TAGS.billing],
      summary: "Poll one order",
      description: "The caller's own order by id — the P2.5 checkout poll target.",
      scope: "billing:read",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The order.", schema: billingOrderResponseSchema }),
      },
    }),
    apiValidator("param", billingOrderParamSchema),
    async (c) => {
      const { userId } = await requireSession();
      const { orderId } = c.req.valid("param");

      const order = await getOrder({ orderId, userId });

      if (!order) {
        throw new ActionError("NOT_FOUND", "No order exists with that id.");
      }

      return c.json({ order: orderToJson(order) });
    },
  )
  .post(
    "/billing/orders/:orderId/cancel",
    ...apiOperation({
      operationId: "mobileCancelOrder",
      tags: [API_TAGS.billing],
      summary: "Cancel a pending order",
      description: "Owner-only, PENDING-only; anything else answers 409 with its status.",
      scope: "billing:write",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "Cancelled.", schema: successSchema }),
      },
    }),
    apiValidator("param", billingOrderParamSchema),
    async (c) => {
      const session = await requireVerifiedEmail();
      const { orderId } = c.req.valid("param");

      await cancelOrder({ orderId, userId: session.userId });

      return c.json({ success: true });
    },
  );
