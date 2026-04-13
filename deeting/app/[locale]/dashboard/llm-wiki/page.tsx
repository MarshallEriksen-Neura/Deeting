import { setRequestLocale } from "next-intl/server"

import { Container } from "@/components/ui/container"

import { LlmWikiClient } from "./components/llm-wiki-client"

export default async function LlmWikiPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <LlmWikiClient />
    </Container>
  )
}
