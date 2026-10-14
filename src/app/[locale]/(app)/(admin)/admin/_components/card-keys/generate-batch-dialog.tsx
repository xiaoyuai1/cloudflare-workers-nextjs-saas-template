"use client"

import { valibotResolver } from "@hookform/resolvers/valibot"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { toCsv } from "@/utils/csv"
import {
  createCardKeyBatchSchema,
  type CreateCardKeyBatchInput,
} from "@/schemas/admin-card-keys.schema"
import { createCardKeyBatchAction } from "../../_actions/card-key-actions"

const EMPTY_FORM: CreateCardKeyBatchInput = {
  name: "",
  days: 30,
  count: 100,
  note: undefined,
  expiresAt: undefined,
}

// Generation copies every new code to the clipboard as CSV the moment it lands — codes are never
// listed anywhere else, so the export is part of the create flow, not a later action.
export function GenerateBatchDialog({ onCreated }: { onCreated: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const form = useForm<CreateCardKeyBatchInput>({
    resolver: valibotResolver(createCardKeyBatchSchema),
    defaultValues: EMPTY_FORM,
  })
  const { copy } = useCopyToClipboard()

  const { execute, isExecuting } = useAction(createCardKeyBatchAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Could not generate the batch.")
    },
    onSuccess: async ({ data }) => {
      if (!data) {
        return
      }

      const csv = toCsv({ header: ["code"], rows: data.codes.map((code) => [code]) })

      await copy(csv, {
        successMessage: `Copied ${data.codes.length} new card keys as CSV — store them now.`,
      })

      setIsOpen(false)
      form.reset(EMPTY_FORM)
      onCreated()
    },
  })

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button />}>Generate batch</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a card-key batch</DialogTitle>
          <DialogDescription>
            One batch = one day value. Up to 1000 codes per run; each code redeems once. All new
            codes are copied to your clipboard as CSV immediately after generation.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => execute(values))} className="space-y-5 pt-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch name</FormLabel>
                  <FormControl>
                    <Input placeholder="2026 双11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Days per code</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        {...field}
                        value={String(field.value ?? "")}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Count (max 1000)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        {...field}
                        value={String(field.value ?? "")}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="expiresAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sell-by date (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>
                    Codes stop redeeming after this day; empty means they never expire.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Campaign or channel" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting ? "Generating..." : "Generate"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
