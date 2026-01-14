import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { Container } from "@/components/ui/container"

import { KPIMetricsRow } from "./components/kpi-metrics-row"
import { TokenThroughputChart } from "./components/token-throughput-chart"
import { SmartRouterValueCard } from "./components/smart-router-value-card"
import { ProviderHealthStatus } from "./components/provider-health-status"
import { RecentErrorsList } from "./components/recent-errors-list"

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <DashboardContent />
}

function DashboardContent() {
  const t = useTranslations("dashboard")

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-[var(--muted)]">{t("description")}</p>
      </div>

      <KPIMetricsRow />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TokenThroughputChart />
        </div>

        <div className="lg:col-span-1">
          <SmartRouterValueCard />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ProviderHealthStatus />
        <RecentErrorsList />
      </div>
    </Container>
  )
}
