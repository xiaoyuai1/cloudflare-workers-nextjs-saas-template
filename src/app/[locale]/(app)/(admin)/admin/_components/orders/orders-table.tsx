"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS } from "@/constants"
import { listAdminOrdersAction } from "../../_actions/order-actions"
import { AdminTableShell } from "../admin-table-shell"
import { useAdminTablePagination } from "../use-admin-table-pagination"
import { ORDER_TABLE_UNCLICKABLE_COLUMNS, createOrderColumns } from "./columns"

const STATUS_OPTIONS = ["PENDING", "PAID", "COMPLETED", "EXPIRED", "CANCELLED", "FAILED"] as const

export function OrdersTable() {
  const { page, pageSize, pageIndex, onPageChange, onPageSizeChange } = useAdminTablePagination()
  const [status, setStatus] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const { execute: fetchEntries, result, status: fetchStatus } = useAction(listAdminOrdersAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch orders")
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

  const columns = useMemo(() => createOrderColumns({ onChanged: reload }), [reload])

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">Orders</h1>
            <p className="text-sm text-muted-foreground">
              Membership purchases. Online-payment channels arrive with P2.5 — card-key redemptions
              complete instantly.
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
              placeholder="Search order no. / email…"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground"
            />
          </div>
        </div>
      }
      isLoading={fetchStatus === "executing" || fetchStatus === "idle"}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No orders match"
      hasData={Boolean(data)}
    >
      {data ? (
        <DataTable
          columns={columns}
          data={data.orders}
          pageCount={data.totalPages}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          totalCount={data.totalCount}
          itemNameSingular="order"
          itemNamePlural="orders"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          excludeClickableColumns={ORDER_TABLE_UNCLICKABLE_COLUMNS}
        />
      ) : null}
    </AdminTableShell>
  )
}
