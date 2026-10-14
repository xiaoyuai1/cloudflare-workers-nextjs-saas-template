import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { projectTable, userTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { sendProjectRejectedNoticeEmail } from "@/utils/email";
import type { ProjectStatus } from "@/schemas/api/projects-mobile.schema";
import { PROJECT_STATUSES } from "@/lib/projects/projects";

// Staff-side review state machine (AutoJs6 account module P3). Same CAS discipline as the
// billing machine: every transition is a conditional UPDATE, `meta.changes` (via the returning
// row) decides the winner, and the author notice rides on the transition that flipped the row.

export interface AdminProjectRow {
  id: string;
  packageName: string;
  name: string;
  summary: string | null;
  category: string;
  tags: string | null;
  versionCode: number;
  versionName: string;
  sizeBytes: number;
  status: ProjectStatus;
  rejectReason: string | null;
  downloads: number;
  r2Key: string;
  userId: string;
  userEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ADMIN_COLUMNS = {
  id: projectTable.id,
  packageName: projectTable.packageName,
  name: projectTable.name,
  summary: projectTable.summary,
  category: projectTable.category,
  tags: projectTable.tags,
  versionCode: projectTable.versionCode,
  versionName: projectTable.versionName,
  sizeBytes: projectTable.sizeBytes,
  status: projectTable.status,
  rejectReason: projectTable.rejectReason,
  downloads: projectTable.downloads,
  r2Key: projectTable.r2Key,
  userId: projectTable.userId,
  userEmail: userTable.email,
  createdAt: projectTable.createdAt,
  updatedAt: projectTable.updatedAt,
} as const;

export async function listAdminProjects({
  status,
  search,
  page,
  pageSize,
}: {
  status?: ProjectStatus;
  search?: string;
  page: number;
  pageSize: number;
}): Promise<{ projects: AdminProjectRow[]; totalCount: number }> {
  const db = getDB();
  const conditions = [];

  if (status) {
    conditions.push(eq(projectTable.status, status));
  }

  if (search) {
    const pattern = `%${search.replace(/[%_]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(
      sql`(${projectTable.name} LIKE ${pattern} ESCAPE '\\' OR ${projectTable.packageName} LIKE ${pattern} ESCAPE '\\' OR ${userTable.email} LIKE ${pattern} ESCAPE '\\')`,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select(ADMIN_COLUMNS)
    .from(projectTable)
    .innerJoin(userTable, eq(userTable.id, projectTable.userId))
    .where(where)
    .orderBy(desc(projectTable.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectTable)
    .innerJoin(userTable, eq(userTable.id, projectTable.userId))
    .where(where);

  return {
    projects: rows.map((row) => ({ ...row, status: row.status as ProjectStatus })),
    totalCount: Number(count),
  };
}

/** Approve a reviewing project: `reviewing -> published`, one CAS. */
export async function approveProject({
  projectId,
}: {
  projectId: string;
}): Promise<AdminProjectRow> {
  const [row] = await getDB()
    .update(projectTable)
    .set({ status: PROJECT_STATUSES.PUBLISHED, rejectReason: null })
    .where(and(eq(projectTable.id, projectId), eq(projectTable.status, PROJECT_STATUSES.REVIEWING)))
    .returning(ADMIN_COLUMNS);

  if (!row) {
    throw await projectTransitionRefusal(projectId, "approve");
  }

  return { ...row, status: row.status as ProjectStatus };
}

/** Reject a reviewing project with a mailed reason: `reviewing -> rejected`, one CAS. */
export async function rejectProject({
  projectId,
  reason,
  sendEmail,
}: {
  projectId: string;
  reason: string;
  sendEmail: boolean;
}): Promise<AdminProjectRow> {
  const [row] = await getDB()
    .update(projectTable)
    .set({ status: PROJECT_STATUSES.REJECTED, rejectReason: reason })
    .where(and(eq(projectTable.id, projectId), eq(projectTable.status, PROJECT_STATUSES.REVIEWING)))
    .returning(ADMIN_COLUMNS);

  if (!row) {
    throw await projectTransitionRefusal(projectId, "reject");
  }

  if (sendEmail && row.userEmail) {
    // A failed notice must not roll the review back (D1 has no transactions and the CAS already
    // landed), so the send is best-effort like the ban notice.
    try {
      await sendProjectRejectedNoticeEmail({
        email: row.userEmail,
        projectName: row.name,
        packageName: row.packageName,
        versionName: row.versionName,
        reason,
      });
    } catch (error) {
      console.error("rejectProject: rejection notice email failed", error);
    }
  }

  return { ...row, status: row.status as ProjectStatus };
}

/** Take a published project off the market: `published -> delisted`, one CAS. */
export async function delistProject({
  projectId,
  reason,
}: {
  projectId: string;
  reason?: string | null;
}): Promise<AdminProjectRow> {
  const [row] = await getDB()
    .update(projectTable)
    .set({
      status: PROJECT_STATUSES.DELISTED,
      ...(reason ? { rejectReason: reason } : {}),
    })
    .where(and(eq(projectTable.id, projectId), eq(projectTable.status, PROJECT_STATUSES.PUBLISHED)))
    .returning(ADMIN_COLUMNS);

  if (!row) {
    throw await projectTransitionRefusal(projectId, "delist");
  }

  return { ...row, status: row.status as ProjectStatus };
}

/** Put a delisted project back on the market: `delisted -> published`, one CAS. */
export async function republishProject({ projectId }: { projectId: string }): Promise<AdminProjectRow> {
  const [row] = await getDB()
    .update(projectTable)
    .set({ status: PROJECT_STATUSES.PUBLISHED })
    .where(and(eq(projectTable.id, projectId), eq(projectTable.status, PROJECT_STATUSES.DELISTED)))
    .returning(ADMIN_COLUMNS);

  if (!row) {
    throw await projectTransitionRefusal(projectId, "republish");
  }

  return { ...row, status: row.status as ProjectStatus };
}

async function projectTransitionRefusal(
  projectId: string,
  action: string,
): Promise<ActionError> {
  const [current] = await getDB()
    .select({ status: projectTable.status })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!current) {
    return new ActionError("NOT_FOUND", "No project exists with that id.");
  }

  return new ActionError(
    "CONFLICT",
    `Cannot ${action} a project in status "${current.status}" (expected "reviewing" or "published"). ` +
      "Reload the list; someone else may have actioned it first.",
  );
}
