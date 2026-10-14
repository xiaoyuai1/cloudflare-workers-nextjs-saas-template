import type { Metadata } from "next"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { PageHeader } from "@/components/page-header"
import { ADMIN_MEMBERSHIP_PLANS_PATH } from "@/constants"
import { MembershipPlansTable } from "../_components/membership-plans/membership-plans-table"

export const metadata: Metadata = {
  title: "Membership plans",
  description: "Purchasable membership tiers shown on the mobile app's recharge page",
}

export default function AdminMembershipPlansPage() {
  return (
    <NuqsAdapter>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_MEMBERSHIP_PLANS_PATH, label: "Membership Plans" },
        ]}
      />
      <MembershipPlansTable />
    </NuqsAdapter>
  )
}
