import { setRequestLocale } from "next-intl/server"
import { useTranslations } from "next-intl"
import { Cpu } from "lucide-react"

import { Container } from "@/components/ui/container"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { ProvidersList } from "@/components/providers/providers-list"
import { ConnectProviderButton } from "@/components/providers/connect-provider-button"

export default async function ProvidersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <ProvidersPageContent />
}

function ProvidersPageContent() {
  const t = useTranslations("providers.manager")

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md" size="full">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        icon={Cpu}
        actions={<ConnectProviderButton />}
      />
      <ProvidersList />
    </Container>
  )
}
