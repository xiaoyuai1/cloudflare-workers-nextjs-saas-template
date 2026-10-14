"use client"

import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"

import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog"
import {
  approveProjectAction,
  delistProjectAction,
  rejectProjectAction,
  republishProjectAction,
  listAdminProjectsAction,
} from "../../_actions/project-actions"
import { RelativeDateCell } from "../relative-date-cell"

export type AdminProjectRow =
  NonNullable<InferSafeActionFnResult<typeof listAdminProjectsAction>["data"]>["projects"][number]

export const PROJECT_TABLE_UNCLICKABLE_COLUMNS = ["actions"]

const STATUS_BADGE: Record<
  AdminProjectRow["status"],
  { label: string; variant: "secondary" | "default" | "destructive" | "outline" }
> = {
  reviewing: { label: "Reviewing", variant: "outline" },
  published: { label: "Published", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  delisted: { label: "Delisted", variant: "secondary" },
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}

function ProjectActionsCell({
  project,
  onChanged,
}: {
  project: AdminProjectRow
  onChanged: () => void
}) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [sendEmail, setSendEmail] = useState(true)

  const { executeAsync: approve } = useAction(approveProjectAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not approve."),
    onSuccess: () => {
      toast.success("Project approved — it is live on the market.")
      onChanged()
    },
  })
  const { executeAsync: reject } = useAction(rejectProjectAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not reject."),
    onSuccess: () => {
      toast.success("Project rejected; the author has been notified.")
      setRejectOpen(false)
      setReason("")
      onChanged()
    },
  })
  const { executeAsync: delist } = useAction(delistProjectAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not delist."),
    onSuccess: () => {
      toast.success("Project delisted from the market.")
      onChanged()
    },
  })
  const { executeAsync: republish } = useAction(republishProjectAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Could not republish."),
    onSuccess: () => {
      toast.success("Project republished.")
      onChanged()
    },
  })

  return (
    <div className="flex items-center gap-1">
      {project.status === "reviewing" ? (
        <>
          <Button
            size="sm"
            variant="default"
            onClick={async () => {
              await approve({ projectId: project.id })
            }}
          >
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}>
            Reject…
          </Button>
        </>
      ) : null}
      {project.status === "published" ? (
        <ConfirmDestructiveDialog
          trigger={<Button size="sm" variant="destructive" />}
          triggerLabel="Delist"
          title="Delist this project?"
          description={
            <>
              <code>{project.packageName}</code> will disappear from the market immediately. The
              author can bring it back by uploading a new version.
            </>
          }
          confirmLabel="Delist project"
          pendingLabel="Delisting..."
          onConfirm={async () => {
            await delist({ projectId: project.id })
          }}
        />
      ) : null}
      {project.status === "delisted" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await republish({ projectId: project.id })
          }}
        >
          Republish
        </Button>
      ) : null}
      {project.status === "rejected" ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : null}
      {rejectOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h2 className="text-lg font-semibold">Reject “{project.name}”?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The project returns to the author with your reason. The reason is stored on the
              project and, if you keep the checkbox ticked, mailed to the author.
            </p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason shown to the author (required)"
              rows={4}
              className="mt-3 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(event) => setSendEmail(event.target.checked)}
              />
              Email the reason to the author
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRejectOpen(false)
                  setReason("")
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={reason.trim().length === 0 || reject.status === "executing"}
                onClick={async () => {
                  await reject({
                    projectId: project.id,
                    reason: reason.trim(),
                    sendEmail,
                  })
                }}
              >
                {reject.status === "executing" ? "Rejecting..." : "Reject project"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function createProjectColumns({
  onChanged,
}: {
  onChanged: () => void
}): ColumnDef<AdminProjectRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Project",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">{row.original.name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.packageName}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "userEmail",
      header: "Author",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.userEmail ?? row.original.userId}</span>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => <Badge variant="secondary">{row.original.category}</Badge>,
    },
    {
      accessorKey: "versionName",
      header: "Version",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.versionName}
          <span className="text-muted-foreground"> ({row.original.versionCode})</span>
        </span>
      ),
    },
    {
      accessorKey: "sizeBytes",
      header: "Size",
      cell: ({ row }) => (
        <span className="font-mono text-sm">{formatSize(row.original.sizeBytes)}</span>
      ),
    },
    {
      accessorKey: "downloads",
      header: "Downloads",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const badge = STATUS_BADGE[row.original.status]

        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {row.original.rejectReason ? (
              <span className="max-w-48 truncate text-xs text-muted-foreground" title={row.original.rejectReason}>
                {row.original.rejectReason}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: ({ row }) => <RelativeDateCell value={row.getValue("updatedAt") as Date} />,
    },
    {
      id: "actions",
      cell: ({ row }) => <ProjectActionsCell project={row.original} onChanged={onChanged} />,
    },
  ]
}
