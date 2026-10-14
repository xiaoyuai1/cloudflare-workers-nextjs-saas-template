import { CARD_KEY_BATCH_MAX_COUNT } from "@/constants";
import { v } from "@/lib/validation";
import { adminTablePaginationFields, idField } from "@/schemas/fields";

// The single declaration of card-key admin input (AutoJs6 account module P2). Count caps at the
// service's batch limit so the form and the D1 writer agree; the code format itself is validated
// by the service (same alphabet the generator emits).

export const cardKeyBatchBaseFields = {
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "required"), v.maxLength(255)),
  days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650)),
  count: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(CARD_KEY_BATCH_MAX_COUNT)),
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500))),
  // `type="date"` submits YYYY-MM-DD; an empty string means "no deadline". Kept a string here —
  // the form input and the schema stay the same type; the action converts to a Date.
  expiresAt: v.optional(
    v.pipe(
      v.string(),
      v.regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
    ),
  ),
};

export const createCardKeyBatchSchema = v.object(cardKeyBatchBaseFields);

export const listCardKeyBatchesSchema = v.object({
  ...adminTablePaginationFields,
});

export const listCardKeysSchema = v.object({
  ...adminTablePaginationFields,
  status: v.optional(v.picklist(["unused", "used", "disabled", "expired"])),
  batchId: v.optional(v.pipe(v.string(), v.maxLength(64))),
  search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(64))),
});

export const voidCardKeySchema = v.object({
  code: v.pipe(v.string(), v.trim(), v.minLength(4), v.maxLength(64)),
});

export const batchCardKeysParamSchema = v.object({
  batchId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
});

export type CreateCardKeyBatchInput = {
  name: string;
  days: number;
  count: number;
  note?: string | undefined;
  /** `YYYY-MM-DD` or undefined; the service layer converts to the sell-by Date. */
  expiresAt?: string | undefined;
};
