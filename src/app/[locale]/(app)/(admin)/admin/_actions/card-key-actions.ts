"use server"

import {
  adminCreateCardKeyBatch,
  adminVoidCardKey,
  listCardKeyBatches,
  listCardKeys,
  listCardKeysOfBatch,
} from "@/lib/admin/card-keys"
import { actionClient } from "@/lib/safe-action"
import {
  batchCardKeysParamSchema,
  createCardKeyBatchSchema,
  listCardKeyBatchesSchema,
  listCardKeysSchema,
  voidCardKeySchema,
} from "@/schemas/admin-card-keys.schema"
import { requireAdmin } from "@/utils/auth"

export const listCardKeyBatchesAction = actionClient
  .metadata({ actionName: "listCardKeyBatchesAction" })
  .inputSchema(listCardKeyBatchesSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listCardKeyBatches(input)
  })

export const listCardKeysAction = actionClient
  .metadata({ actionName: "listCardKeysAction" })
  .inputSchema(listCardKeysSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listCardKeys(input)
  })

// Generation returns every new code so the panel can copy the CSV to the clipboard (the
// template's export convention — there is no file download).
export const createCardKeyBatchAction = actionClient
  .metadata({ actionName: "createCardKeyBatchAction" })
  .inputSchema(createCardKeyBatchSchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin()

    return adminCreateCardKeyBatch({ ...input, createdBy: session.userId })
  })

export const listCardKeysOfBatchAction = actionClient
  .metadata({ actionName: "listCardKeysOfBatchAction" })
  .inputSchema(batchCardKeysParamSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listCardKeysOfBatch(input.batchId)
  })

export const voidCardKeyAction = actionClient
  .metadata({ actionName: "voidCardKeyAction" })
  .inputSchema(voidCardKeySchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return adminVoidCardKey(input)
  })
