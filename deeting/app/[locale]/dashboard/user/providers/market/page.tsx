import { setRequestLocale } from "next-intl/server"
import { useTranslations } from "next-intl"
import { Globe } from "lucide-react"

import { Container } from "@/components/ui/container"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { ProviderMarketManager } from "@/components/providers/market/provider-market-manager"

export default async function ProviderMarketPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <ProviderMarketPageContent />
}

function ProviderMarketPageContent() {
  const t = useTranslations("providers.market")

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md">
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={Globe}
      />
      <ProviderMarketManager />
    </Container>
  )
}
