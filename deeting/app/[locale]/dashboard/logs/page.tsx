import { setRequestLocale } from "next-intl/server"

import { LogsClient } from "./components/logs-client"

export default async function LogsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <LogsClient />
}
