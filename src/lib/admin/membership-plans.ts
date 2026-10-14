import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { membershipPlanTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import type { AdminMembershipPlanSchema } from "@/schemas/admin-membership-plans.schema";

// Membership-plan administration (AutoJs6 account module P2): the recharge page's tier list.
// Deliberately *not* self-authenticating, matching the other `src/lib/admin/*` services: the
// panel authorizes with a cookie session (`requireAdmin`), the internal API with a bearer
// credential (`assertAdminPrincipal`). Never mount one of these on an unguarded route.

export interface AdminMembershipPlan {
  id: string;
  name: string;
  days: number;
  priceCents: number;
  sortOrder: number | null;
  /** SQLite stores booleans as 0/1; the panel coerces with a plain truthiness check. */
  enabled: number;
  createdAt: Date;
}

export interface AdminMembershipPlanPage {
  entries: AdminMembershipPlan[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PLAN_COLUMNS = {
  id: true,
  name: true,
  days: true,
  priceCents: true,
  sortOrder: true,
  enabled: true,
  createdAt: true,
} as const;

const PLAN_RETURNING = {
  id: membershipPlanTable.id,
  name: membershipPlanTable.name,
  days: membershipPlanTable.days,
  priceCents: membershipPlanTable.priceCents,
  sortOrder: membershipPlanTable.sortOrder,
  enabled: membershipPlanTable.enabled,
  createdAt: membershipPlanTable.createdAt,
};

export async function listMembershipPlans({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}): Promise<AdminMembershipPlanPage> {
  const db = getDB();

  const [[{ count }], entries] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(membershipPlanTable),
    db.query.membershipPlanTable.findMany({
      columns: PLAN_COLUMNS,
      orderBy: { sortOrder: "asc" },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);

  return {
    entries,
    totalCount: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize),
  };
}

export async function createMembershipPlan(
  input: AdminMembershipPlanSchema,
): Promise<AdminMembershipPlan> {
  const db = getDB();

  const [created] = await db
    .insert(membershipPlanTable)
    .values({
      name: input.name,
      days: input.days,
      priceCents: input.priceCents,
      sortOrder: input.sortOrder ?? null,
      enabled: input.enabled ? 1 : 0,
    })
    .returning(PLAN_RETURNING);

  if (!created) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "The membership plan could not be created.");
  }

  return created;
}

export async function updateMembershipPlan({
  id,
  ...changes
}: AdminMembershipPlanSchema & { id: string }): Promise<AdminMembershipPlan> {
  const db = getDB();

  const updated = await db
    .update(membershipPlanTable)
    .set({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.days !== undefined ? { days: changes.days } : {}),
      ...(changes.priceCents !== undefined ? { priceCents: changes.priceCents } : {}),
      ...(changes.sortOrder !== undefined ? { sortOrder: changes.sortOrder } : {}),
      ...(changes.enabled !== undefined ? { enabled: changes.enabled ? 1 : 0 } : {}),
      updatedAt: new Date(),
    })
    .where(eq(membershipPlanTable.id, id))
    .returning(PLAN_RETURNING);

  if (updated.length === 0) {
    throw new ActionError("NOT_FOUND", "No membership plan exists with that id.");
  }

  return updated[0];
}

export async function toggleMembershipPlan({
  id,
  enabled,
}: {
  id: string;
  enabled: boolean;
}): Promise<void> {
  const db = getDB();

  const updated = await db
    .update(membershipPlanTable)
    .set({ enabled: enabled ? 1 : 0, updatedAt: new Date() })
    .where(eq(membershipPlanTable.id, id))
    .returning({ id: membershipPlanTable.id });

  if (updated.length === 0) {
    throw new ActionError("NOT_FOUND", "No membership plan exists with that id.");
  }
}

/** Deleting a plan never touches memberships already granted — they are day counts on the
 * user's personal team, not references back to the row. Open orders freeze their own snapshot. */
export async function deleteMembershipPlan({ id }: { id: string }): Promise<void> {
  const db = getDB();

  const deleted = await db
    .delete(membershipPlanTable)
    .where(eq(membershipPlanTable.id, id))
    .returning({ id: membershipPlanTable.id });

  if (deleted.length === 0) {
    throw new ActionError("NOT_FOUND", "No membership plan exists with that id.");
  }
}
