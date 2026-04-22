import { setRequestLocale } from "next-intl/server"

import { LlmWikiClient } from "./components/llm-wiki-client"

export default async function LlmWikiPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="h-full min-h-0 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <div className="mx-auto w-full max-w-[1480px]">
        <LlmWikiClient />
      </div>
    </main>
  )
}
