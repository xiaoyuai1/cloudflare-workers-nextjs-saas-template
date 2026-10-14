"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"

import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cancelAdminOrderAction, listAdminOrdersAction } from "../../_actions/order-actions"
import { RelativeDateCell } from "../relative-date-cell"
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog"

export type AdminOrderRow =
  NonNullable<InferSafeActionFnResult<typeof listAdminOrdersAction>["data"]>["orders"][number]

export const ORDER_TABLE_UNCLICKABLE_COLUMNS = ["actions"]

const STATUS_BADGE: Record<
  AdminOrderRow["status"],
  { label: string; variant: "secondary" | "default" | "destructive" | "outline" }
> = {
  PENDING: { label: "Pending", variant: "outline" },
  PAID: { label: "Paid", variant: "default" },
  COMPLETED: { label: "Completed", variant: "secondary" },
  EXPIRED: { label: "Expired", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
  FAILED: { label: "Failed", variant: "destructive" },
}

const CHANNEL_LABEL: Record<string, string> = {
  card_key: "Card key",
}

function formatPrice(priceCents: number): string {
  return `¥${(priceCents / 100).toFixed(2)}`
}

function OrderActionsCell({ order, onChanged }: { order: AdminOrderRow; onChanged: () => void }) {
  const { executeAsync: cancel } = useAction(cancelAdminOrderAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not cancel."),
    onSuccess: () => {
      toast.success("Order cancelled.")
      onChanged()
    },
  })

  if (order.status !== "PENDING") {
    return <span className="text-sm text-muted-foreground">—</span>
  }

  return (
    <ConfirmDestructiveDialog
      trigger={<Button size="sm" variant="destructive" />}
      triggerLabel="Cancel"
      title="Cancel this order?"
      description={
        <>
          Order <code>{order.outOrderNo}</code> will no longer be payable. The customer&apos;s app
          shows it as cancelled.
        </>
      }
      confirmLabel="Cancel order"
      pendingLabel="Cancelling..."
      onConfirm={async () => {
        await cancel({ orderId: order.id })
      }}
    />
  )
}

export function createOrderColumns({
  onChanged,
}: {
  onChanged: () => void
}): ColumnDef<AdminOrderRow>[] {
  return [
    {
      accessorKey: "outOrderNo",
      header: "Order no.",
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          <code className="font-mono text-xs">{row.original.outOrderNo}</code>
          <CopyToClipboardButton value={row.original.outOrderNo} label="Copy order number" />
        </span>
      ),
    },
    {
      accessorKey: "userEmail",
      header: "User",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.userEmail ?? row.original.userId}</span>
      ),
    },
    {
      accessorKey: "channel",
      header: "Channel",
      cell: ({ row }) => (
        <Badge variant="secondary">{CHANNEL_LABEL[row.original.channel] ?? row.original.channel}</Badge>
      ),
    },
    {
      accessorKey: "productDays",
      header: "Days",
    },
    {
      accessorKey: "amountCents",
      header: "Amount",
      cell: ({ row }) => <span className="font-mono">{formatPrice(row.original.amountCents)}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const badge = STATUS_BADGE[row.original.status]

        return <Badge variant={badge.variant}>{badge.label}</Badge>
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <RelativeDateCell value={row.getValue("createdAt") as Date} />,
    },
    {
      id: "actions",
      cell: ({ row }) => <OrderActionsCell order={row.original} onChanged={onChanged} />,
    },
  ]
}
