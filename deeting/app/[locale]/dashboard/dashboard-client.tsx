"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardOverview } from "@/lib/swr/use-dashboard-overview"

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
const AssetSummaryCard = dynamic(
  () => import("./components/asset-summary-card").then((mod) => mod.AssetSummaryCard),
  { loading: () => <DashboardPanelSkeleton className="h-[280px]" /> }
)

export function DashboardClient() {
  const { data, isLoading } = useDashboardOverview({
    source: "auto",
    period: "24h",
    recentErrorLimit: 10,
  })

  return (
    <>
      <KPIMetricsRow stats={data?.stats} isLoading={isLoading} />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TokenThroughputChart data={data?.tokenThroughput} isLoading={isLoading} />
        </div>

        <div className="lg:col-span-1">
          <SmartRouterValueCard stats={data?.smartRouterStats} isLoading={isLoading} />
        </div>
      </div>

      <div className="mt-6">
        <AssetSummaryCard />
      </div>
    </>
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
