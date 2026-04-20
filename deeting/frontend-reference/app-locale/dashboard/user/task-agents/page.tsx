import { Suspense } from "react"
import { setRequestLocale } from "next-intl/server"

import { Container } from "@/ui/common/container"

import { TaskAgentsClient } from "./components/task-agents-client"

export default async function TaskAgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md" size="full">
      <Suspense>
        <TaskAgentsClient />
      </Suspense>
    </Container>
  )
}
