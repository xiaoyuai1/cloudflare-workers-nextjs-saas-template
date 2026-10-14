import "server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { billingOrderTable, membershipPlanTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { grantMembership, MEMBERSHIP_GRANT_SOURCES } from "@/lib/billing/membership";
import { createHexId } from "@/utils/random-token";

// Order skeleton for the AutoJs6 account module (P2). The card-key channel completes an order
// atomically at redeem time (PENDING -> PAID -> COMPLETED in one request); the online-payment
// channels (P2.5) keep a PENDING order alive across a WebView checkout and flip it with the same
// CAS transitions from a provider callback. Status machine:
//
//   PENDING -> PAID -> COMPLETED      (online payment; card-key skips to COMPLETED)
//   PENDING -> CANCELLED | EXPIRED    (user cancel / cron sweep)
//
// design reference: sub2api (Wei-Shaw/sub2api, LGPL-3.0) docs/PAYMENT.md — order state machine.

export const ORDER_STATUSES = {
  PENDING: "PENDING",
  PAID: "PAID",
  COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
} as const;

export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const ORDER_CHANNELS = {
  CARD_KEY: "card_key",
} as const;

/** How many simultaneously open orders one account may hold (checkout-slot discipline). */
const MAX_PENDING_ORDERS_PER_USER = 3;
/** Pending orders die after this long; the cron sweep and the create-time cleanup both use it. */
export const ORDER_TTL_MINUTES = 30;
/** A callback arriving this soon after expiry may still complete the order (P2.5 grace). */
export const EXPIRY_GRACE_MS = 5 * 60 * 1000;

function newOutOrderNo(): string {
  // `AJ` + timestamp base36 + 6 random hex chars: unique-checked on insert, retried on clash.
  return `AJ${Date.now().toString(36).toUpperCase()}${createHexId(3).toUpperCase()}`;
}

const ORDER_COLUMNS = {
  id: true,
  outOrderNo: true,
  userId: true,
  userEmail: true,
  productId: true,
  productDays: true,
  productSnapshot: true,
  amountCents: true,
  channel: true,
  status: true,
  channelTradeNo: true,
  providerSnapshot: true,
  expiresAt: true,
  paidAt: true,
  completedAt: true,
  failedReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type AdminOrderRow = {
  id: string;
  outOrderNo: string;
  userId: string;
  userEmail: string | null;
  productId: string | null;
  productDays: number;
  productSnapshot: string | null;
  amountCents: number;
  channel: string;
  status: string;
  channelTradeNo: string | null;
  providerSnapshot: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  failedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Create a PENDING order from a membership plan. The plan row is snapshotted (days/price/name)
 * so a later price or title change cannot move an open order. Card-key-channel orders are
 * created only internally by `completeCardKeyOrder`; this entry point is what P2.5's checkout
 * will call with a real channel.
 */
export async function createOrderFromPlan({
  userId,
  userEmail,
  planId,
  channel,
  now = new Date(),
}: {
  userId: string;
  userEmail: string | null;
  planId: string;
  channel: string;
  now?: Date;
}): Promise<AdminOrderRow> {
  const db = getDB();

  const plan = await db.query.membershipPlanTable.findFirst({
    where: { id: planId },
    columns: { id: true, name: true, days: true, priceCents: true, enabled: true },
  });

  if (!plan || !plan.enabled) {
    throw new ActionError("NOT_FOUND", "That membership plan does not exist or is not enabled.");
  }

  // Cheap in-create cleanup plus the cap: expire this user's dead pendings first, then count.
  await db
    .update(billingOrderTable)
    .set({ status: ORDER_STATUSES.EXPIRED, updatedAt: now })
    .where(
      and(
        eq(billingOrderTable.userId, userId),
        eq(billingOrderTable.status, ORDER_STATUSES.PENDING),
        lt(billingOrderTable.expiresAt, now),
      ),
    );

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(billingOrderTable)
    .where(
      and(
        eq(billingOrderTable.userId, userId),
        eq(billingOrderTable.status, ORDER_STATUSES.PENDING),
      ),
    );

  if (count >= MAX_PENDING_ORDERS_PER_USER) {
    throw new ActionError(
      "CONFLICT",
      `Too many open orders. Complete or cancel an existing one first (max ${MAX_PENDING_ORDERS_PER_USER}).`,
    );
  }

  const snapshot = JSON.stringify({ name: plan.name, priceCents: plan.priceCents });
  const expiresAt = new Date(now.getTime() + ORDER_TTL_MINUTES * 60 * 1000);

  // Out-order-no clash retry: the format is near-unique, but the index is the authority.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [created] = await db
        .insert(billingOrderTable)
        .values({
          outOrderNo: newOutOrderNo(),
          userId,
          userEmail,
          productId: plan.id,
          productDays: plan.days,
          productSnapshot: snapshot,
          amountCents: plan.priceCents,
          channel,
          status: ORDER_STATUSES.PENDING,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!created) {
        throw new ActionError("INTERNAL_SERVER_ERROR", "The order could not be created.");
      }

      return created as AdminOrderRow;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes("billing_order_out_order_no_unique")) {
        throw error;
      }
    }
  }

  throw new ActionError("INTERNAL_SERVER_ERROR", "Could not allocate a unique order number.");
}

/** One order by id, scoped to its owner unless `anyOwner` (admin). */
export async function getOrder({
  orderId,
  userId,
  anyOwner = false,
}: {
  orderId: string;
  userId?: string;
  anyOwner?: boolean;
}): Promise<AdminOrderRow | null> {
  const row = await getDB().query.billingOrderTable.findFirst({
    // Relational-filter object form (drizzle v1): the id filter always applies; the owner scope
    // narrows it for non-admin callers.
    where: userId && !anyOwner ? { id: orderId, userId } : { id: orderId },
    columns: ORDER_COLUMNS,
  });

  return (row as AdminOrderRow | undefined) ?? null;
}

/** The caller's own orders, optionally filtered by status, newest first. */
export async function listOrdersForUser({
  userId,
  status,
  limit = 50,
}: {
  userId: string;
  status?: string;
  limit?: number;
}): Promise<AdminOrderRow[]> {
  const rows = await getDB().query.billingOrderTable.findMany({
    where: status ? { userId, status } : { userId },
    columns: ORDER_COLUMNS,
    orderBy: { createdAt: "desc" },
    limit,
  });

  return rows as AdminOrderRow[];
}

/** Admin order listing with search + status/channel filters (panel + internal API). */
export async function listOrdersForAdmin({
  page,
  pageSize,
  status,
  channel,
  search,
}: {
  page: number;
  pageSize: number;
  status?: string;
  channel?: string;
  search?: string;
}): Promise<{ orders: AdminOrderRow[]; totalCount: number; totalPages: number }> {
  const db = getDB();

  const searchNeedle = search ? `%${search.trim().toLowerCase()}%` : null;
  const hasFilters = Boolean(status || channel || searchNeedle);

  const [[{ count }], orders] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(billingOrderTable)
      .where(
        hasFilters
          ? and(
              status ? eq(billingOrderTable.status, status) : undefined,
              channel ? eq(billingOrderTable.channel, channel) : undefined,
              searchNeedle
                ? sql`(lower(${billingOrderTable.outOrderNo}) LIKE ${searchNeedle} OR lower(${billingOrderTable.userEmail}) LIKE ${searchNeedle})`
                : undefined,
            )
          : undefined,
      ),
    db.query.billingOrderTable.findMany({
      columns: ORDER_COLUMNS,
      // An unfiltered listing passes `undefined` rather than `{}` — see the users listing note.
      where: hasFilters
        ? {
            ...(status ? { status } : {}),
            ...(channel ? { channel } : {}),
            ...(searchNeedle
              ? {
                  OR: [
                    { outOrderNo: { like: searchNeedle } },
                    { userEmail: { like: searchNeedle } },
                  ],
                }
              : {}),
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);

  return {
    orders: orders as AdminOrderRow[],
    totalCount: count,
    totalPages: Math.ceil(count / pageSize),
  };
}

/**
 * User cancel: PENDING only, owner only. Already-paid orders are refused (400-style CONFLICT).
 */
export async function cancelOrder({
  orderId,
  userId,
  now = new Date(),
}: {
  orderId: string;
  userId: string;
  now?: Date;
}): Promise<void> {
  return cancelOrderInternal({ orderId, userId, now });
}

/** Admin cancel: PENDING only, no owner scoping (the panel may stop any stuck checkout). */
export async function cancelOrderAsAdmin({
  orderId,
  now = new Date(),
}: {
  orderId: string;
  now?: Date;
}): Promise<void> {
  return cancelOrderInternal({ orderId, userId: undefined, now });
}

async function cancelOrderInternal({
  orderId,
  userId,
  now,
}: {
  orderId: string;
  userId?: string;
  now: Date;
}): Promise<void> {
  const db = getDB();

  // CAS: only a PENDING row can flip to CANCELLED; the loser reads the row to explain why.
  const cancelled = await db
    .update(billingOrderTable)
    .set({ status: ORDER_STATUSES.CANCELLED, updatedAt: now })
    .where(
      and(
        eq(billingOrderTable.id, orderId),
        eq(billingOrderTable.status, ORDER_STATUSES.PENDING),
        // Relational-filter object form is not available on the update builder; the eq() chain
        // with an optional owner term is the drizzle-idiomatic conditional.
        ...(userId ? [eq(billingOrderTable.userId, userId)] : []),
      ),
    );

  if ((cancelled.meta?.changes ?? 0) === 1) {
    return;
  }

  const row = await db.query.billingOrderTable.findFirst({
    where: userId ? { id: orderId, userId } : { id: orderId },
    columns: { status: true },
  });

  if (!row) {
    throw new ActionError("NOT_FOUND", "No order exists with that id.");
  }

  throw new ActionError(
    "CONFLICT",
    row.status === ORDER_STATUSES.PENDING
      ? "That order could not be cancelled; try again."
      : { key: "Client.Billing.errorOrderNotCancellable" },
  );
}

/**
 * Fulfil a paid order: PENDING/PAID -> COMPLETED with the membership grant. One CAS per hop, so
 * a replayed callback or a concurrent poller is a no-op. This is the P2.5 notify handler's core;
 * the card-key path calls it straight after the redeem claim.
 */
export async function completeOrderWithGrant({
  orderId,
  userId,
  now = new Date(),
}: {
  orderId: string;
  userId: string;
  now?: Date;
}): Promise<{ daysGranted: number; dateExpired: string | null }> {
  const db = getDB();

  // Hop 1: PENDING -> PAID (records when the money arrived). Already-PAID/COMPLETED both skip.
  await db
    .update(billingOrderTable)
    .set({ status: ORDER_STATUSES.PAID, paidAt: now, updatedAt: now })
    .where(
      and(
        eq(billingOrderTable.id, orderId),
        eq(billingOrderTable.status, ORDER_STATUSES.PENDING),
      ),
    );

  // Read the frozen product snapshot for the grant.
  const order = await db.query.billingOrderTable.findFirst({
    where: { id: orderId, userId },
    columns: { id: true, userId: true, productDays: true, status: true },
  });

  if (!order) {
    throw new ActionError("NOT_FOUND", "No order exists with that id.");
  }

  // Hop 2: PAID -> COMPLETED. The membership_grant UNIQUE(source, refId) additionally
  // guarantees the expiry moves once even if two workers pass this gate simultaneously.
  const completed = await db
    .update(billingOrderTable)
    .set({ status: ORDER_STATUSES.COMPLETED, completedAt: now, updatedAt: now })
    .where(
      and(
        eq(billingOrderTable.id, orderId),
        inArray(billingOrderTable.status, [ORDER_STATUSES.PAID, ORDER_STATUSES.PENDING]),
      ),
    );

  if ((completed.meta?.changes ?? 0) === 0 && order.status === ORDER_STATUSES.COMPLETED) {
    // Replay of a fully processed order: report the already-granted state.
    return { daysGranted: 0, dateExpired: null };
  }

  const granted = await grantMembership({
    userId: order.userId,
    days: order.productDays,
    source: MEMBERSHIP_GRANT_SOURCES.ORDER,
    refId: order.id,
  });

  return granted;
}

/**
 * Cron sweep: expire stale PENDING orders. Returns how many rows flipped. P2.5's reconcile pass
 * (query the provider before expiring) wraps this — the grace window above is what it claims.
 */
export async function expireStalePendingOrders({ now = new Date() }: { now?: Date }): Promise<number> {
  const result = await getDB()
    .update(billingOrderTable)
    .set({ status: ORDER_STATUSES.EXPIRED, updatedAt: now })
    .where(
      and(
        eq(billingOrderTable.status, ORDER_STATUSES.PENDING),
        lt(billingOrderTable.expiresAt, now),
      ),
    );

  return result.meta?.changes ?? 0;
}

/** Complete a card-key-channel order: mint PENDING, then straight to COMPLETED with the grant. */
export async function completeCardKeyOrder({
  userId,
  userEmail,
  planDays,
  amountCents,
  cardKeyId,
  now = new Date(),
}: {
  userId: string;
  userEmail: string | null;
  planDays: number;
  amountCents: number;
  cardKeyId: string;
  now?: Date;
}): Promise<{ daysGranted: number; dateExpired: string | null }> {
  const db = getDB();

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [created] = await db
        .insert(billingOrderTable)
        .values({
          outOrderNo: newOutOrderNo(),
          userId,
          userEmail,
          productId: null,
          productDays: planDays,
          productSnapshot: JSON.stringify({ source: ORDER_CHANNELS.CARD_KEY, cardKeyId }),
          amountCents,
          channel: ORDER_CHANNELS.CARD_KEY,
          status: ORDER_STATUSES.COMPLETED,
          paidAt: now,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: billingOrderTable.id });

      if (!created) {
        throw new ActionError("INTERNAL_SERVER_ERROR", "The order could not be created.");
      }

      const granted = await grantMembership({
        userId,
        days: planDays,
        source: MEMBERSHIP_GRANT_SOURCES.ORDER,
        refId: created.id,
      });

      return granted;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes("billing_order_out_order_no_unique")) {
        throw error;
      }
    }
  }

  throw new ActionError("INTERNAL_SERVER_ERROR", "Could not allocate a unique order number.");
}
