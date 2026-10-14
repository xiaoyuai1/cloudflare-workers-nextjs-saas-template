"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS } from "@/constants"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { toCsv } from "@/utils/csv"
import {
  createCardKeyBatchAction,
  listCardKeyBatchesAction,
  listCardKeysAction,
  listCardKeysOfBatchAction,
} from "../../_actions/card-key-actions"
import { AdminTableShell } from "../admin-table-shell"
import { useAdminTablePagination } from "../use-admin-table-pagination"
import { GenerateBatchDialog } from "./generate-batch-dialog"
import {
  CARD_KEY_BATCH_UNCLICKABLE_COLUMNS,
  createCardKeyBatchColumns,
} from "./batch-columns"
import {
  CARD_KEY_TABLE_UNCLICKABLE_COLUMNS,
  createCardKeyColumns,
} from "./key-columns"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function CardKeysTabs() {
  const [tab, setTab] = useState<"batches" | "keys">("batches")
  const [batchFilter, setBatchFilter] = useState<string | null>(null)

  // Switch to the key list pre-filtered when a batch asks to be inspected.
  const openBatch = useCallback((batchId: string) => {
    setBatchFilter(batchId)
    setTab("keys")
  }, [])

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as "batches" | "keys")}>
      <TabsList>
        <TabsTrigger value="batches">Batches</TabsTrigger>
        <TabsTrigger value="keys">Card keys</TabsTrigger>
      </TabsList>
      <TabsContent value="batches">
        <BatchesTable onOpenBatch={openBatch} />
      </TabsContent>
      <TabsContent value="keys">
        <KeysTable batchFilter={batchFilter} onClearBatchFilter={() => setBatchFilter(null)} />
      </TabsContent>
    </Tabs>
  )
}

function BatchesTable({ onOpenBatch }: { onOpenBatch: (batchId: string) => void }) {
  const { page, pageSize, pageIndex, onPageChange, onPageSizeChange } = useAdminTablePagination()
  const { copy } = useCopyToClipboard()

  const { execute: fetchEntries, result, status } = useAction(listCardKeyBatchesAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch batches")
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

  const { executeAsync: exportBatch } = useAction(listCardKeysOfBatchAction, {
    onError: ({ error }) => toast.error(error.serverError?.message || "Export failed."),
  })

  const exportToClipboard = useCallback(
    async (batchId: string, batchName: string) => {
      const result = await exportBatch({ batchId })
      const rows = result?.data

      if (!rows) {
        return
      }

      const csv = toCsv({
        header: ["code", "status"],
        rows: rows.map((row) => [row.code, row.status]),
      })

      await copy(csv, {
        successMessage: `Copied ${rows.length} card keys of "${batchName}" as CSV.`,
      })
    },
    [copy, exportBatch],
  )

  const columns = useMemo(
    () => createCardKeyBatchColumns({ onOpenBatch, onExport: exportToClipboard }),
    [onOpenBatch, exportToClipboard],
  )

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">Card key batches</h1>
            <p className="text-sm text-muted-foreground">
              Each generation run: one day-value, one export. Codes are only shown once — export a
              batch right after creating it.
            </p>
          </div>
          <GenerateBatchDialog onCreated={reload} />
        </div>
      }
      isLoading={status === "executing" || status === "idle"}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No batches yet"
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
          itemNameSingular="batch"
          itemNamePlural="batches"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          excludeClickableColumns={CARD_KEY_BATCH_UNCLICKABLE_COLUMNS}
        />
      ) : null}
    </AdminTableShell>
  )
}

function KeysTable({ batchFilter, onClearBatchFilter }: { batchFilter: string | null; onClearBatchFilter: () => void }) {
  const { page, pageSize, pageIndex, onPageChange, onPageSizeChange } = useAdminTablePagination()
  const [search, setSearch] = useState("")

  const { execute: fetchEntries, result, status } = useAction(listCardKeysAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch card keys")
    },
  })
  const data = result.data
  const error = result.serverError

  const reload = useCallback(() => {
    fetchEntries({
      page,
      pageSize,
      batchId: batchFilter ?? undefined,
      search: search.trim() ? search.trim() : undefined,
    })
  }, [fetchEntries, page, pageSize, batchFilter, search])

  useEffect(() => {
    reload()
  }, [reload])

  const columns = useMemo(() => createCardKeyColumns({ onChanged: reload }), [reload])

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">Card keys</h1>
            <p className="text-sm text-muted-foreground">
              {batchFilter
                ? "Filtered to one batch."
                : "Every code across batches. Void only touches unused codes."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search code…"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground"
            />
            {batchFilter ? (
              <button
                type="button"
                onClick={onClearBatchFilter}
                className="text-sm underline text-muted-foreground"
              >
                Clear batch filter
              </button>
            ) : null}
          </div>
        </div>
      }
      isLoading={status === "executing" || status === "idle"}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No card keys match"
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
          itemNameSingular="card key"
          itemNamePlural="card keys"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          excludeClickableColumns={CARD_KEY_TABLE_UNCLICKABLE_COLUMNS}
        />
      ) : null}
    </AdminTableShell>
  )
}
