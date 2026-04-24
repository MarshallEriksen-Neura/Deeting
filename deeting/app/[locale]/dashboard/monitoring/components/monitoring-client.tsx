"use client"

import { useState } from "react"
import { TrendingUp, Activity, BarChart3, DollarSign, AlertTriangle, Key } from "lucide-react"
import { MonitoringControlBar, type MonitoringFilters } from "./monitoring-control-bar"
import { PerformanceDiagnostics } from "./performance-diagnostics"
import { DimensionalBreakdown } from "./dimensional-breakdown"
import { TokenThroughputChart } from "./token-throughput-chart"

export function MonitoringClient() {
  const [filters, setFilters] = useState<MonitoringFilters>({
    timeRange: "24h",
    model: undefined,
    apiKey: undefined,
    errorCode: undefined,
    autoRefresh: true,
  })

  return (
    <div className="relative min-h-full space-y-12 pb-24">
      {/* Ambient Glow */}
      <div className="pointer-events-none absolute -left-32 top-20 w-96 h-96 bg-[var(--accent)]/5 rounded-full blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 bottom-40 w-80 h-80 bg-[var(--chart-2)]/5 rounded-full blur-[100px]" />

      <div className="relative z-10 space-y-12">
        {/* Control Bar */}
        <MonitoringControlBar value={filters} onChange={setFilters} />

        {/* Section 1: Token Throughput — Full Width Hero Chart */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="h-4 w-4 text-[var(--primary)]" />
            <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase text-[var(--muted-foreground)]">
              Throughput / Tokens
            </span>
          </div>
          <TokenThroughputChart />
        </section>

        {/* Section 2: Performance Diagnostics — Left Column */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <Activity className="h-4 w-4 text-[var(--primary)]" />
            <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase text-[var(--muted-foreground)]">
              Performance / Diagnostics
            </span>
          </div>
          <PerformanceDiagnostics filters={filters} />
        </section>

        {/* Section 3: Dimensional Breakdown — Right Column */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="h-4 w-4 text-[var(--chart-2)]" />
            <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase text-[var(--muted-foreground)]">
              Traffic / Analysis
            </span>
          </div>
          <DimensionalBreakdown filters={filters} />
        </section>
      </div>
    </div>
  )
}
