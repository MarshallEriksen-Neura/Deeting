import { setRequestLocale } from "next-intl/server"
import { PageContent } from "./page-content"

export default async function ProviderPresetsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <PageContent />
}
