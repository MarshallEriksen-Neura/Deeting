import { redirect } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import { routing } from "@/i18n/routing"

export default async function ApprovalRulesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const basePath =
    locale === routing.defaultLocale ? "/dashboard" : `/${locale}/dashboard`
  redirect(`${basePath}/approval-rules`)
}
