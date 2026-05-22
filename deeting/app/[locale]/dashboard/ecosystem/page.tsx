import { setRequestLocale } from "next-intl/server"

import { EcosystemSignalClient } from "./components/ecosystem-signal-client"

export default async function EcosystemDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <EcosystemSignalClient />
}
