"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import { Brain } from "lucide-react"
import {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
} from "@/components/ui/glass-card"
import { useStrategyConfig } from "@/lib/swr/use-routing-mab"

const STRATEGY_LABELS: Record<string, string> = {
  thompson: "thompson",
  epsilon_greedy: "epsilonGreedy",
  ucb: "ucb",
  ucb1: "ucb",
}

export const RoutingMabStrategy = memo(function RoutingMabStrategy() {
  const t = useTranslations("monitoring.routing.strategy")
  const tParams = useTranslations("monitoring.routing.strategy.params")
  const { data, isLoading } = useStrategyConfig()

  if (isLoading || !data) {
    return (
      <div className="h-[320px] animate-pulse rounded-2xl bg-[var(--card)]/60 border border-white/10" />
    )
  }

  const strategyKey = STRATEGY_LABELS[data.strategy] || "thompson"

  const params = [
    ...(data.strategy === "epsilon_greedy"
      ? [{ label: tParams("epsilon"), value: data.epsilon }]
      : []),
    ...(data.strategy === "thompson"
      ? [
          { label: tParams("alpha"), value: data.alpha },
          { label: tParams("beta"), value: data.beta },
        ]
      : []),
    { label: tParams("vectorWeight"), value: data.vectorWeight },
    { label: tParams("banditWeight"), value: data.banditWeight },
    { label: tParams("explorationBonus"), value: data.explorationBonus },
  ]

  return (
    <GlassCard padding="default" hover="none">
      <GlassCardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary)]/10">
            <Brain className="size-5 text-[var(--primary)]" />
          </div>
          <div>
            <GlassCardTitle className="text-base">{t("title")}</GlassCardTitle>
            <GlassCardDescription className="text-xs">
              {t("description")}
            </GlassCardDescription>
          </div>
        </div>
      </GlassCardHeader>

      <div className="mt-5 space-y-4">
        {/* Strategy Name */}
        <div className="rounded-xl bg-[var(--primary)]/5 border border-[var(--primary)]/10 p-3">
          <div className="text-sm font-semibold text-[var(--primary)]">
            {t(strategyKey)}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)] leading-relaxed">
            {data.strategy === "epsilon_greedy"
              ? t("epsilonGreedyDesc", {
                  ratio: `${((1 - data.epsilon) * 100).toFixed(0)}%`,
                  epsilon: `${(data.epsilon * 100).toFixed(0)}%`,
                })
              : t(`${strategyKey}Desc`)}
          </p>
        </div>

        {/* Parameters */}
        <div className="space-y-2">
          {params.map((param) => (
            <div
              key={param.label}
              className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2"
            >
              <span className="text-xs text-[var(--muted)]">{param.label}</span>
              <span className="font-mono text-sm font-medium text-[var(--foreground)]">
                {param.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  )
})
