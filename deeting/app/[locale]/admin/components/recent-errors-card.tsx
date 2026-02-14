"use client"

import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"

interface RecentErrorsCardProps {
  /**
   * 最近的错误数据
   */
  errors: Array<{
    id: string
    timestamp: string
    statusCode: number
    model: string
    errorCode?: string | null
    errorMessage: string
  }>
}

function formatTime(value: string | undefined, locale: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

export function RecentErrorsCard({ errors }: RecentErrorsCardProps) {
  const t = useTranslations("admin.dashboard.recentErrors")
  const locale = useLocale()

  return (
    <GlassCard padding="default" hover="none">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-rose-400" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {t("title")}
          </h3>
        </div>
        <Link
          href="/admin/gateway-logs"
          className="cursor-pointer text-xs text-[var(--primary)] hover:underline"
        >
          {t("viewAllLogs")} →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.time")}
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.status")}
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.model")}
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.error")}
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("columns.message")}
              </th>
            </tr>
          </thead>
          <tbody>
            {errors.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-xs text-[var(--muted)]">
                  {t("empty")}
                </td>
              </tr>
            )}
            {(errors ?? []).map((errorItem) => (
              <tr key={errorItem.id} className="border-b border-white/5 last:border-0">
                <td className="px-3 py-2.5 font-mono text-xs text-[var(--muted)]">
                  {formatTime(errorItem.timestamp, locale)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-xs font-medium text-rose-400">
                    {errorItem.statusCode}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-[var(--foreground)]">
                  {errorItem.model}
                </td>
                <td className="px-3 py-2.5">
                  <span className="font-mono text-xs text-amber-400">
                    {errorItem.errorCode ?? "—"}
                  </span>
                </td>
                <td className="max-w-xs truncate px-3 py-2.5 text-xs text-[var(--muted)]">
                  {errorItem.errorMessage}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
}

export default RecentErrorsCard
