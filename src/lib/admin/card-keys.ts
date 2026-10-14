import "server-only";

import { CARD_KEY_BATCH_MAX_COUNT } from "@/constants";
import { and, eq, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { cardKeyBatchTable, cardKeyTable, userTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { createCardKeyBatch, voidCardKey } from "@/lib/billing/card-keys";

// Card-key administration (AutoJs6 account module P2): batch generation, listing with status /
// batch filters, and voiding. Not self-authenticating — same contract as every `src/lib/admin/*`
// service (panel: `requireAdmin`; internal API: `assertAdminPrincipal`).

export interface AdminCardKeyBatch {
  id: string;
  name: string;
  days: number;
  count: number;
  createdBy: string | null;
  note: string | null;
  createdAt: Date;
}

export interface AdminCardKey {
  id: string;
  code: string;
  batchId: string;
  batchName: string | null;
  days: number;
  status: string;
  usedBy: string | null;
  usedByEmail: string | null;
  usedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface AdminCardKeyPage {
  entries: AdminCardKey[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const BATCH_RETURNING = {
  id: cardKeyBatchTable.id,
  name: cardKeyBatchTable.name,
  days: cardKeyBatchTable.days,
  count: cardKeyBatchTable.count,
  createdBy: cardKeyBatchTable.createdBy,
  note: cardKeyBatchTable.note,
  createdAt: cardKeyBatchTable.createdAt,
};

export async function listCardKeyBatches({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}): Promise<{ entries: AdminCardKeyBatch[]; totalCount: number; totalPages: number }> {
  const db = getDB();

  const [[{ count }], entries] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(cardKeyBatchTable),
    db.query.cardKeyBatchTable.findMany({
      columns: {
        id: true,
        name: true,
        days: true,
        count: true,
        createdBy: true,
        note: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);

  return { entries, totalCount: count, totalPages: Math.ceil(count / pageSize) };
}

/** Redeemed count per batch, for the batch list's "已用" column. */
export async function countRedeemedByBatch(batchIds: string[]): Promise<Map<string, number>> {
  if (batchIds.length === 0) {
    return new Map();
  }

  const rows = await getDB()
    .select({
      batchId: cardKeyTable.batchId,
      redeemed: sql<number>`count(*)`,
    })
    .from(cardKeyTable)
    .where(and(eq(cardKeyTable.status, "used"), sql`${cardKeyTable.batchId} IN ${batchIds}`))
    .groupBy(cardKeyTable.batchId);

  return new Map(rows.map((row) => [row.batchId, row.redeemed]));
}

export async function adminCreateCardKeyBatch({
  name,
  days,
  count,
  note,
  expiresAt,
  createdBy,
}: {
  name: string;
  days: number;
  count: number;
  note?: string | null;
  /** `YYYY-MM-DD` (the date input's wire form) or null for no deadline. */
  expiresAt?: string | null;
  createdBy: string | null;
}): Promise<{ batchId: string; codes: string[] }> {
  const result = await createCardKeyBatch({
    name,
    days,
    count,
    note: note ?? null,
    expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.999Z`) : null,
    createdBy,
  });

  return result;
}

export async function listCardKeys({
  page,
  pageSize,
  status,
  batchId,
  search,
}: {
  page: number;
  pageSize: number;
  status?: string;
  batchId?: string;
  search?: string;
}): Promise<AdminCardKeyPage> {
  const db = getDB();

  const codeNeedle = search ? `%${search.trim().toUpperCase()}%` : null;
  const hasFilters = Boolean(status || batchId || codeNeedle);

  const [[{ count }], rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(cardKeyTable)
      .where(
        hasFilters
          ? and(
              status ? eq(cardKeyTable.status, status) : undefined,
              batchId ? eq(cardKeyTable.batchId, batchId) : undefined,
              codeNeedle ? sql`${cardKeyTable.code} LIKE ${codeNeedle}` : undefined,
            )
          : undefined,
      ),
    db
      .select({
        id: cardKeyTable.id,
        code: cardKeyTable.code,
        batchId: cardKeyTable.batchId,
        batchName: cardKeyBatchTable.name,
        days: cardKeyTable.days,
        status: cardKeyTable.status,
        usedBy: cardKeyTable.usedBy,
        usedByEmail: userTable.email,
        usedAt: cardKeyTable.usedAt,
        expiresAt: cardKeyTable.expiresAt,
        createdAt: cardKeyTable.createdAt,
      })
      .from(cardKeyTable)
      .leftJoin(cardKeyBatchTable, eq(cardKeyBatchTable.id, cardKeyTable.batchId))
      .leftJoin(userTable, eq(userTable.id, cardKeyTable.usedBy))
      .where(
        hasFilters
          ? and(
              status ? eq(cardKeyTable.status, status) : undefined,
              batchId ? eq(cardKeyTable.batchId, batchId) : undefined,
              codeNeedle ? sql`${cardKeyTable.code} LIKE ${codeNeedle}` : undefined,
            )
          : undefined,
      )
      .orderBy(sql`${cardKeyTable.createdAt} desc`)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  return {
    entries: rows,
    totalCount: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize),
  };
}

/** All codes of one batch, oldest first — the CSV export payload. */
export async function listCardKeysOfBatch(batchId: string): Promise<{ code: string; status: string }[]> {
  const rows = await getDB()
    .select({ code: cardKeyTable.code, status: cardKeyTable.status })
    .from(cardKeyTable)
    .where(eq(cardKeyTable.batchId, batchId))
    .orderBy(sql`${cardKeyTable.createdAt} asc`)
    .limit(20_000);

  return rows;
}

export async function adminVoidCardKey({ code }: { code: string }): Promise<void> {
  await voidCardKey({ code });
}


