"use client"

import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"

import { Container } from "@/components/ui/container"
import { Skeleton } from "@/components/ui/skeleton"

const KPIMetricsRow = dynamic(
  () => import("./components/kpi-metrics-row").then((mod) => mod.KPIMetricsRow),
  { loading: () => <DashboardMetricsSkeleton /> }
)
const TokenThroughputChart = dynamic(
  () => import("./components/token-throughput-chart").then((mod) => mod.TokenThroughputChart),
  { loading: () => <DashboardPanelSkeleton className="h-[360px]" /> }
)
const SmartRouterValueCard = dynamic(
  () => import("./components/smart-router-value-card").then((mod) => mod.SmartRouterValueCard),
  { loading: () => <DashboardPanelSkeleton className="h-[360px]" /> }
)
const ProviderHealthStatus = dynamic(
  () => import("./components/provider-health-status").then((mod) => mod.ProviderHealthStatus),
  { loading: () => <DashboardPanelSkeleton className="h-[320px]" /> }
)
const RecentErrorsList = dynamic(
  () => import("./components/recent-errors-list").then((mod) => mod.RecentErrorsList),
  { loading: () => <DashboardPanelSkeleton className="h-[320px]" /> }
)

export function DashboardClient() {
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

function DashboardMetricsSkeleton() {
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <DashboardPanelSkeleton key={index} className="h-[132px]" />
      ))}
    </div>
  )
}

function DashboardPanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={`rounded-3xl border border-border/60 bg-card/80 p-6 ${className ?? ""}`}>
      <div className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  )
}
