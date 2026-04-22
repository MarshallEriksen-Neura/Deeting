import { setRequestLocale } from "next-intl/server"

import { ApprovalRulesClient } from "./components/approval-rules-client"

export default async function DashboardApprovalRulesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <ApprovalRulesClient />
}
