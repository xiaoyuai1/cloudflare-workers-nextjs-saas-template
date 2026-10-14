import "server-only";

import { Hono } from "hono";

import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import type { ApiEnv } from "@/api/types";
import { ActionError } from "@/lib/action-error";
import { v } from "@/lib/validation";
import {
  createProject,
  deleteProject,
  listMarketProjects,
  listMyProjects,
  publishProjectVersion,
  getMarketDownload,
} from "@/lib/projects/projects";
import {
  projectCreateSchema,
  projectDeleteResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
  projectVersionSchema,
  marketListQuerySchema,
} from "@/schemas/api/projects-mobile.schema";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { getCurrentSession, requireVerifiedEmail } from "@/utils/auth";
import { PROJECT_MAX_FILE_SIZE, PROJECT_R2_BASE_PATH } from "@/constants";

// Mobile-app project REST (AutoJs6 account module P3), contract table C. Publishing a version is
// a content feature, so it rides the verified-email gate (a no-op while the deployment runs the
// bypass). The zip travels as multipart/form-data field `file` with the metadata as sibling
// string fields; every other request/response is JSON.
//
// Market reads require a Bearer credential (projects:read) rather than edge-anonymous access:
// every market visitor is an App user holding an msession, so nothing here needs the public-path
// edge bypass, and the standard scope guard stays the single gate.

const ZIP_CONTENT_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "application/x-zip",
  "multipart/x-zip",
]);

function r2KeyOf(userId: string, packageName: string, versionCode: number): string {
  return `${PROJECT_R2_BASE_PATH}/${userId}/${packageName}_${versionCode}.zip`;
}

function maxMb(): string {
  return String(Math.floor(PROJECT_MAX_FILE_SIZE / (1024 * 1024)));
}

async function requireR2Bucket() {
  const { env } = await getCloudflareContext();

  if (!env.R2_BUCKET) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "R2 bucket not configured");
  }

  return env.R2_BUCKET;
}

async function requireSession(): Promise<{ userId: string; email: string | null }> {
  const session = await getCurrentSession();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  return { userId: session.user.id, email: session.user.email };
}

interface UploadParts {
  zip: { bytes: ArrayBuffer; size: number; filename: string };
  fields: Record<string, string>;
}

/** Pull the zip part and sibling string fields out of a multipart body, size-checked first. */
async function requireUploadParts(request: Request): Promise<UploadParts> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    throw new ActionError(
      "BAD_REQUEST",
      "Send the project zip as multipart/form-data with a `file` part.",
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (contentLength > PROJECT_MAX_FILE_SIZE + 1024 * 1024) {
    // Body cap (zip + multipart overhead) refused before reading anything.
    throw new ActionError("PAYLOAD_TOO_LARGE", `The zip must be at most ${maxMb()}MB.`);
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    throw new ActionError("BAD_REQUEST", "Missing `file` part (the project zip).");
  }

  if (file.size > PROJECT_MAX_FILE_SIZE) {
    throw new ActionError("PAYLOAD_TOO_LARGE", `The zip must be at most ${maxMb()}MB.`);
  }

  if (file.size === 0) {
    throw new ActionError("BAD_REQUEST", "The zip is empty.");
  }

  const detectedType = file.type || "application/octet-stream";

  if (!ZIP_CONTENT_TYPES.has(detectedType) && !file.name.toLowerCase().endsWith(".zip")) {
    throw new ActionError("BAD_REQUEST", "The project file must be a .zip archive.");
  }

  const fields: Record<string, string> = {};

  for (const [key, value] of form.entries()) {
    if (key !== "file" && typeof value === "string") {
      fields[key] = value;
    }
  }

  return { zip: { bytes: await file.arrayBuffer(), size: file.size, filename: file.name }, fields };
}

function numericField(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  const value = Number(raw);

  return Number.isNaN(value) ? undefined : value;
}

function firstIssueMessage(issues: { path?: unknown[]; message: string }[]) {
  const first = issues[0];

  const path = first?.path?.map((item) => String(item)).join(".") || "body";

  return first ? `${path}: ${first.message}` : "Invalid input.";
}

const projectJsonResponse = {
  description: "The project.",
  content: { "application/json": { schema: projectResponseSchema } },
} as const;

export const projectsMobileRoutes = new Hono<ApiEnv>()
  .post(
    "/projects",
    ...apiOperation({
      operationId: "mobileCreateProject",
      tags: [API_TAGS.projects],
      summary: "Create a project with its first version",
      description:
        "Publishes a new project: the multipart zip lands in R2 and the row starts in review. " +
        "The package name is unique platform-wide; a name held by anyone answers 409.",
      scope: "projects:write",
      audience: "account",
      responses: { 201: projectJsonResponse },
    }),
    async (c) => {
      const session = await requireVerifiedEmail();
      const { zip, fields } = await requireUploadParts(c.req.raw);

      const parsed = v.safeParse(projectCreateSchema, {
        packageName: fields.packageName,
        name: fields.name,
        summary: fields.summary,
        category: fields.category,
        tags: fields.tags,
        versionCode: numericField(fields.versionCode),
        versionName: fields.versionName,
      });

      if (!parsed.success) {
        throw new ActionError("BAD_REQUEST", firstIssueMessage([...parsed.issues]));
      }

      const input = parsed.output;
      const key = r2KeyOf(session.userId, input.packageName, input.versionCode);
      const bucket = await requireR2Bucket();

      // R2 first, row second (the cms-media order): a failed insert leaves only an unreferenced
      // object — the orphan sweep never lists the projects prefix — while a failed upload with
      // the row already in would strand a project nobody can download.
      await bucket.put(key, zip.bytes, {
        httpMetadata: { contentType: "application/zip" },
        customMetadata: {
          originalFilename: zip.filename,
          packageName: input.packageName,
          versionCode: String(input.versionCode),
          uploadedBy: session.userId,
        },
      });

      let project;

      try {
        ({ project } = await createProject({
          input,
          userId: session.userId,
          sizeBytes: zip.size,
        }));
      } catch (error) {
        // The row lost (name taken or invalid): drop the zip we just put, then rethrow.
        await bucket.delete(key);
        throw error;
      }

      return c.json({ project }, 201);
    },
  )
  .post(
    "/projects/:projectId/versions",
    ...apiOperation({
      operationId: "mobilePublishProjectVersion",
      tags: [API_TAGS.projects],
      summary: "Publish a new version",
      description:
        "Overwrites the frozen version fields and flips the project back into review in one " +
        "CAS; versionCode must be greater than the current one.",
      scope: "projects:write",
      audience: "account",
      responses: { 200: projectJsonResponse },
    }),
    async (c) => {
      const session = await requireVerifiedEmail();
      const projectId = c.req.param("projectId");
      const { zip, fields } = await requireUploadParts(c.req.raw);

      const parsed = v.safeParse(projectVersionSchema, {
        versionCode: numericField(fields.versionCode),
        versionName: fields.versionName,
      });

      if (!parsed.success) {
        throw new ActionError("BAD_REQUEST", firstIssueMessage([...parsed.issues]));
      }

      // CAS first, upload second: the loser of a concurrent double-submit fails before it
      // overwrites the winner's zip with its own bytes.
      const { project } = await publishProjectVersion({
        projectId,
        input: parsed.output,
        userId: session.userId,
        sizeBytes: zip.size,
      });

      const bucket = await requireR2Bucket();

      await bucket.put(r2KeyOf(session.userId, project.packageName, project.versionCode), zip.bytes, {
        httpMetadata: { contentType: "application/zip" },
        customMetadata: {
          originalFilename: zip.filename,
          packageName: project.packageName,
          versionCode: String(project.versionCode),
          uploadedBy: session.userId,
        },
      });

      return c.json({ project });
    },
  )
  .get(
    "/projects/mine",
    ...apiOperation({
      operationId: "mobileListMyProjects",
      tags: [API_TAGS.projects],
      summary: "List the caller's projects",
      description:
        "Every own project in every review state, newest first — the My projects screen's list.",
      scope: "projects:read",
      audience: "account",
      responses: {
        200: {
          description: "The projects.",
          content: { "application/json": { schema: projectListResponseSchema } },
        },
      },
    }),
    async (c) => {
      const { userId } = await requireSession();

      return c.json({ projects: await listMyProjects({ userId }) });
    },
  )
  .delete(
    "/projects/:projectId",
    ...apiOperation({
      operationId: "mobileDeleteProject",
      tags: [API_TAGS.projects],
      summary: "Delete an own project",
      description: "Owner-only. Drops the row and its R2 zip; the market listing goes with it.",
      scope: "projects:write",
      audience: "account",
      responses: {
        200: {
          description: "Deleted.",
          content: { "application/json": { schema: projectDeleteResponseSchema } },
        },
      },
    }),
    async (c) => {
      const session = await requireVerifiedEmail();
      const projectId = c.req.param("projectId");

      const { r2Key } = await deleteProject({ projectId, userId: session.userId });
      const bucket = await requireR2Bucket();

      await bucket.delete(r2Key);

      return c.json({ success: true });
    },
  )
  .get(
    "/market/projects",
    ...apiOperation({
      operationId: "mobileListMarketProjects",
      tags: [API_TAGS.projects],
      summary: "Browse the project market",
      description:
        "Published projects only, newest first; optional category filter and name/summary search.",
      scope: "projects:read",
      audience: "account",
      responses: {
        200: {
          description: "The published projects page.",
          content: { "application/json": { schema: projectListResponseSchema } },
        },
      },
    }),
    async (c) => {
      await requireSession();

      const parsed = v.safeParse(marketListQuerySchema, {
        category: c.req.query("category") || undefined,
        search: c.req.query("search") || undefined,
        page: numericField(c.req.query("page")),
        pageSize: numericField(c.req.query("pageSize")),
      });

      if (!parsed.success) {
        throw new ActionError("BAD_REQUEST", firstIssueMessage([...parsed.issues]));
      }

      const { projects, totalCount } = await listMarketProjects(parsed.output);

      return c.json({ projects, totalCount });
    },
  )
  .get(
    "/market/projects/:projectId/download",
    ...apiOperation({
      operationId: "mobileDownloadMarketProject",
      tags: [API_TAGS.projects],
      summary: "Download a published project zip",
      description:
        "Streams the current zip out of R2 and counts the download. Only `published` projects " +
        "answer; anything else is 404 so a rejected/delisted package is never downloadable.",
      scope: "projects:read",
      audience: "account",
      responses: {
        200: {
          description: "The zip stream.",
          content: { "application/zip": { schema: projectResponseSchema } },
        },
      },
    }),
    async (c) => {
      await requireSession();
      const projectId = c.req.param("projectId");

      const download = await getMarketDownload({ projectId });

      if (!download) {
        throw new ActionError("NOT_FOUND", "That project is not available for download.");
      }

      const bucket = await requireR2Bucket();
      const object = await bucket.get(download.r2Key);

      if (!object) {
        throw new ActionError("NOT_FOUND", "The project archive is missing; contact the author.");
      }

      return new Response(object.body, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${download.name}_v${download.versionName}.zip"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
