import { setRequestLocale } from "next-intl/server"

import { DesktopRouteMessagesProvider } from "@/components/common/desktop-route-messages-provider"

import { AssistantsPageClient } from "./assistants-page-client"

export default async function AssistantsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <DesktopRouteMessagesProvider
      locale={locale}
      namespaces={["common", "assistants"]}
    >
      <AssistantsPageClient />
    </DesktopRouteMessagesProvider>
  )
}
