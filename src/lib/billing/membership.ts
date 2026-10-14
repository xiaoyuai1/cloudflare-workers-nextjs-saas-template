import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { membershipGrantTable, teamMembershipTable, teamTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { SYSTEM_ROLES_ENUM } from "@/constants/team-roles";
import { createRandomId } from "@/utils/random-token";

// Membership granting for the AutoJs6 account module. The expiry lives on the user's personal
// team (`team.planExpiresAt`), every grant is journaled in `membership_grant`, and the journal's
// UNIQUE(source, refId) pair is the audit-row claim that makes replays idempotent: a repeated
// callback or a concurrent redeem claims the row first (or finds it claimed) and grants exactly once.
//
// design reference: sub2api (Wei-Shaw/sub2api, LGPL-3.0) docs/PAYMENT.md — AssignOrExtendSubscription.

export const MEMBERSHIP_GRANT_SOURCES = {
  ORDER: "order",
  CARD_KEY: "card_key",
  ADMIN: "admin",
} as const;

export type MembershipGrantSource =
  (typeof MEMBERSHIP_GRANT_SOURCES)[keyof typeof MEMBERSHIP_GRANT_SOURCES];

/** The personal team whose `planExpiresAt` is the user's membership expiry. Null is
 * legacy-tolerant (an account without exactly one owned team has no membership slot). */
async function findOwnedTeamId(userId: string): Promise<string | null> {
  const rows = await getDB()
    .select({ teamId: teamTable.id })
    .from(teamTable)
    .innerJoin(teamMembershipTable, eq(teamMembershipTable.teamId, teamTable.id))
    .where(
      and(eq(teamMembershipTable.userId, userId), eq(teamMembershipTable.isActive, 1)),
    )
    .limit(50);

  return rows.length === 1 ? rows[0].teamId : null;
}

/**
 * Guarantee the caller has exactly one personal team to hold `planExpiresAt`. Accounts created
 * before any grant (or through flows that never made a team) get one on first grant; the
 * find-then-insert is idempotent because the (team, user) membership unique index absorbs a
 * concurrent double-create — the loser's team stays an unused shell nobody reads.
 */
async function ensurePersonalTeamId(userId: string, now: Date): Promise<string> {
  const existing = await findOwnedTeamId(userId);

  if (existing) {
    return existing;
  }

  const db = getDB();
  const teamId = `team_${createRandomId()}`;
  const nowSec = Math.floor(now.getTime() / 1000);

  await db.batch([
    db.insert(teamTable).values({
      id: teamId,
      name: "个人团队",
      slug: `personal-${createRandomId().toLowerCase().replaceAll("_", "-").slice(0, 20)}`,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(teamMembershipTable).values({
      id: `tmem_${createRandomId()}`,
      teamId,
      userId,
      roleId: SYSTEM_ROLES_ENUM.OWNER,
      isSystemRole: 1,
      invitedBy: userId,
      joinedAt: now,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  return teamId;
}

function dayEnd(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);

  return end;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface GrantMembershipResult {
  /** How many days this call added (0 when the journal already held the grant). */
  daysGranted: number;
  /** The membership expiry after this call; AutoJsPro semantics `dateExpired`. */
  dateExpired: string | null;
}

/**
 * Extend the user's membership by `days`, exactly once per (source, refId). Idempotent: a
 * repeated call with the same pair answers the already-granted state instead of extending again.
 * D1 has no transactions, so the journal insert is the serialization point — a replay loses the
 * UNIQUE race or reads the row back, and either way the expiry is written at most once.
 */
export async function grantMembership({
  userId,
  days,
  source,
  refId,
  now = new Date(),
}: {
  userId: string;
  days: number;
  source: MembershipGrantSource;
  refId: string;
  now?: Date;
}): Promise<GrantMembershipResult> {
  if (!Number.isInteger(days) || days <= 0) {
    throw new ActionError("BAD_REQUEST", "Membership days must be a positive integer.");
  }

  const db = getDB();
  // First grant for a team-less account creates the personal team here, so the card key the
  // user just claimed always lands somewhere. The journal claim below stays the idempotence gate.
  const teamId = await ensurePersonalTeamId(userId, now);

  // Claim the audit row first. A UNIQUE conflict means this (source, refId) already granted —
  // answer its recorded state rather than extending twice.
  const claimed = await db
    .insert(membershipGrantTable)
    .values({ userId, days, source, refId })
    .onConflictDoNothing()
    .returning({ id: membershipGrantTable.id });

  const [existing] = await db
    .select({ planExpiresAt: teamTable.planExpiresAt })
    .from(teamTable)
    .where(eq(teamTable.id, teamId))
    .limit(1);

  if (claimed.length === 0) {
    // Replay: the journal already holds the grant. Report the current expiry without touching it.
    const current = existing?.planExpiresAt ?? null;

    return {
      daysGranted: 0,
      dateExpired: current && current > now ? current.toISOString() : null,
    };
  }

  // Unexpired membership extends from its own expiry (顺延); a null or past expiry starts today.
  const currentExpiry = existing?.planExpiresAt ?? null;
  const stillActive = currentExpiry !== null && currentExpiry > now;
  const base = stillActive ? currentExpiry : dayEnd(now);
  const newExpiry = addDays(base, days);

  await db
    .update(teamTable)
    .set({ planExpiresAt: newExpiry, updatedAt: now })
    .where(eq(teamTable.id, teamId));

  return {
    daysGranted: days,
    dateExpired: newExpiry.toISOString(),
  };
}

/**
 * Enumerate a user's grants, newest first. The redeem history endpoint and the admin order detail
 * both read through this, so the journal has one projection.
 */
export async function listMembershipGrants({
  userId,
  limit = 50,
  cursor,
}: {
  userId: string;
  limit?: number;
  cursor?: number;
}): Promise<{
  grants: {
    id: string;
    days: number;
    source: string;
    refId: string;
    createdAt: string;
  }[];
  nextCursor: number | null;
}> {
  const rows = await getDB()
    .select({
      id: membershipGrantTable.id,
      days: membershipGrantTable.days,
      source: membershipGrantTable.source,
      refId: membershipGrantTable.refId,
      createdAt: membershipGrantTable.createdAt,
    })
    .from(membershipGrantTable)
    .where(
      cursor
        ? and(
            eq(membershipGrantTable.userId, userId),
            sql`${membershipGrantTable.createdAt} < ${new Date(cursor)}`,
          )
        : eq(membershipGrantTable.userId, userId),
    )
    .orderBy(sql`${membershipGrantTable.createdAt} desc`)
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  return {
    grants: page.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].createdAt.getTime() : null,
  };
}

/** Whether the user holds an active membership right now (expiry in the future). */
export async function hasActiveMembership({
  userId,
  now = new Date(),
}: {
  userId: string;
  now?: Date;
}): Promise<boolean> {
  const teamId = await findOwnedTeamId(userId);

  if (!teamId) {
    return false;
  }

  const [row] = await getDB()
    .select({ planExpiresAt: teamTable.planExpiresAt })
    .from(teamTable)
    .where(and(eq(teamTable.id, teamId), gt(teamTable.planExpiresAt, now)))
    .limit(1);

  return Boolean(row);
}
