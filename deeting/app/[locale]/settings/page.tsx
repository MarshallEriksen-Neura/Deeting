import { setRequestLocale } from "next-intl/server"

import { SettingsPageClient } from "./components/settings-page-client"

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <SettingsPageClient />
}
