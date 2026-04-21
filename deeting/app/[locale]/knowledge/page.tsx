import { setRequestLocale, getTranslations } from "next-intl/server"
import { Database } from "lucide-react"

import { PageHeader } from "@/components/models/page-header"
import { KnowledgeClient } from "./components/knowledge-client"

export default async function KnowledgeBasePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "knowledge" })

  return (
    <div className="h-full min-h-0 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col">
        <PageHeader title={t("title")} description={t("subtitle")} icon={Database} />
        <KnowledgeClient />
      </div>
    </div>
  )
}
