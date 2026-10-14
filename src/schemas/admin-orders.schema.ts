import { v } from "@/lib/validation";
import { adminTablePaginationFields, idField } from "@/schemas/fields";

// Admin order-listing input (AutoJs6 account module P2). Filters are optional; the cancel
// action lives in the orders service shared with the REST surface.

export const listAdminOrdersSchema = v.object({
  ...adminTablePaginationFields,
  status: v.optional(
    v.picklist(["PENDING", "PAID", "COMPLETED", "EXPIRED", "CANCELLED", "FAILED"]),
  ),
  channel: v.optional(v.picklist(["card_key"])),
  search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(255))),
});

export const cancelAdminOrderSchema = v.object({
  orderId: idField(),
});
