import { setRequestLocale } from "next-intl/server"
import { useTranslations } from "next-intl"
import { Key } from "lucide-react"

import { Container } from "@/components/ui/container"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { ApiKeysManager } from "@/components/api-keys/api-keys-manager"
import { MintKeyButton } from "@/components/api-keys/mint-key-button"

export default async function ApiKeysPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // We need to fetch translations on the server side to pass strings if we wanted,
  // but for now, we rely on Client Components using useTranslations for dynamic content.
  // However, for the header, we can use a small Client Component wrapper or just standard server-side translation.
  
  return <ApiKeysPageContent />
}

function ApiKeysPageContent() {
  // Using useTranslations here works because this component will be rendered as part of the page tree,
  // but wait, standard practice for Server Components is to use `getTranslations`.
  // Let's refactor this to be proper Server Component style.
  const t = useTranslations("apiKeys")

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        icon={Key}
        actions={<MintKeyButton />}
      />
      <ApiKeysManager />
    </Container>
  )
}