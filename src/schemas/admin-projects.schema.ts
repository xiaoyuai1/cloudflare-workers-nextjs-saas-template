import { v } from "@/lib/validation";
import { adminTablePaginationFields, idField } from "@/schemas/fields";
import { PROJECT_CATEGORIES } from "@/constants";
import { PROJECT_STATUS_TUPLE } from "@/schemas/api/projects-mobile.schema";

// Admin project-review input (AutoJs6 account module P3). Filters are optional; the approve /
// reject / delist / republish actions live in the review service shared with the REST surface.

export const listAdminProjectsSchema = v.object({
  ...adminTablePaginationFields,
  status: v.optional(v.picklist(PROJECT_STATUS_TUPLE)),
  category: v.optional(v.picklist(PROJECT_CATEGORIES)),
  search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(255))),
});

export const approveProjectSchema = v.object({
  projectId: idField(),
});

export const rejectProjectSchema = v.object({
  projectId: idField(),
  // The staff-written reason: stored on the row and mailed to the author.
  reason: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(1000)),
  sendEmail: v.boolean(),
});

export const delistProjectSchema = v.object({
  projectId: idField(),
  reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000))),
});

export const republishProjectSchema = v.object({
  projectId: idField(),
});
