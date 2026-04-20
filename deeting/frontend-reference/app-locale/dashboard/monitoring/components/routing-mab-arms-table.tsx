"use client"

import { memo, useState, useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
} from "@/ui/common/glass-card"
import { ChevronDown, MoreHorizontal } from "lucide-react"
import { useArmPerformance } from "@/lib/swr/use-routing-mab"
import type { ArmPerformanceItem } from "@/lib/api/routing-mab"

export const RoutingMabArmsTable = memo(function RoutingMabArmsTable() {
  const t = useTranslations("monitoring.routing.arms")
  const tStatus = useTranslations("monitoring.routing.arms.status")
  const { data, isLoading } = useArmPerformance()
  const [expandedArm, setExpandedArm] = useState<string | null>(null)

  const toggleExpand = useCallback(
    (armId: string) =>
      setExpandedArm((prev) => (prev === armId ? null : armId)),
    []
  )

  if (isLoading) {
    return (
      <div className="h-[400px] animate-pulse rounded-2xl bg-[var(--card)]/60 border border-white/10" />
    )
  }

  const arms = data?.arms ?? []

  return (
    <GlassCard padding="none" hover="none">
      <div className="p-6 pb-0">
        <GlassCardHeader>
          <GlassCardTitle>{t("title")}</GlassCardTitle>
          <GlassCardDescription>{t("description")}</GlassCardDescription>
        </GlassCardHeader>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.provider")}
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.status")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] min-w-[160px]">
                {t("columns.selectionRatio")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] min-w-[120px]">
                {t("columns.successRate")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.p95Latency")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.trials")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.cost")}
              </th>
              <th className="w-10 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {arms.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-16 text-center text-[var(--muted)]">
                  <div className="flex flex-col items-center gap-2">
                    <div className="size-12 rounded-full bg-white/5 flex items-center justify-center">
                      <MoreHorizontal className="size-5 text-[var(--muted)]" />
                    </div>
                    <span>{t("description")}</span>
                  </div>
                </td>
              </tr>
            ) : (
              arms.map((arm) => (
                <ArmRow
                  key={arm.armId ?? `${arm.provider}-${arm.model}`}
                  arm={arm}
                  isExpanded={expandedArm === (arm.armId ?? `${arm.provider}-${arm.model}`)}
                  onToggle={toggleExpand}
                  tStatus={tStatus}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
})

const ArmRow = memo(function ArmRow({
  arm,
  isExpanded,
  onToggle,
  tStatus,
}: {
  arm: ArmPerformanceItem
  isExpanded: boolean
  onToggle: (armId: string) => void
  tStatus: ReturnType<typeof useTranslations>
}) {
  const armKey = arm.armId ?? `${arm.provider}-${arm.model}`
  const isCooldown = arm.status === "cooldown"
  const successPct = (arm.successRate * 100).toFixed(1)
  const selectionPct = (arm.selectionRatio * 100).toFixed(1)

  // Color based on success rate
  const successColor =
    arm.successRate >= 0.95
      ? "text-emerald-400"
      : arm.successRate >= 0.8
        ? "text-amber-400"
        : "text-rose-400"

  const barColor =
    arm.successRate >= 0.95
      ? "bg-emerald-400/80"
      : arm.successRate >= 0.8
        ? "bg-amber-400/80"
        : "bg-rose-400/80"

  return (
    <>
      <tr
        className={cn(
          "border-b border-white/5 transition-colors cursor-pointer",
          "hover:bg-white/[0.02]",
          isCooldown && "opacity-60"
        )}
        onClick={() => onToggle(armKey)}
      >
        {/* Provider / Model */}
        <td className="px-6 py-3">
          <div className="flex flex-col">
            <span className="font-medium text-[var(--foreground)]">
              {arm.provider}
            </span>
            <span className="text-xs text-[var(--muted)] font-mono">
              {arm.model}
            </span>
          </div>
        </td>

        {/* Status */}
        <td className="px-4 py-3 text-center">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
              isCooldown
                ? "bg-rose-500/10 text-rose-400"
                : "bg-emerald-500/10 text-emerald-400"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isCooldown ? "bg-rose-400" : "bg-emerald-400"
              )}
            />
            {isCooldown ? tStatus("cooldown") : tStatus("active")}
          </span>
        </td>

        {/* Selection Ratio Bar */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--primary)]/70 transition-all duration-500"
                style={{ width: `${Math.min(100, parseFloat(selectionPct))}%` }}
              />
            </div>
            <span className="text-xs font-mono text-[var(--muted)] w-12 text-right">
              {selectionPct}%
            </span>
          </div>
        </td>

        {/* Success Rate with mini bar */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", barColor)}
                style={{ width: `${parseFloat(successPct)}%` }}
              />
            </div>
            <span className={cn("text-xs font-mono font-medium w-12 text-right", successColor)}>
              {successPct}%
            </span>
          </div>
        </td>

        {/* P95 Latency */}
        <td className="px-4 py-3 text-right">
          <span className="font-mono text-sm text-[var(--foreground)]">
            {arm.latencyP95Ms != null ? `${Math.round(arm.latencyP95Ms)}ms` : "—"}
          </span>
        </td>

        {/* Trials / Failures */}
        <td className="px-4 py-3 text-right">
          <span className="font-mono text-sm text-[var(--foreground)]">
            {arm.totalTrials.toLocaleString()}
          </span>
          {arm.failures > 0 && (
            <span className="text-xs text-rose-400 ml-1">
              / {arm.failures}
            </span>
          )}
        </td>

        {/* Total Cost */}
        <td className="px-4 py-3 text-right">
          <span className="font-mono text-sm text-[var(--foreground)]">
            ${arm.totalCost.toFixed(4)}
          </span>
        </td>

        {/* Expand indicator */}
        <td className="px-2 py-3">
          <ChevronDown
            className={cn(
              "size-4 text-[var(--muted)] transition-transform duration-200",
              isExpanded && "rotate-180"
            )}
          />
        </td>
      </tr>

      {/* Expanded Detail */}
      {isExpanded && (
        <tr className="border-b border-white/5">
          <td colSpan={8} className="bg-white/[0.01] px-6 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs md:grid-cols-4">
              <DetailItem label="Strategy" value={arm.strategy} />
              <DetailItem label="Epsilon" value={arm.epsilon.toString()} />
              <DetailItem label="Alpha" value={arm.alpha.toString()} />
              <DetailItem label="Beta" value={arm.beta.toString()} />
              <DetailItem
                label="Avg Latency"
                value={`${Math.round(arm.avgLatencyMs)}ms`}
              />
              <DetailItem
                label="Last Reward"
                value={arm.lastReward.toFixed(4)}
              />
              <DetailItem
                label="Successes"
                value={arm.successes.toLocaleString()}
              />
              {arm.cooldownUntil && (
                <DetailItem
                  label="Cooldown Until"
                  value={new Date(arm.cooldownUntil).toLocaleString()}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
})

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-1.5">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-mono font-medium text-[var(--foreground)]">
        {value}
      </span>
    </div>
  )
}
