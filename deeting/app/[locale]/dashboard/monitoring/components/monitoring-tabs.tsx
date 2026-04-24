"use client"

import { useState, useCallback, lazy, Suspense } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Activity, GitBranch } from "lucide-react"
import { MonitoringClient } from "./monitoring-client"

const RoutingMabClient = lazy(() =>
  import("./routing-mab-client").then((m) => ({ default: m.RoutingMabClient }))
)

type TabId = "performance" | "routing"

export function MonitoringTabs() {
  const t = useTranslations("monitoring")
  const [activeTab, setActiveTab] = useState<TabId>("performance")

  const handleTab = useCallback((tab: TabId) => setActiveTab(tab), [])

  const tabs = [
    { id: "performance" as const, label: t("tabs.performance"), icon: Activity },
    { id: "routing" as const, label: t("tabs.routing"), icon: GitBranch },
  ]

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-xl bg-[var(--surface)]/60 p-1 backdrop-blur-sm border border-white/5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => handleTab(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/5"
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "performance" ? (
        <MonitoringClient />
      ) : (
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center">
              <div className="text-sm text-[var(--muted)]">
                {t("routing.loading")}
              </div>
            </div>
          }
        >
          <RoutingMabClient />
        </Suspense>
      )}
    </div>
  )
}
