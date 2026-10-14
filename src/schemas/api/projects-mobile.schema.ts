import { v } from "@/lib/validation";
import { idField } from "@/schemas/fields";
import {
  PROJECT_CATEGORIES,
  PROJECT_MAX_TAGS,
  PROJECT_TAG_MAX_LENGTH,
} from "@/constants";

// Mobile-app project REST (AutoJs6 account module P3), contract table C of
// AutoJs6-noOperit-account/docs/账号模块开发文档.md. Wire format both ends compile against.
// The zip itself travels as multipart/form-data; every other request/response is JSON.
// Statuses mirror the review state machine: reviewing | published | rejected | delisted.

export const PROJECT_STATUS_TUPLE = [
  "reviewing",
  "published",
  "rejected",
  "delisted",
] as const;

export const projectStatusSchema = v.picklist(PROJECT_STATUS_TUPLE);

const packageNameField = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(3, "Package name must be at least 3 characters."),
  v.maxLength(255),
  v.regex(
    /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/,
    "Package name must be reverse-domain segments, e.g. com.example.script.",
  ),
);

const tagsField = v.pipe(
  v.string(),
  v.maxLength(PROJECT_MAX_TAGS * (PROJECT_TAG_MAX_LENGTH + 1), "Too many tags."),
);

/** One market/owned project entry as the app list shows it. */
export const projectSchema = v.object({
  id: v.string(),
  packageName: v.string(),
  name: v.string(),
  summary: v.nullable(v.string()),
  category: v.string(),
  tags: v.nullable(v.string()),
  versionCode: v.number(),
  versionName: v.string(),
  sizeBytes: v.number(),
  status: projectStatusSchema,
  rejectReason: v.nullable(v.string()),
  downloads: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const projectListResponseSchema = v.object({
  projects: v.array(projectSchema),
});

export const projectResponseSchema = v.object({ project: projectSchema });

export const projectCreateSchema = v.object({
  packageName: packageNameField,
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255)),
  summary: v.optional(v.pipe(v.string(), v.maxLength(1000))),
  category: v.picklist(PROJECT_CATEGORIES),
  tags: v.optional(tagsField),
  versionCode: v.pipe(v.number(), v.integer(), v.minValue(1)),
  versionName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
});

export const projectVersionSchema = v.object({
  versionCode: v.pipe(v.number(), v.integer(), v.minValue(1)),
  versionName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
});

export const projectParamSchema = v.object({
  projectId: idField(),
});

export const projectDeleteResponseSchema = v.object({ success: v.boolean() });

/** Public market list; `category` filters, `page`/`pageSize` bound the query. */
export const marketListQuerySchema = v.object({
  category: v.optional(v.picklist(PROJECT_CATEGORIES)),
  search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100))),
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
});

export type ProjectDto = v.InferOutput<typeof projectSchema>;
export type ProjectCreateInput = v.InferOutput<typeof projectCreateSchema>;
export type ProjectVersionInput = v.InferOutput<typeof projectVersionSchema>;
export type ProjectStatus = v.InferOutput<typeof projectStatusSchema>;
