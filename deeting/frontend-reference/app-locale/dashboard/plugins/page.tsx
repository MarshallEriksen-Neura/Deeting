import { setRequestLocale } from "next-intl/server"

import { Container } from "@/ui/common/container"
import { PluginsClient } from "./components/plugins-client"

export default async function PluginsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <PluginsPageContent />
}

function PluginsPageContent() {
  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <PluginsClient mode="installed" />
    </Container>
  )
}
