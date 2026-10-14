import type { Metadata } from "next"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { PageHeader } from "@/components/page-header"
import { ADMIN_PROJECTS_PATH } from "@/constants"
import { ProjectsReviewTable } from "../_components/projects/projects-review-table"

export const metadata: Metadata = {
  title: "Projects",
  description: "User-published script packages awaiting review, live, rejected, or delisted",
}

export default function AdminProjectsPage() {
  return (
    <NuqsAdapter>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_PROJECTS_PATH, label: "Projects" },
        ]}
      />
      <ProjectsReviewTable />
    </NuqsAdapter>
  )
}
