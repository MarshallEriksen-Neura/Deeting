import { setRequestLocale } from "next-intl/server"
import { NextIntlClientProvider } from "next-intl"

import { loadStaticLocaleMessages } from "@/i18n/static-messages"
import { ApprovalRulesClient } from "./page-client"

export default async function ApprovalRulesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const messages = await loadStaticLocaleMessages(locale, {
    namespaces: ["common", "approval-rules"],
  })

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ApprovalRulesClient />
    </NextIntlClientProvider>
  )
}
