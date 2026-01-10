import { setRequestLocale } from "next-intl/server"

import { ApiKeysPageClient } from "./client"

export default async function ApiKeysPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <ApiKeysPageClient />
}
