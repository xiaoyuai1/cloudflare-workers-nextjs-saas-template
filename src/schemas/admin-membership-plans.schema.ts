import { v } from "@/lib/validation";
import { adminTablePaginationFields, idField } from "@/schemas/fields";

// The single declaration of what a membership plan is (AutoJs6 account module P2). The add/edit
// dialog, the server actions, and the toggle all parse these fields, so the accepted shape exists
// once. Price is integer CENTS — the wire format everywhere in billing.

export const membershipPlanBaseFields = {
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "required"), v.maxLength(255)),
  days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650)),
  priceCents: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000_000)),
  sortOrder: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000))),
  enabled: v.optional(v.boolean(), true),
};

export const createMembershipPlanSchema = v.object(membershipPlanBaseFields);

export const updateMembershipPlanSchema = v.object({
  ...membershipPlanBaseFields,
  id: idField(),
});

export const toggleMembershipPlanSchema = v.object({
  id: idField(),
  enabled: v.boolean(),
});

export const deleteMembershipPlanSchema = v.object({
  id: idField(),
});

export const listMembershipPlansSchema = v.object({
  ...adminTablePaginationFields,
});

export type AdminMembershipPlanSchema = {
  name: string;
  days: number;
  priceCents: number;
  sortOrder?: number | undefined;
  enabled?: boolean | undefined;
};

/** The dialog's form input shape: `enabled` optional before the default applies. */
export type AdminMembershipPlanFormInput = {
  name: string;
  days: number;
  priceCents: number;
  sortOrder?: number | undefined;
  enabled?: boolean | undefined;
};

/** The dialog's form shape: create fields with every input present. */
export type AdminMembershipPlanFormValues = {
  name: string;
  days: number;
  priceCents: number;
  sortOrder?: number | undefined;
  enabled: boolean;
};
