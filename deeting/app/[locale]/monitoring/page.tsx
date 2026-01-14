import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { Container } from "@/components/ui/container"
import { useState } from "react"
import { MonitoringControlBar, type MonitoringFilters } from "./components/monitoring-control-bar"
import { PerformanceDiagnostics } from "./components/performance-diagnostics"
import { DimensionalBreakdown } from "./components/dimensional-breakdown"

export default async function MonitoringPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <MonitoringContent />
}

function MonitoringContent() {
  const t = useTranslations("monitoring")
  const [filters, setFilters] = useState<MonitoringFilters>({
    timeRange: "24h",
    model: undefined,
    apiKey: undefined,
    errorCode: undefined,
  })

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-[var(--muted)]">{t("description")}</p>
      </div>

      {/* Top: Global Control Bar */}
      <MonitoringControlBar value={filters} onChange={setFilters} />

      {/* Core Area 1: Performance Diagnostics - Vertical Layout */}
      <PerformanceDiagnostics filters={filters} />

      {/* Core Area 2: Dimensional Breakdown - Three Column Layout */}
      <DimensionalBreakdown filters={filters} />
    </Container>
  )
}
