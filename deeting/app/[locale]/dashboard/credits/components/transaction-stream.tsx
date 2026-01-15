"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2, XCircle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCreditsTransactions } from "@/lib/swr/use-credits-transactions"

interface Transaction {
  id: string
  model: string
  status: "success" | "failed" | "pending"
  tokens: number
  cost: number
  timestamp: Date
  traceId: string
}

export function TransactionStream() {
  const t = useTranslations("credits")
  const { data, isLoading } = useCreditsTransactions({ limit: 20 })

  const transactions: Transaction[] =
    data?.items.map((item) => ({
      id: item.id,
      model: item.model ?? "unknown",
      status: item.status,
      tokens: item.totalTokens,
      cost: item.amount,
      timestamp: new Date(item.createdAt),
      traceId: item.traceId,
    })) ?? []
  const formatCost = (value: number) =>
    value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
  const rows =
    transactions.length === 0 ? (
      <div className="px-6 py-6 text-xs text-[var(--muted)]">
        {isLoading ? "—" : "—"}
      </div>
    ) : (
      transactions.map((tx) => (
        <TransactionRow key={tx.id} transaction={tx} formatCost={formatCost} />
      ))
    )

  return (
    <div className="bg-[var(--card)] rounded-2xl border border-[var(--muted)]/10 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--muted)]/10 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {t("transactions.title")}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            {t("transactions.subtitle")}
          </p>
        </div>
        <button className="text-xs font-medium text-[var(--primary)] hover:underline transition-colors">
          {t("transactions.exportCSV")}
        </button>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-3 bg-[var(--muted)]/5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
        <span className="w-24">{t("transactions.status")}</span>
        <span>{t("transactions.model")}</span>
        <span className="text-right w-32">{t("transactions.time")}</span>
        <span className="text-right w-24">{t("transactions.tokens")}</span>
        <span className="text-right w-24">{t("transactions.cost")}</span>
      </div>

      {/* Transaction List */}
      <div className="divide-y divide-[var(--muted)]/5">
        {rows}
      </div>
    </div>
  )
}

function TransactionRow({
  transaction,
  formatCost,
}: {
  transaction: Transaction
  formatCost: (value: number) => string
}) {
  const StatusIcon = {
    success: CheckCircle2,
    failed: XCircle,
    pending: Clock,
  }[transaction.status]

  const statusColor = {
    success: "text-emerald-500",
    failed: "text-red-500",
    pending: "text-amber-500",
  }[transaction.status]

  return (
    <div className="group">
      {/* Main Row */}
      <div className="w-full grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-4 items-center hover:bg-[var(--muted)]/5 transition-colors">
        {/* Status */}
        <div className="flex items-center gap-3 w-24">
          <StatusIcon className={cn("w-4 h-4", statusColor)} />
          <span className="text-xs font-mono text-[var(--muted)]">
            {transaction.status.toUpperCase()}
          </span>
        </div>

        {/* Model & ID */}
        <div className="text-left min-w-0">
          <p className="text-sm font-medium text-[var(--foreground)] truncate">
            {transaction.model}
          </p>
          <p className="text-xs text-[var(--muted)] font-mono truncate opacity-0 group-hover:opacity-100 transition-opacity">
            {transaction.traceId}
          </p>
        </div>

        {/* Time */}
        <span className="text-sm text-[var(--muted)] text-right w-32">
          {transaction.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>

        {/* Tokens */}
        <span className="text-sm font-mono text-[var(--foreground)] text-right w-24">
          {transaction.tokens.toLocaleString()}
        </span>

        {/* Cost */}
        <div className="flex items-center justify-end gap-2 w-24">
          <span className="text-sm font-mono font-bold text-[var(--foreground)]">
            {formatCost(transaction.cost)}
          </span>
        </div>
      </div>
    </div>
  )
}
