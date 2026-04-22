import { setRequestLocale } from "next-intl/server"

import { TaskLearningClient } from "./components/task-learning-client"

export default async function TaskLearningPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <TaskLearningClient />
}
