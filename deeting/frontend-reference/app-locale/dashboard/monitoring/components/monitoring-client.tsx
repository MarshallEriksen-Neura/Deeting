"use client"

import { useState } from "react"
import { MonitoringControlBar, type MonitoringFilters } from "./monitoring-control-bar"
import { PerformanceDiagnostics } from "./performance-diagnostics"
import { DimensionalBreakdown } from "./dimensional-breakdown"

export function MonitoringClient() {
  const [filters, setFilters] = useState<MonitoringFilters>({
    timeRange: "24h",
    model: undefined,
    apiKey: undefined,
    errorCode: undefined,
    autoRefresh: true,
  })

  return (
    <div className="relative space-y-12 pb-20">
      {/* Background Blueprint Grid for the whole unit */}
      <div 
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.015]" 
        style={{
          backgroundImage: `linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      <div className="relative z-10 space-y-12">
        <MonitoringControlBar value={filters} onChange={setFilters} />
        
        <section className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-4)] font-bold">Performance / Diagnostics</h2>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <PerformanceDiagnostics filters={filters} />
        </section>

        <section className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-4)] font-bold">Traffic / Throughput</h2>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <DimensionalBreakdown filters={filters} />
        </section>
      </div>
    </div>
  )
}
