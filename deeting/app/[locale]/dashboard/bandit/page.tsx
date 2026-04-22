import { getTranslations, setRequestLocale } from "next-intl/server"

import { BanditPageClient } from "./page-client"

export default async function BanditPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "bandit" })

  return <BanditPageClient title={t("title")} />
}
