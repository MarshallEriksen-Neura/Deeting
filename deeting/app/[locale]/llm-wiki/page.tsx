import { BookOpen } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { PageHeader } from "@/components/models/page-header"
import { LlmWikiClient } from "./components/llm-wiki-client"

export default async function LlmWikiPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "llm-wiki" })

  return (
    <main className="h-full min-h-0 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col">
        <PageHeader
          title={t("hero.title")}
          description={t("hero.description")}
          icon={BookOpen}
        />
        <LlmWikiClient />
      </div>
    </main>
  )
}
