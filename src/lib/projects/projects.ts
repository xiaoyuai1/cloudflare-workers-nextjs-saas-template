import "server-only";

import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { projectTable, userTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { PROJECT_CATEGORIES, PROJECT_R2_BASE_PATH } from "@/constants";
import type {
  ProjectCreateInput,
  ProjectDto,
  ProjectStatus,
  ProjectVersionInput,
} from "@/schemas/api/projects-mobile.schema";

// Project publishing, versions, and the review state machine (AutoJs6 account module P3).
//
// State machine: reviewing --approve--> published --delist--> delisted
//               reviewing --reject--> rejected --re-upload--> reviewing
//               published --new version--> reviewing
// Every transition is a conditional UPDATE (CAS on the current status): two concurrent
// approvals, or an approval racing an author's re-upload, resolve to exactly one winner,
// the same pattern the billing state machine uses (D1 has no transactions; meta.changes
// picks the winner).
//
// design reference: AutoJsPro user module (dateExpired/publish semantics), own design — no
// third-party source consulted.

export const PROJECT_STATUSES = {
  REVIEWING: "reviewing",
  PUBLISHED: "published",
  REJECTED: "rejected",
  DELISTED: "delisted",
} as const satisfies Record<string, ProjectStatus>;

/** Public list shows only these; rejected/delisted stay visible to the author alone. */
const MARKET_STATUSES: [ProjectStatus, ...ProjectStatus[]] = ["published"];

function r2KeyFor(packageName: string, versionCode: number, userId: string): string {
  // One object per project: the live version's bytes. A new upload overwrites the old zip
  // (same key), so storage grows with projects, not with versions — the author loses instant
  // rollback, which the review flow never promised.
  return `${PROJECT_R2_BASE_PATH}/${userId}/${packageName}_${versionCode}.zip`;
}

function projectToJson(row: {
  id: string;
  packageName: string;
  name: string;
  summary: string | null;
  category: string;
  tags: string | null;
  versionCode: number;
  versionName: string;
  sizeBytes: number;
  status: string;
  rejectReason: string | null;
  downloads: number;
  createdAt: Date;
  updatedAt: Date;
}): ProjectDto {
  return {
    id: row.id,
    packageName: row.packageName,
    name: row.name,
    summary: row.summary,
    category: row.category,
    tags: row.tags,
    versionCode: row.versionCode,
    versionName: row.versionName,
    sizeBytes: row.sizeBytes,
    status: row.status as ProjectStatus,
    rejectReason: row.rejectReason,
    downloads: row.downloads,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const PROJECT_COLUMNS = {
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
  createdAt: projectTable.createdAt,
  updatedAt: projectTable.updatedAt,
} as const;

// ---------------------------------------------------------------------------
// Author side.
// ---------------------------------------------------------------------------

/**
 * Create a project with its first version's zip already in R2 (the route handler uploads
 * before calling this). The UNIQUE index on packageName is the conflict detector; the
 * ownership CAS below is what keeps a stolen-claim race honest: a rejected/delisted row
 * may be re-claimed by its owner, never by anyone else.
 */
export async function createProject({
  input,
  userId,
  sizeBytes,
}: {
  input: ProjectCreateInput;
  userId: string;
  sizeBytes: number;
}): Promise<{ project: ProjectDto }> {
  const db = getDB();

  const existing = await db
    .select({
      id: projectTable.id,
      userId: projectTable.userId,
      packageName: projectTable.packageName,
    })
    .from(projectTable)
    .where(eq(projectTable.packageName, input.packageName))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    if (row.userId !== userId) {
      throw new ActionError(
        "CONFLICT",
        `Package name ${input.packageName} is already taken by another account.`,
      );
    }

    throw new ActionError(
      "CONFLICT",
      "You already published a project with this package name; upload a new version instead.",
    );
  }

  const r2Key = r2KeyFor(input.packageName, input.versionCode, userId);

  const [row] = await db
    .insert(projectTable)
    .values({
      packageName: input.packageName,
      name: input.name,
      summary: input.summary ?? null,
      category: input.category,
      tags: input.tags ?? null,
      versionCode: input.versionCode,
      versionName: input.versionName,
      sizeBytes,
      r2Key,
      userId,
      status: PROJECT_STATUSES.REVIEWING,
      downloads: 0,
    })
    .returning(PROJECT_COLUMNS);

  if (!row) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "Project row vanished after insert.");
  }

  return { project: projectToJson(row) };
}

/**
 * Publish a new version of an owned project: frozen fields overwrite in place and the row
 * flips back to `reviewing` in one CAS (`WHERE status != 'reviewing'`), so a double-submit
 * of the same zip resolves to one transition and an in-flight review is not double-reset.
 */
export async function publishProjectVersion({
  projectId,
  input,
  userId,
  sizeBytes,
}: {
  projectId: string;
  input: ProjectVersionInput;
  userId: string;
  sizeBytes: number;
}): Promise<{ project: ProjectDto }> {
  const db = getDB();

  const existing = await db
    .select({
      id: projectTable.id,
      userId: projectTable.userId,
      packageName: projectTable.packageName,
      versionCode: projectTable.versionCode,
      status: projectTable.status,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  const row = existing[0];

  if (!row) {
    throw new ActionError("NOT_FOUND", "No project exists with that id.");
  }

  if (row.userId !== userId) {
    // Owner check first: a stranger must not learn whether the versionCode guess landed.
    throw new ActionError("FORBIDDEN", "That project belongs to another account.");
  }

  if (input.versionCode <= row.versionCode) {
    throw new ActionError(
      "BAD_REQUEST",
      `versionCode must be greater than the current ${row.versionCode}.`,
    );
  }

  const r2Key = r2KeyFor(row.packageName, input.versionCode, userId);

  const [updated] = await db
    .update(projectTable)
    .set({
      versionCode: input.versionCode,
      versionName: input.versionName,
      sizeBytes,
      r2Key,
      status: PROJECT_STATUSES.REVIEWING,
      rejectReason: null,
    })
    .where(
      and(eq(projectTable.id, projectId), ne(projectTable.status, PROJECT_STATUSES.REVIEWING)),
    )
    .returning(PROJECT_COLUMNS);

  if (!updated) {
    // Concurrent re-upload: the loser's zip is already gone (the route overwrote the object
    // before this CAS), but the winner's row is the truth the author sees.
    throw new ActionError(
      "CONFLICT",
      "A version upload for this project is already being processed; reload and retry.",
    );
  }

  return { project: projectToJson(updated) };
}

/** The author's own projects, every status included, newest first. */
export async function listMyProjects({ userId }: { userId: string }): Promise<ProjectDto[]> {
  const rows = await getDB()
    .select(PROJECT_COLUMNS)
    .from(projectTable)
    .where(eq(projectTable.userId, userId))
    .orderBy(desc(projectTable.updatedAt))
    .limit(200);

  return rows.map(projectToJson);
}

/** Owner-only delete; also returns the R2 key so the route can drop the object after. */
export async function deleteProject({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}): Promise<{ r2Key: string }> {
  const db = getDB();

  const [row] = await db
    .delete(projectTable)
    .where(and(eq(projectTable.id, projectId), eq(projectTable.userId, userId)))
    .returning({ r2Key: projectTable.r2Key });

  if (!row) {
    throw new ActionError("NOT_FOUND", "No project of yours exists with that id.");
  }

  return { r2Key: row.r2Key };
}

/** The R2 key of an owned project's current zip (download-detail/manual checks). */
export async function getOwnedProjectR2Key({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}): Promise<string | null> {
  const [row] = await getDB()
    .select({ r2Key: projectTable.r2Key })
    .from(projectTable)
    .where(and(eq(projectTable.id, projectId), eq(projectTable.userId, userId)))
    .limit(1);

  return row?.r2Key ?? null;
}

// ---------------------------------------------------------------------------
// Market side.
// ---------------------------------------------------------------------------

export async function listMarketProjects({
  category,
  search,
  page = 1,
  pageSize = 20,
}: {
  category?: (typeof PROJECT_CATEGORIES)[number];
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ projects: ProjectDto[]; totalCount: number }> {
  const db = getDB();
  const conditions = [inArray(projectTable.status, MARKET_STATUSES)];

  if (category) {
    conditions.push(eq(projectTable.category, category));
  }

  if (search) {
    const pattern = `%${search.replace(/[%_]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(
      or(
        sql`${projectTable.name} LIKE ${pattern} ESCAPE '\\'`,
        sql`${projectTable.summary} LIKE ${pattern} ESCAPE '\\'`,
      )!,
    );
  }

  const where = and(...conditions);

  const rows = await db
    .select(PROJECT_COLUMNS)
    .from(projectTable)
    .where(where)
    .orderBy(desc(projectTable.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectTable)
    .where(where);

  return {
    projects: rows.map(projectToJson),
    totalCount: Number(count),
  };
}

/**
 * Stream a published project's zip out of R2 and count the download. The count increment is
 * unconditional on the read (a racing double-read may under-count by one; acceptable for a
 * popularity hint, not a ledger).
 */
export async function getMarketDownload({
  projectId,
}: {
  projectId: string;
}): Promise<{ r2Key: string; name: string; versionName: string } | null> {
  const [row] = await getDB()
    .select({
      r2Key: projectTable.r2Key,
      name: projectTable.name,
      versionName: projectTable.versionName,
      status: projectTable.status,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!row || row.status !== PROJECT_STATUSES.PUBLISHED) {
    return null;
  }

  await getDB()
    .update(projectTable)
    .set({ downloads: sql`${projectTable.downloads} + 1` })
    .where(eq(projectTable.id, projectId));

  return { r2Key: row.r2Key, name: row.name, versionName: row.versionName };
}
