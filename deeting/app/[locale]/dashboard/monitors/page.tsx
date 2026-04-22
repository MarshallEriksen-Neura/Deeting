import { setRequestLocale } from "next-intl/server"

import { MonitorsClient } from "./components/monitors-client"

export default async function MonitorsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <MonitorsClient />
}
