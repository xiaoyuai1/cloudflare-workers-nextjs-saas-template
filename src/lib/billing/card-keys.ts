import "server-only";

import { CARD_KEY_BATCH_MAX_COUNT } from "@/constants";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { cardKeyBatchTable, cardKeyTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { grantMembership, MEMBERSHIP_GRANT_SOURCES } from "@/lib/billing/membership";
import { withRateLimit } from "@/utils/with-rate-limit";

// Card-key (卡密) issuance and redemption for the AutoJs6 account module. The redeem is a
// two-statement claim: a conditional UPDATE flips `unused -> used` and reports `meta.changes` —
// that single CAS is the whole concurrency story on D1 (no locks, no Redis): of N concurrent
// redeems of one code, exactly one sees changes = 1, and the loser reads the row to name why.
// The membership grant rides in the same batch, keyed by (source, refId) so even a hypothetical
// double-fire cannot extend the expiry twice.
//
// design reference: sub2api (Wei-Shaw/sub2api, LGPL-3.0) docs/PAYMENT.md — redeem optimistic lock.

export const CARD_KEY_STATUSES = {
  UNUSED: "unused",
  USED: "used",
  DISABLED: "disabled",
  EXPIRED: "expired",
} as const;

export type CardKeyStatus = (typeof CARD_KEY_STATUSES)[keyof typeof CARD_KEY_STATUSES];

/** Redeemable codes are 16 chars in four XXXX groups — readable over the phone, unambiguous. */
const CODE_GROUP_COUNT = 4;
const CODE_GROUP_LENGTH = 4;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I look-alikes
export const CARD_REDEEM_RATE_LIMIT = {
  identifier: "card-key-redeem",
  // Failed-attempt shaped on purpose: `resetOnSuccess` clears the bucket when the code lands, so
  // only brute-force enumeration accumulates toward the cap (sub2api's failure-counter semantics).
  limit: 30,
  windowInSeconds: 10 * 60,
  resetOnSuccess: true,
} as const;

function randomCodeGroup(): string {
  const bytes = new Uint8Array(CODE_GROUP_LENGTH);
  crypto.getRandomValues(bytes);

  let group = "";
  for (const byte of bytes) {
    group += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }

  return group;
}

function formatCode(groups: string[]): string {
  return groups.join("-");
}

export function parseRedeemCode(raw: string): string | null {
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "");

  // Accept both the hyphenated display form and the bare 16-char form.
  const bare = normalized.replaceAll("-", "");

  if (bare.length !== CODE_GROUP_COUNT * CODE_GROUP_LENGTH) {
    return null;
  }

  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/.test(bare)) {
    return null;
  }

  return bare.match(new RegExp(`.{${CODE_GROUP_LENGTH}}`, "g"))?.join("-") ?? null;
}

// ---------------------------------------------------------------------------
// Admin: batch generation, listing, voiding.
// ---------------------------------------------------------------------------

export interface GeneratedCardKey {
  code: string;
  days: number;
}

/** Generate `count` unique codes for a batch. Retries per-slot on the (astronomically unlikely)
 * code collision instead of failing the whole batch. */
export async function createCardKeyBatch({
  name,
  days,
  count,
  createdBy,
  note,
  expiresAt,
}: {
  name: string;
  days: number;
  count: number;
  createdBy: string | null;
  note?: string | null;
  expiresAt?: Date | null;
}): Promise<{ batchId: string; codes: string[] }> {
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new ActionError("BAD_REQUEST", "Batch days must be between 1 and 3650.");
  }

  if (!Number.isInteger(count) || count < 1 || count > CARD_KEY_BATCH_MAX_COUNT) {
    throw new ActionError(
      "BAD_REQUEST",
      `Batch count must be between 1 and ${CARD_KEY_BATCH_MAX_COUNT}.`,
    );
  }

  const db = getDB();

  const [batch] = await db
    .insert(cardKeyBatchTable)
    .values({ name, days, count, createdBy, note: note ?? null })
    .returning({ id: cardKeyBatchTable.id });

  if (!batch) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "The batch could not be created.");
  }

  // Generate then verify: dedupe in memory first (cheap), the DB unique index stays the authority.
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(formatCode([randomCodeGroup(), randomCodeGroup(), randomCodeGroup(), randomCodeGroup()]));
  }

  const now = new Date();

  // Chunked batch inserts: 1000 rows in one batch is fine, but the batch argument must be a
  // non-empty tuple, so the spread anchors on the first statement.
  const values = [...codes].map((code) =>
    db.insert(cardKeyTable).values({
      code,
      batchId: batch.id,
      days,
      status: CARD_KEY_STATUSES.UNUSED,
      expiresAt: expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  await db.batch([values[0]!, ...values.slice(1)]);

  return { batchId: batch.id, codes: [...codes] };
}

export async function voidCardKey({ code }: { code: string }): Promise<void> {
  const db = getDB();
  const normalized = parseRedeemCode(code) ?? code.trim().toUpperCase();

  // Only an unused code can be voided: a used one is a customer's spent purchase, a disabled one
  // is already out. The CAS shape mirrors redeem so a concurrent redeem and void cannot interleave.
  const result = await db
    .update(cardKeyTable)
    .set({ status: CARD_KEY_STATUSES.DISABLED, updatedAt: new Date() })
    .where(and(eq(cardKeyTable.code, normalized), eq(cardKeyTable.status, CARD_KEY_STATUSES.UNUSED)))
    .returning({ id: cardKeyTable.id });

  if (result.length === 0) {
    const existing = await db.query.cardKeyTable.findFirst({
      where: { code: normalized },
      columns: { status: true },
    });

    if (!existing) {
      throw new ActionError("NOT_FOUND", "No card key exists with that code.");
    }

    throw new ActionError(
      "CONFLICT",
      `Only an unused card key can be voided; this one is ${existing.status}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// User: redeem + history.
// ---------------------------------------------------------------------------

export interface RedeemResult {
  daysGranted: number;
  dateExpired: string | null;
}

/**
 * Redeem one card key for the caller. Throws ActionError codes the app maps to copy:
 * CODE_NOT_FOUND / CODE_USED / CODE_EXPIRED / CODE_DISABLED / RATE_LIMITED. The failure limiter
 * counts per account and resets on success, so enumeration does not ride a legitimate customer.
 */
export async function redeemCardKey({
  userId,
  code,
  clientIp,
}: {
  userId: string;
  code: string;
  clientIp: string | null;
}): Promise<RedeemResult> {
  const normalized = parseRedeemCode(code);

  if (!normalized) {
    throw new ActionError("BAD_REQUEST", { key: "Client.Billing.errorCardKeyInvalid" });
  }

  return withRateLimit(
    async (): Promise<RedeemResult> => {
      const db = getDB();
      const now = new Date();

      // Gate #1 — the conditional UPDATE. `changes == 1` wins the code outright.
      const claimed = await db
        .update(cardKeyTable)
        .set({ status: CARD_KEY_STATUSES.USED, usedBy: userId, usedAt: now, updatedAt: now })
        .where(
          and(
            eq(cardKeyTable.code, normalized),
            eq(cardKeyTable.status, CARD_KEY_STATUSES.UNUSED),
            or(isNull(cardKeyTable.expiresAt), gt(cardKeyTable.expiresAt, now)),
          ),
        );

      if ((claimed.meta?.changes ?? 0) === 1) {
        // Read the row we just flipped to learn its days (the UPDATE does not return them).
        const won = await db.query.cardKeyTable.findFirst({
          where: { code: normalized, usedBy: userId },
          columns: { days: true, id: true },
        });

        if (!won) {
          throw new ActionError("INTERNAL_SERVER_ERROR", "The redeemed card key could not be read back.");
        }

        const granted = await grantMembership({
          userId,
          days: won.days,
          source: MEMBERSHIP_GRANT_SOURCES.CARD_KEY,
          refId: won.id,
        });

        return { daysGranted: granted.daysGranted, dateExpired: granted.dateExpired };
      }

      // Lost the race or nothing to claim — read the row to name the exact refusal.
      const row = await db.query.cardKeyTable.findFirst({
        where: { code: normalized },
        columns: { id: true, status: true, expiresAt: true },
      });

      if (!row) {
        throw new ActionError("NOT_FOUND", { key: "Client.Billing.errorCardKeyNotFound" });
      }

      if (row.status === CARD_KEY_STATUSES.USED) {
        throw new ActionError("CONFLICT", { key: "Client.Billing.errorCardKeyUsed" });
      }

      if (row.status === CARD_KEY_STATUSES.DISABLED) {
        throw new ActionError("FORBIDDEN", { key: "Client.Billing.errorCardKeyDisabled" });
      }

      // unused but past its selling deadline — and flip the status while we are here.
      if (row.status === CARD_KEY_STATUSES.UNUSED && row.expiresAt && row.expiresAt <= now) {
        await db
          .update(cardKeyTable)
          .set({ status: CARD_KEY_STATUSES.EXPIRED, updatedAt: now })
          .where(eq(cardKeyTable.id, row.id));

        throw new ActionError("PRECONDITION_FAILED", { key: "Client.Billing.errorCardKeyExpired" });
      }

      throw new ActionError("INTERNAL_SERVER_ERROR", "That card key cannot be redeemed right now.");
    },
    {
      ...CARD_REDEEM_RATE_LIMIT,
      // Hono dispatch has no Next `headers()`; the route hands in the trusted client IP for the
      // anonymous-side bucket, the account key rides `userIdentifier`.
      userIdentifier: clientIp ? `account:${userId},ip:${clientIp}` : `account:${userId}`,
    },
  );
}

/** The caller's own redeem history, newest first. */
export async function listRedeemHistory({
  userId,
  limit = 50,
}: {
  userId: string;
  limit?: number;
}): Promise<
  {
    code: string;
    days: number;
    usedAt: string;
  }[]
> {
  const rows = await getDB()
    .select({
      code: cardKeyTable.code,
      days: cardKeyTable.days,
      usedAt: cardKeyTable.usedAt,
    })
    .from(cardKeyTable)
    .where(and(eq(cardKeyTable.usedBy, userId), eq(cardKeyTable.status, CARD_KEY_STATUSES.USED)))
    .orderBy(sql`${cardKeyTable.usedAt} desc`)
    .limit(limit);

  return rows.map((row) => ({
    code: row.code,
    days: row.days,
    usedAt: (row.usedAt ?? new Date(0)).toISOString(),
  }));
}

/** A random batch name helper is not needed by callers, but the code format check is. */
export function isValidCardKeyCode(code: string): boolean {
  return parseRedeemCode(code) !== null;
}
