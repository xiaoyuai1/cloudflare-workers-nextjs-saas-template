"use client"

import { valibotResolver } from "@hookform/resolvers/valibot"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  createMembershipPlanSchema,
  type AdminMembershipPlanFormInput,
  type AdminMembershipPlanFormValues,
} from "@/schemas/admin-membership-plans.schema"
import { createMembershipPlanAction } from "../../_actions/membership-plan-actions"

const EMPTY_FORM: AdminMembershipPlanFormValues = {
  name: "",
  days: 30,
  priceCents: 0,
  sortOrder: undefined,
  enabled: true,
}

type EditorProps =
  | { mode: "create"; onSaved: () => void; plan?: never }
  | { mode: "edit"; plan: { id: string; name: string; days: number; priceCents: number; sortOrder: number | null; enabled: number }; onSaved: () => void }

// One dialog for both create and edit; the schema the form validates is the very one the server
// action parses (createMembershipPlanFields ⊂ updateMembershipPlanSchema).
export function MembershipPlanDialog(props: EditorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const form = useForm<AdminMembershipPlanFormInput, unknown, AdminMembershipPlanFormValues>({
    resolver: valibotResolver(createMembershipPlanSchema),
    defaultValues:
      props.mode === "edit"
        ? {
            name: props.plan.name,
            days: props.plan.days,
            priceCents: props.plan.priceCents,
            sortOrder: props.plan.sortOrder ?? undefined,
            enabled: props.plan.enabled === 1,
          }
        : EMPTY_FORM,
  })

  const { execute, isExecuting } = useAction(createMembershipPlanAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Could not save the plan.")
    },
    onSuccess: () => {
      toast.success("Membership plan saved.")
      setIsOpen(false)
      form.reset(EMPTY_FORM)
      props.onSaved()
    },
  })

  function submit(values: AdminMembershipPlanFormValues) {
    execute(values)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button size={props.mode === "edit" ? "sm" : "default"} variant={props.mode === "edit" ? "outline" : "default"} />}>
        {props.mode === "edit" ? "Edit" : "Add plan"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.mode === "edit" ? "Edit membership plan" : "Add a membership plan"}</DialogTitle>
          <DialogDescription>
            The tiers the mobile recharge page shows. Price is entered in cents (100 = ¥1.00);
            changing a price never moves an order already placed.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-5 pt-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Monthly" {...field} />
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
                    <FormLabel>Days</FormLabel>
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
                name="priceCents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (cents)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
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
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sort order (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      {...field}
                      value={field.value === undefined ? "" : String(field.value)}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value === "" ? undefined : event.target.valueAsNumber,
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">Enabled (shown on the recharge page)</FormLabel>
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
