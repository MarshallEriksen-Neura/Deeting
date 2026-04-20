import { redirect } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

export default async function AssistantsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  redirect(`/${locale}/dashboard/user/task-agents`)
}
