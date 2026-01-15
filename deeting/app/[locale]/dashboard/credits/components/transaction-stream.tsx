"use client"

import { useTranslations } from "next-intl"
import { useState, useMemo } from "react"
import { ChevronDown, CheckCircle2, XCircle, Clock } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

interface Transaction {
  id: string
  model: string
  status: "success" | "failed" | "pending"
  statusCode: number
  tokens: number
  cost: number
  timestamp: Date
  details?: {
    requestId: string
    duration: number
    prompt: string
    response: string
  }
}

export function TransactionStream() {
  const t = useTranslations("credits")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Mock data - replace with real API call
  const transactions = useMemo<Transaction[]>(() => {
    const models = ["GPT-4o", "Claude 3.5 Sonnet", "Gemini Pro"]
    const statuses: Transaction["status"][] = ["success", "success", "success", "failed", "success"]

    return Array.from({ length: 20 }, (_, i) => ({
      id: `txn-${Date.now()}-${i}`,
      model: models[Math.floor(Math.random() * models.length)],
      status: statuses[Math.floor(Math.random() * statuses.length)],
      statusCode: Math.random() > 0.1 ? 200 : 429,
      tokens: Math.floor(Math.random() * 5000) + 500,
      cost: (Math.random() * 0.5 + 0.05).toFixed(4),
      timestamp: new Date(Date.now() - Math.random() * 86400000),
      details: {
        requestId: `req-${Math.random().toString(36).substring(2, 15)}`,
        duration: Math.floor(Math.random() * 3000) + 200,
        prompt: "Analyze user behavior patterns...",
        response: "Based on the data provided...",
      },
    }))
  }, [])

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

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
        {transactions.map((tx) => (
          <TransactionRow
            key={tx.id}
            transaction={tx}
            isExpanded={expandedId === tx.id}
            onToggle={() => toggleExpand(tx.id)}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}

function TransactionRow({
  transaction,
  isExpanded,
  onToggle,
  t,
}: {
  transaction: Transaction
  isExpanded: boolean
  onToggle: () => void
  t: any
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
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-4 items-center hover:bg-[var(--muted)]/5 transition-colors cursor-pointer"
      >
        {/* Status */}
        <div className="flex items-center gap-3 w-24">
          <StatusIcon className={cn("w-4 h-4", statusColor)} />
          <span className="text-xs font-mono text-[var(--muted)]">
            {transaction.statusCode}
          </span>
        </div>

        {/* Model & ID */}
        <div className="text-left min-w-0">
          <p className="text-sm font-medium text-[var(--foreground)] truncate">
            {transaction.model}
          </p>
          <p className="text-xs text-[var(--muted)] font-mono truncate opacity-0 group-hover:opacity-100 transition-opacity">
            {transaction.details?.requestId}
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
            ${transaction.cost}
          </span>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-[var(--muted)] transition-transform duration-200",
              isExpanded && "rotate-180"
            )}
          />
        </div>
      </button>

      {/* Expandable Details */}
      <AnimatePresence>
        {isExpanded && transaction.details && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden bg-[var(--muted)]/5"
          >
            <div className="px-6 py-4 space-y-4 border-t border-[var(--muted)]/5">
              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[var(--muted)] block mb-1">
                    {t("transactions.details.requestId")}
                  </span>
                  <span className="font-mono text-[var(--foreground)]">
                    {transaction.details.requestId}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--muted)] block mb-1">
                    {t("transactions.details.duration")}
                  </span>
                  <span className="font-mono text-[var(--foreground)]">
                    {transaction.details.duration}ms
                  </span>
                </div>
              </div>

              {/* Prompt Preview */}
              <div>
                <span className="text-[var(--muted)] text-xs block mb-2">
                  {t("transactions.details.prompt")}
                </span>
                <div className="bg-[var(--background)] rounded-lg p-3 border border-[var(--muted)]/10">
                  <p className="text-xs text-[var(--foreground)] font-mono line-clamp-2">
                    {transaction.details.prompt}
                  </p>
                </div>
              </div>

              {/* Response Preview */}
              <div>
                <span className="text-[var(--muted)] text-xs block mb-2">
                  {t("transactions.details.response")}
                </span>
                <div className="bg-[var(--background)] rounded-lg p-3 border border-[var(--muted)]/10">
                  <p className="text-xs text-[var(--foreground)] font-mono line-clamp-2">
                    {transaction.details.response}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
