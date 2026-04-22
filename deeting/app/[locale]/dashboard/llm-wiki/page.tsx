import { redirect } from "next/navigation"

export default async function LegacyLlmWikiPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/llm-wiki`)
}
