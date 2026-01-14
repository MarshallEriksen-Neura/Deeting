import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import {
  DollarSign,
  Activity,
  Zap,
  TrendingUp,
  Clock,
  Server,
  AlertCircle,
  Shield,
} from "lucide-react"

import {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardContent,
} from "@/components/ui/glass-card"
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
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-[var(--muted)]">{t("description")}</p>
      </div>

      {/* Row 1: Core KPI Cards (The Vitals) - 4 Equal Width Cards */}
      <KPIMetricsRow />

      {/* Row 2: Trends & Value - Left Large (2:1) */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {/* Left: Token Throughput Trend */}
        <div className="lg:col-span-2">
          <TokenThroughputChart />
        </div>

        {/* Right: Smart Router Value */}
        <div className="lg:col-span-1">
          <SmartRouterValueCard />
        </div>
      </div>

      {/* Row 3: Live Status - Left/Right Split */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Provider Health */}
        <ProviderHealthStatus />

        {/* Right: Recent Errors */}
        <RecentErrorsList />
      </div>
    </Container>
  )
}
