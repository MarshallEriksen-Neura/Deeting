"use client"

import { useState } from "react"
import useSWR from "swr"
import { useTranslations } from "next-intl"
import { Zap, Plus } from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { fetchCreditsRechargePolicy, rechargeCredits } from "@/lib/api/credits"
import { useCreditsBalance } from "@/lib/swr/use-credits-balance"

export function BalanceReactorCard() {
  const t = useTranslations("credits")
  const { data, isLoading, mutate } = useCreditsBalance()
  const { data: rechargePolicy } = useSWR(
    "/api/v1/credits/recharge-policy",
    fetchCreditsRechargePolicy
  )
  const [amountInput, setAmountInput] = useState("10")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  const balance = data?.balance ?? 0
  const monthlySpent = data?.monthlySpent ?? 0
  const percentage = Math.min(100, Math.max(0, data?.usedPercent ?? 0))
  const formatAmount = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 2 })

  const handleRecharge = async () => {
    const amount = Number(amountInput)
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback({ kind: "error", text: t("balance.feedback.invalidAmount") })
      return
    }

    setIsSubmitting(true)
    setFeedback(null)
    try {
      const result = await rechargeCredits(amount)
      await mutate()
      setFeedback({
        kind: "success",
        text: t("balance.feedback.rechargeSuccess", {
          amount: formatAmount(result.creditedAmount),
        }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t("balance.feedback.rechargeFailed")
      setFeedback({ kind: "error", text: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <GlassCard
      blur="lg"
      theme="primary"
      hover="lift"
      className="relative overflow-hidden group"
    >
      {/* Background Icon Texture */}
      <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity duration-500">
        <Zap className="w-32 h-32" />
      </div>

      {/* Content */}
      <div className="relative z-10 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium text-[var(--muted)] mb-1">
              {t("balance.title")}
            </h3>
            <p className="text-4xl font-bold text-[var(--foreground)] tracking-tight">
              {isLoading ? "—" : formatAmount(balance)}
            </p>
          </div>

          {/* Circular Progress Ring */}
          <div className="relative w-16 h-16">
            <svg className="w-16 h-16 -rotate-90">
              {/* Background circle */}
              <circle
                cx="32"
                cy="32"
                r="28"
                className="stroke-[var(--muted)]/20"
                strokeWidth="4"
                fill="none"
              />
              {/* Progress circle */}
              <circle
                cx="32"
                cy="32"
                r="28"
                className="stroke-[var(--primary)] transition-all duration-1000"
                strokeWidth="4"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 28}`}
                strokeDashoffset={`${2 * Math.PI * 28 * (1 - percentage / 100)}`}
                strokeLinecap="round"
              />
            </svg>
            {/* Percentage text */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-[var(--foreground)]">
                {percentage}%
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            {t("balance.rechargePolicy", {
              ratio: formatAmount(rechargePolicy?.creditPerUnit ?? 10),
              currency: rechargePolicy?.currency ?? "USD",
            })}
          </p>
          <div className="flex gap-3">
            <input
              type="number"
              min={0}
              step="0.01"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder={t("balance.amountPlaceholder")}
              className="h-9 w-28 rounded-md border border-[var(--muted)]/20 bg-transparent px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]/60"
            />
            <Button
              size="sm"
              className="flex-1 bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity"
              disabled={isSubmitting}
              onClick={() => void handleRecharge()}
            >
              <Plus className="w-4 h-4 mr-2" />
              {isSubmitting ? t("balance.recharging") : t("balance.recharge")}
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-[var(--muted)]/20 hover:bg-[var(--muted)]/5"
            disabled
          >
            {t("balance.autoRecharge")}
          </Button>
        </div>
        {feedback ? (
          <p
            className={`text-xs ${feedback.kind === "success" ? "text-emerald-400" : "text-rose-300"}`}
          >
            {feedback.text}
          </p>
        ) : null}

        {/* Usage Stats */}
        <div className="pt-4 border-t border-[var(--muted)]/10 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[var(--muted)]">{t("balance.used")}</p>
            <p className="text-lg font-semibold text-[var(--foreground)] mt-1">
              {isLoading ? "—" : formatAmount(monthlySpent)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">{t("balance.remaining")}</p>
            <p className="text-lg font-semibold text-emerald-500 dark:text-emerald-400 mt-1">
              {isLoading ? "—" : formatAmount(balance)}
            </p>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
