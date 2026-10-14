"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"

import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog"
import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button"
import { Badge } from "@/components/ui/badge"
import type { listCardKeysAction } from "../../_actions/card-key-actions"
import { voidCardKeyAction } from "../../_actions/card-key-actions"
import { RelativeDateCell } from "../relative-date-cell"

export type CardKeyRow =
  NonNullable<InferSafeActionFnResult<typeof listCardKeysAction>["data"]>["entries"][number]

export const CARD_KEY_TABLE_UNCLICKABLE_COLUMNS = ["actions"]

const STATUS_BADGE: Record<CardKeyRow["status"], { label: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
  unused: { label: "Unused", variant: "secondary" },
  used: { label: "Used", variant: "default" },
  disabled: { label: "Voided", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
}

function VoidCell({ entry, onChanged }: { entry: CardKeyRow; onChanged: () => void }) {
  const { executeAsync: voidCode } = useAction(voidCardKeyAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not void the code."),
    onSuccess: () => {
      toast.success("Card key voided.")
      onChanged()
    },
  })

  // Only an unused code can be voided: a used one is a customer's spent purchase.
  if (entry.status !== "unused") {
    return <span className="text-sm text-muted-foreground">—</span>
  }

  return (
    <ConfirmDestructiveDialog
      trigger={<span className="cursor-pointer text-sm font-medium text-destructive underline">Void</span>}
      triggerLabel=""
      title="Void this card key?"
      description={
        <>
          <code>{entry.code}</code> can never be redeemed after this. This cannot be undone.
        </>
      }
      confirmLabel="Void"
      pendingLabel="Voiding..."
      onConfirm={async () => {
        await voidCode({ code: entry.code })
      }}
    />
  )
}

export function createCardKeyColumns({
  onChanged,
}: {
  onChanged: () => void
}): ColumnDef<CardKeyRow>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          <code className="font-mono text-sm">{row.original.code}</code>
          <CopyToClipboardButton value={row.original.code} label="Copy card key code" />
        </span>
      ),
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
      accessorKey: "days",
      header: "Days",
    },
    {
      accessorKey: "batchName",
      header: "Batch",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.batchName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "usedByEmail",
      header: "Redeemed by",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.usedByEmail ?? "—"}</span>
      ),
    },
    {
      accessorKey: "usedAt",
      header: "Redeemed at",
      cell: ({ row }) =>
        row.original.usedAt ? (
          <RelativeDateCell value={row.original.usedAt as Date} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions",
      cell: ({ row }) => <VoidCell entry={row.original} onChanged={onChanged} />,
    },
  ]
}
