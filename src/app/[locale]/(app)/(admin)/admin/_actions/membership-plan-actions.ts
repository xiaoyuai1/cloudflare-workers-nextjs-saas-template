"use server"

import {
  createMembershipPlan,
  deleteMembershipPlan,
  listMembershipPlans,
  toggleMembershipPlan,
  updateMembershipPlan,
} from "@/lib/admin/membership-plans"
import { actionClient } from "@/lib/safe-action"
import {
  createMembershipPlanSchema,
  deleteMembershipPlanSchema,
  listMembershipPlansSchema,
  toggleMembershipPlanSchema,
  updateMembershipPlanSchema,
} from "@/schemas/admin-membership-plans.schema"
import { requireAdmin } from "@/utils/auth"

export const listMembershipPlansAction = actionClient
  .metadata({ actionName: "listMembershipPlansAction" })
  .inputSchema(listMembershipPlansSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listMembershipPlans(input)
  })

export const createMembershipPlanAction = actionClient
  .metadata({ actionName: "createMembershipPlanAction" })
  .inputSchema(createMembershipPlanSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return createMembershipPlan(input)
  })

export const updateMembershipPlanAction = actionClient
  .metadata({ actionName: "updateMembershipPlanAction" })
  .inputSchema(updateMembershipPlanSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return updateMembershipPlan(input)
  })

export const toggleMembershipPlanAction = actionClient
  .metadata({ actionName: "toggleMembershipPlanAction" })
  .inputSchema(toggleMembershipPlanSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return toggleMembershipPlan(input)
  })

export const deleteMembershipPlanAction = actionClient
  .metadata({ actionName: "deleteMembershipPlanAction" })
  .inputSchema(deleteMembershipPlanSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return deleteMembershipPlan(input)
  })
