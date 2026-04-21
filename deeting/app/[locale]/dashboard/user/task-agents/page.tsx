import { redirect } from "next/navigation"

export default async function LegacyTaskAgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/agents/task-agents`)
}
