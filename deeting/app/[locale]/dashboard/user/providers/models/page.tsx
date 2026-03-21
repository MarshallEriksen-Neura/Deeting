import { setRequestLocale } from "next-intl/server"

import { DesktopModelsPageClient } from "./desktop-models-page-client"

export default async function DesktopModelsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <DesktopModelsPageClient />
}
