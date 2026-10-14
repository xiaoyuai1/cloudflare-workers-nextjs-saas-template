import type { Metadata } from "next"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { PageHeader } from "@/components/page-header"
import { ADMIN_ORDERS_PATH } from "@/constants"
import { OrdersTable } from "../_components/orders/orders-table"

export const metadata: Metadata = {
  title: "Orders",
  description: "Membership orders across the deployment",
}

export default function AdminOrdersPage() {
  return (
    <NuqsAdapter>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_ORDERS_PATH, label: "Orders" },
        ]}
      />
      <OrdersTable />
    </NuqsAdapter>
  )
}
