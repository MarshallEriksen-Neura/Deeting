import { setRequestLocale } from "next-intl/server"
import { useTranslations } from "next-intl"
import { Layers } from "lucide-react"

import { Container } from "@/components/ui/container"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { ModelsManager } from "@/components/models/models-manager"
import { BackButton } from "@/components/ui/back-button"

interface PageProps {
  params: Promise<{
    locale: string
    instanceId: string
  }>
}

export default async function ModelsPage({ params }: PageProps) {
  const { locale, instanceId } = await params
  setRequestLocale(locale)

  return <ModelsPageContent instanceId={instanceId} />
}

function ModelsPageContent({ instanceId }: { instanceId: string }) {
  const t = useTranslations("models")

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md">
      <div className="mb-4">
        <BackButton />
      </div>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        icon={Layers}
      />
      <ModelsManager instanceId={instanceId} />
    </Container>
  )
}