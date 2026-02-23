"use client"

import { useTranslations } from "next-intl"
import { GitBranch } from "lucide-react"
import { AdminPageShell } from "@/components/admin"
import { RoutingMabOverview } from "@/app/[locale]/dashboard/monitoring/components/routing-mab-overview"
import { RoutingMabStrategy } from "@/app/[locale]/dashboard/monitoring/components/routing-mab-strategy"
import { RoutingMabArmsTable } from "@/app/[locale]/dashboard/monitoring/components/routing-mab-arms-table"
import { RoutingMabDistribution } from "@/app/[locale]/dashboard/monitoring/components/routing-mab-distribution"
import { RoutingMabSkillReport } from "@/app/[locale]/dashboard/monitoring/components/routing-mab-skill-report"
import { RoutingMabAssistantReport } from "@/app/[locale]/dashboard/monitoring/components/routing-mab-assistant-report"

export function PageContent() {
  const t = useTranslations("monitoring.routing")

  return (
    <AdminPageShell
      title={t("pageTitle")}
      description={t("pageDescription")}
      icon={GitBranch}
    >
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

      {/* Assistant MAB Report */}
      <RoutingMabAssistantReport />
    </AdminPageShell>
  )
}
