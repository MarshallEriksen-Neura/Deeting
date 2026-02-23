"use client"

import { memo } from "react"
import { RoutingMabOverview } from "./routing-mab-overview"
import { RoutingMabStrategy } from "./routing-mab-strategy"
import { RoutingMabArmsTable } from "./routing-mab-arms-table"
import { RoutingMabDistribution } from "./routing-mab-distribution"
import { RoutingMabSkillReport } from "./routing-mab-skill-report"

export const RoutingMabClient = memo(function RoutingMabClient() {
  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <RoutingMabOverview />

      {/* Strategy + Distribution */}
      <div className="grid gap-6 lg:grid-cols-3">
        <RoutingMabStrategy />
        <div className="lg:col-span-2">
          <RoutingMabDistribution />
        </div>
      </div>

      {/* Arm Performance Table */}
      <RoutingMabArmsTable />

      {/* Skill MAB Report */}
      <RoutingMabSkillReport />
    </div>
  )
})
