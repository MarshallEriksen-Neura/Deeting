"use client"

import { useTranslations } from "next-intl"
import { Key, TrendingUp } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { useKeyActivityRanking } from "@/lib/swr/use-key-activity-ranking"
import { cn } from "@/lib/utils"

/**
 * Key Activity Ranking Component
 *
 * Top 5 most active API keys with:
 * - Masked key display (sk-***abcd)
 * - Current RPM (requests per minute)
 *
 * Purpose: Identify who's hammering the API
 */
export function KeyActivityRanking() {
  const t = useTranslations("monitoring.dimensional.keyActivity")
  const { data, isLoading } = useKeyActivityRanking()

  const topKeys = data?.keys || [
    { id: "1", name: "Production Main", maskedKey: "sk-***x7k2", rpm: 1240, trend: 12 },
    { id: "2", name: "Mobile App", maskedKey: "sk-***m9p3", rpm: 856, trend: -5 },
    { id: "3", name: "Web Dashboard", maskedKey: "sk-***a4b1", rpm: 623, trend: 8 },
    { id: "4", name: "Analytics Service", maskedKey: "sk-***c8d5", rpm: 412, trend: 3 },
    { id: "5", name: "Testing Env", maskedKey: "sk-***e2f9", rpm: 187, trend: -15 },
  ]

  return (
    <GlassCard className="bg-[var(--card)]">
      <GlassCardHeader>
        <GlassCardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5 text-[var(--teal-accent)]" />
          {t("title")}
        </GlassCardTitle>
        <GlassCardDescription className="mt-1">
          {t("description")}
        </GlassCardDescription>
      </GlassCardHeader>
      <GlassCardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded bg-[var(--foreground)]/5"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {topKeys.map((key, index) => (
              <KeyRankItem key={key.id} keyData={key} rank={index + 1} />
            ))}
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}

function KeyRankItem({
  keyData,
  rank,
}: {
  keyData: {
    name: string
    maskedKey: string
    rpm: number
    trend: number
  }
  rank: number
}) {
  const t = useTranslations("monitoring.dimensional.keyActivity")

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 transition-all",
        "hover:border-[var(--primary)] hover:bg-[var(--primary)]/5"
      )}
    >
      {/* Rank Badge */}
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-bold",
          rank === 1 && "bg-amber-500/20 text-amber-400",
          rank === 2 && "bg-gray-400/20 text-gray-300",
          rank === 3 && "bg-orange-500/20 text-orange-400",
          rank > 3 && "bg-[var(--muted)]/20 text-[var(--muted)]"
        )}
      >
        {rank}
      </div>

      {/* Key Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-[var(--foreground)]">
          {keyData.name}
        </div>
        <div className="font-mono text-xs text-[var(--muted)]">
          {keyData.maskedKey}
        </div>
      </div>

      {/* RPM & Trend */}
      <div className="flex-shrink-0 text-right">
        <div className="flex items-center gap-1">
          <span className="font-mono text-lg font-bold text-[var(--foreground)] tabular-nums">
            {keyData.rpm}
          </span>
          <TrendIndicator value={keyData.trend} />
        </div>
        <div className="text-xs text-[var(--muted)]">{t("rpm")}</div>
      </div>
    </div>
  )
}

function TrendIndicator({ value }: { value: number }) {
  if (value === 0) return null

  const isPositive = value > 0

  return (
    <span
      className={cn(
        "flex items-center text-xs font-semibold",
        isPositive ? "text-emerald-400" : "text-red-400"
      )}
    >
      <svg
        className={cn("h-3 w-3", !isPositive && "rotate-180")}
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M6 2.5v7M6 2.5L3 5.5M6 2.5l3 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {Math.abs(value)}%
    </span>
  )
}
