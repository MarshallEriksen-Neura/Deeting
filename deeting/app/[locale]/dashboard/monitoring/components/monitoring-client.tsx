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
  })

  return (
    <div className="space-y-6">
      <MonitoringControlBar value={filters} onChange={setFilters} />
      <PerformanceDiagnostics filters={filters} />
      <DimensionalBreakdown filters={filters} />
    </div>
  )
}
