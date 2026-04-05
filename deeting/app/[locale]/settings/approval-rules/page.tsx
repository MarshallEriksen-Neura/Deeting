import { setRequestLocale } from "next-intl/server"

import { DesktopRouteMessagesProvider } from "@/components/common/desktop-route-messages-provider"
import { ApprovalRulesClient } from "./page-client"

export default async function ApprovalRulesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <DesktopRouteMessagesProvider
      locale={locale}
      namespaces={["common", "approval-rules"]}
    >
      <ApprovalRulesClient />
    </DesktopRouteMessagesProvider>
  )
}
