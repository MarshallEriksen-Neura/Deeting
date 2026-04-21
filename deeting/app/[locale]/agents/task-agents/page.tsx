import { Suspense } from "react"
import { setRequestLocale } from "next-intl/server"

import { TaskAgentsClient } from "@/app/[locale]/dashboard/user/task-agents/components/task-agents-client"

export default async function TaskAgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <Suspense>
      <TaskAgentsClient />
    </Suspense>
  )
}
