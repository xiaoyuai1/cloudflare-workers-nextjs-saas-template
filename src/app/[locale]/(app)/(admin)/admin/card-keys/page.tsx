import type { Metadata } from "next"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { PageHeader } from "@/components/page-header"
import { ADMIN_CARD_KEYS_PATH } from "@/constants"
import { CardKeysTabs } from "../_components/card-keys/card-keys-tabs"

export const metadata: Metadata = {
  title: "Card keys",
  description: "Membership card-key batches and individual codes for the mobile app",
}

export default function AdminCardKeysPage() {
  return (
    <NuqsAdapter>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_CARD_KEYS_PATH, label: "Card Keys" },
        ]}
      />
      <CardKeysTabs />
    </NuqsAdapter>
  )
}
