"use client"

import { useCallback, useEffect, useMemo } from "react"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS } from "@/constants"
import { listMembershipPlansAction } from "../../_actions/membership-plan-actions"
import { AdminTableShell } from "../admin-table-shell"
import { useAdminTablePagination } from "../use-admin-table-pagination"
import { MembershipPlanDialog } from "./membership-plan-dialog"
import {
  MEMBERSHIP_PLAN_TABLE_UNCLICKABLE_COLUMNS,
  createMembershipPlanColumns,
} from "./columns"

export function MembershipPlansTable() {
  const { page, pageSize, pageIndex, onPageChange, onPageSizeChange } = useAdminTablePagination()

  const { execute: fetchEntries, result, status } = useAction(listMembershipPlansAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch membership plans")
    },
  })
  const data = result.data
  const error = result.serverError

  const reload = useCallback(() => {
    fetchEntries({ page, pageSize })
  }, [fetchEntries, page, pageSize])

  useEffect(() => {
    reload()
  }, [reload])

  const columns = useMemo(() => createMembershipPlanColumns({ onChanged: reload }), [reload])

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">Membership plans</h1>
            <p className="text-sm text-muted-foreground">
              The tiers the mobile app&apos;s recharge page shows, cheapest-first by sort order.
            </p>
          </div>
          <MembershipPlanDialog mode="create" onSaved={reload} />
        </div>
      }
      isLoading={status === "executing" || status === "idle"}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No membership plans"
      hasData={Boolean(data)}
    >
      {data ? (
        <DataTable
          columns={columns}
          data={data.entries}
          pageCount={data.totalPages}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          totalCount={data.totalCount}
          itemNameSingular="plan"
          itemNamePlural="plans"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          excludeClickableColumns={MEMBERSHIP_PLAN_TABLE_UNCLICKABLE_COLUMNS}
        />
      ) : null}
    </AdminTableShell>
  )
}
