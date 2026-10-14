"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS } from "@/constants"
import { listAdminProjectsAction } from "../../_actions/project-actions"
import { AdminTableShell } from "../admin-table-shell"
import { useAdminTablePagination } from "../use-admin-table-pagination"
import { createProjectColumns, PROJECT_TABLE_UNCLICKABLE_COLUMNS } from "./columns"

const STATUS_OPTIONS = ["reviewing", "published", "rejected", "delisted"] as const

export function ProjectsReviewTable() {
  const { page, pageSize, pageIndex, onPageChange, onPageSizeChange } = useAdminTablePagination()
  const [status, setStatus] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const { execute: fetchEntries, result, status: fetchStatus } = useAction(listAdminProjectsAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch projects")
    },
  })
  const data = result.data
  const error = result.serverError

  const reload = useCallback(() => {
    fetchEntries({
      page,
      pageSize,
      status: (status as (typeof STATUS_OPTIONS)[number]) ?? undefined,
      search: search.trim() ? search.trim() : undefined,
    })
  }, [fetchEntries, page, pageSize, status, search])

  useEffect(() => {
    reload()
  }, [reload])

  const columns = useMemo(() => createProjectColumns({ onChanged: reload }), [reload])

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">Projects</h1>
            <p className="text-sm text-muted-foreground">
              User-published script packages. Approving puts the current version on the market; a
              rejection mails its reason to the author.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={status ?? ""}
              onChange={(event) => setStatus(event.target.value || null)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name / package / author…"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground"
            />
          </div>
        </div>
      }
      isLoading={fetchStatus === "executing" || fetchStatus === "idle"}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No projects match"
      hasData={Boolean(data)}
    >
      {data ? (
        <DataTable
          columns={columns}
          data={data.projects}
          pageCount={data.totalPages}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          totalCount={data.totalCount}
          itemNameSingular="project"
          itemNamePlural="projects"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          excludeClickableColumns={PROJECT_TABLE_UNCLICKABLE_COLUMNS}
        />
      ) : null}
    </AdminTableShell>
  )
}
