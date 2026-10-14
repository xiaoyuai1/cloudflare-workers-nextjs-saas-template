"use server"

import {
  approveProject,
  delistProject,
  listAdminProjects,
  rejectProject,
  republishProject,
} from "@/lib/projects/review"
import { actionClient } from "@/lib/safe-action"
import {
  approveProjectSchema,
  delistProjectSchema,
  listAdminProjectsSchema,
  rejectProjectSchema,
  republishProjectSchema,
} from "@/schemas/admin-projects.schema"
import { requireAdmin } from "@/utils/auth"

export const listAdminProjectsAction = actionClient
  .metadata({ actionName: "listAdminProjectsAction" })
  .inputSchema(listAdminProjectsSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listAdminProjects(input)
  })

export const approveProjectAction = actionClient
  .metadata({ actionName: "approveProjectAction" })
  .inputSchema(approveProjectSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return approveProject(input)
  })

export const rejectProjectAction = actionClient
  .metadata({ actionName: "rejectProjectAction" })
  .inputSchema(rejectProjectSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return rejectProject(input)
  })

export const delistProjectAction = actionClient
  .metadata({ actionName: "delistProjectAction" })
  .inputSchema(delistProjectSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return delistProject(input)
  })

export const republishProjectAction = actionClient
  .metadata({ actionName: "republishProjectAction" })
  .inputSchema(republishProjectSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return republishProject(input)
  })
