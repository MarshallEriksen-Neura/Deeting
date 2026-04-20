import { setRequestLocale } from "next-intl/server"

import { ModelPoolsPageClient } from "./page-client"

export default async function ModelPoolsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <ModelPoolsPageClient />
}
