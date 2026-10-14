"use server"

import { cancelOrderAsAdmin, listOrdersForAdmin } from "@/lib/billing/orders"
import { actionClient } from "@/lib/safe-action"
import { cancelAdminOrderSchema, listAdminOrdersSchema } from "@/schemas/admin-orders.schema"
import { requireAdmin } from "@/utils/auth"

export const listAdminOrdersAction = actionClient
  .metadata({ actionName: "listAdminOrdersAction" })
  .inputSchema(listAdminOrdersSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listOrdersForAdmin(input)
  })

// Admin cancel runs the same PENDING-only CAS without the owner scoping; the status timeline is
// the audit.
export const cancelAdminOrderAction = actionClient
  .metadata({ actionName: "cancelAdminOrderAction" })
  .inputSchema(cancelAdminOrderSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    await cancelOrderAsAdmin({ orderId: input.orderId })

    return { success: true as const }
  })
