import { setRequestLocale, getTranslations } from "next-intl/server"
import { Container } from "@/components/ui/container"
import { MonitoringClient } from "./components/monitoring-client"

export default async function MonitoringPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "monitoring" })

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-[var(--muted)]">{t("description")}</p>
      </div>

      <MonitoringClient />
    </Container>
  )
}
