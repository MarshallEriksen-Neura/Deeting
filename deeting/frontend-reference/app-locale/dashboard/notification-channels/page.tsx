import { setRequestLocale } from "next-intl/server"

import { NotificationChannelsClient } from "./components/channels-client"

export default async function NotificationChannelsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <NotificationChannelsClient />
}
