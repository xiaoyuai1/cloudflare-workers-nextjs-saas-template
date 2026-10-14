"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { listMembershipPlansAction } from "../../_actions/membership-plan-actions"
import { MembershipPlanDialog } from "./membership-plan-dialog"
import { RelativeDateCell } from "../relative-date-cell"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"
import { toggleMembershipPlanAction, deleteMembershipPlanAction } from "../../_actions/membership-plan-actions"

// Derive the row model from the action's return DTO so the table stays in sync.
export type MembershipPlanRow =
  NonNullable<InferSafeActionFnResult<typeof listMembershipPlansAction>["data"]>["entries"][number]

export const MEMBERSHIP_PLAN_TABLE_UNCLICKABLE_COLUMNS = ["actions"]

function formatPrice(priceCents: number): string {
  return `¥${(priceCents / 100).toFixed(2)}`
}

function PlanActionsCell({ plan, onChanged }: { plan: MembershipPlanRow; onChanged: () => void }) {
  const { execute: toggle } = useAction(toggleMembershipPlanAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not update the plan."),
    onSuccess: () => {
      toast.success("Membership plan updated.")
      onChanged()
    },
  })
  const { executeAsync: remove } = useAction(deleteMembershipPlanAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not delete the plan."),
    onSuccess: () => {
      toast.success("Membership plan deleted.")
      onChanged()
    },
  })

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={plan.enabled === 1}
        onCheckedChange={(checked) => toggle({ id: plan.id, enabled: checked === true })}
        aria-label="Toggle plan"
      />
      <MembershipPlanDialog
        mode="edit"
        plan={plan}
        onSaved={onChanged}
      />
      <ConfirmDestructiveDialog
        trigger={<Button size="sm" variant="destructive" />}
        triggerLabel="Delete"
        title="Delete this membership plan?"
        description={
          <>
            <code>{plan.name}</code> disappears from the recharge page. Memberships already granted
            are unaffected — they are day counts on each account, not references to this row.
          </>
        }
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        onConfirm={async () => {
          await remove({ id: plan.id })
        }}
      />
    </div>
  )
}

export function createMembershipPlanColumns({
  onChanged,
}: {
  onChanged: () => void
}): ColumnDef<MembershipPlanRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "days",
      header: "Days",
    },
    {
      accessorKey: "priceCents",
      header: "Price",
      cell: ({ row }) => <span className="font-mono">{formatPrice(row.original.priceCents)}</span>,
    },
    {
      accessorKey: "sortOrder",
      header: "Sort",
      cell: ({ row }) => row.original.sortOrder ?? "—",
    },
    {
      accessorKey: "enabled",
      header: "Enabled",
      cell: ({ row }) =>
        row.original.enabled === 1 ? (
          <Badge variant="secondary">Enabled</Badge>
        ) : (
          <Badge variant="outline">Disabled</Badge>
        ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <RelativeDateCell value={row.getValue("createdAt") as Date} />,
    },
    {
      id: "actions",
      cell: ({ row }) => <PlanActionsCell plan={row.original} onChanged={onChanged} />,
    },
  ]
}
