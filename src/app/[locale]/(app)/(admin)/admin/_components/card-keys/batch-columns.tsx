"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { listCardKeyBatchesAction } from "../../_actions/card-key-actions"
import { RelativeDateCell } from "../relative-date-cell"

export type CardKeyBatchRow =
  NonNullable<InferSafeActionFnResult<typeof listCardKeyBatchesAction>["data"]>["entries"][number]

export const CARD_KEY_BATCH_UNCLICKABLE_COLUMNS = ["actions"]

export function createCardKeyBatchColumns({
  onOpenBatch,
  onExport,
}: {
  onOpenBatch: (batchId: string) => void
  onExport: (batchId: string, batchName: string) => Promise<void>
}): ColumnDef<CardKeyBatchRow>[] {
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
      accessorKey: "count",
      header: "Codes",
    },
    {
      accessorKey: "note",
      header: "Note",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.note || "—"}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <RelativeDateCell value={row.getValue("createdAt") as Date} />,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpenBatch(row.original.id)}>
            View codes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onExport(row.original.id, row.original.name)}
          >
            Export CSV
          </Button>
        </div>
      ),
    },
  ]
}

export function BatchStatusBadge({ status }: { status: string }) {
  return <Badge variant="secondary">{status}</Badge>
}
