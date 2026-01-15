import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { Container } from "@/components/ui/container"

import { BalanceReactorCard } from "./components/balance-reactor-card"
import { MembershipPlanCard } from "./components/membership-plan-card"
import { ModelUsageChart } from "./components/model-usage-chart"
import { ConsumptionTrendChart } from "./components/consumption-trend-chart"
import { QuickActionsCard } from "./components/quick-actions-card"
import { TransactionStream } from "./components/transaction-stream"

export default async function CreditsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <CreditsContent />
}

function CreditsContent() {
  const t = useTranslations("credits")

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("description")}</p>
          </div>
          <span className="hidden text-xs font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/20 sm:inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            System Online
          </span>
        </div>
      </div>

      {/* Bento Grid - Top Section (3 columns) */}
      <div className="mb-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Balance Reactor - Main focal point */}
        <BalanceReactorCard />

        {/* Membership Plan */}
        <MembershipPlanCard />

        {/* Model Usage Pie */}
        <ModelUsageChart />
      </div>

      {/* Analytics Section (2:1 ratio) */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {/* Consumption Trend Chart (takes 2/3) */}
        <div className="lg:col-span-2">
          <ConsumptionTrendChart />
        </div>

        {/* Quick Actions (takes 1/3) */}
        <div className="lg:col-span-1">
          <QuickActionsCard />
        </div>
      </div>

      {/* Transaction Stream - Full width */}
      <TransactionStream />
    </Container>
  )
}
