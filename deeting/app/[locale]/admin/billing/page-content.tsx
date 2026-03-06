"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import {
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  DonutChart,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  fetchAdminBillingSummary,
  fetchAdminBillingTransactions,
  fetchAdminRechargePolicy,
  fetchAdminQuotas,
  updateAdminRechargePolicy,
  type BillingTransactionItem,
  type TenantQuotaItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const t = useTranslations("admin.billingPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const percentageFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
  const currencyNoDecimalFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
  const currency4Formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  })
  const [tab, setTab] = useState<"quotas" | "transactions">("quotas")
  const [searchQuery, setSearchQuery] = useState("")
  const [txTypeFilter, setTxTypeFilter] = useState("")
  const [txStatusFilter, setTxStatusFilter] = useState("")
  const [ratioInput, setRatioInput] = useState("")
  const [currencyInput, setCurrencyInput] = useState("USD")
  const [isSavingPolicy, setIsSavingPolicy] = useState(false)
  const [policyFeedback, setPolicyFeedback] = useState<string | null>(null)

  const { data: quotasData, error: quotasError, isLoading: quotasLoading } = useSWR(
    "/api/v1/admin/quotas?limit=100",
    () => fetchAdminQuotas({ limit: 100 })
  )

  const { data: summaryData } = useSWR(
    "/api/v1/admin/billing/summary",
    fetchAdminBillingSummary
  )
  const { data: policyData, mutate: mutatePolicy } = useSWR(
    "/api/v1/admin/settings/recharge-policy",
    fetchAdminRechargePolicy
  )

  const {
    data: transactionsData,
    error: transactionsError,
    isLoading: transactionsLoading,
  } = useSWR(
    ["/api/v1/admin/billing/transactions", txTypeFilter, txStatusFilter],
    () =>
      fetchAdminBillingTransactions({
        limit: 100,
        type: txTypeFilter || undefined,
        status: txStatusFilter || undefined,
      })
  )

  const quotaRows = quotasData?.items ?? []
  const totalBalance = quotaRows.reduce((sum, item) => sum + item.balance, 0)
  const activeTenants = quotaRows.filter((item) => item.is_active).length
  const lowBalance = quotaRows.filter((item) => item.balance < 100 && item.is_active).length

  const txTypeLabelMap: Record<string, string> = {
    deduct: t("type.deduct"),
    recharge: t("type.recharge"),
    refund: t("type.refund"),
    adjust: t("type.adjust"),
  }

  const txStatusLabelMap: Record<string, string> = {
    committed: t("transactionStatus.committed"),
    pending: t("transactionStatus.pending"),
    reversed: t("transactionStatus.reversed"),
  }

  const quotaStats: StatCardData[] = [
    {
      label: t("stats.totalBalance"),
      value: currencyNoDecimalFormatter.format(totalBalance),
      color: "emerald",
    },
    {
      label: t("stats.monthlyProfit"),
      value: currencyFormatter.format(summaryData?.profit ?? 0),
      color: (summaryData?.profit ?? 0) >= 0 ? "teal" : "rose",
      subtitle: t("stats.transactions", { count: numberFormatter.format(summaryData?.transaction_count ?? 0) }),
    },
    { label: t("stats.activeTenants"), value: numberFormatter.format(activeTenants), color: "primary" },
    {
      label: t("stats.lowBalance"),
      value: numberFormatter.format(lowBalance),
      color: lowBalance > 0 ? "rose" : "emerald",
    },
  ]

  const quotaColumns: ColumnDef<TenantQuotaItem>[] = [
    {
      key: "tenant_id",
      header: t("quotaTable.headers.tenant"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs text-[var(--foreground)]">{shortId(row.tenant_id)}</span>,
    },
    {
      key: "balance",
      header: t("quotaTable.headers.balance"),
      sortable: true,
      render: (row) => (
        <span className={`font-mono text-sm ${row.balance < 100 ? "text-rose-400" : "text-emerald-400"}`}>
          {currencyFormatter.format(row.balance)}
        </span>
      ),
    },
    {
      key: "credit_limit",
      header: t("quotaTable.headers.creditLimit"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{currencyNoDecimalFormatter.format(row.credit_limit)}</span>,
    },
    {
      key: "daily_used",
      header: t("quotaTable.headers.daily"),
      render: (row) => (
        <div className="flex items-center gap-2">
          <DonutChart
            value={row.daily_used}
            total={Math.max(1, row.daily_quota)}
            size={28}
            strokeWidth={3}
            color={
              row.daily_quota > 0 && row.daily_used / row.daily_quota > 0.8
                ? "rgb(248,113,113)"
                : "var(--primary)"
            }
          />
          <span className="text-xs text-[var(--muted)]">
            {row.daily_quota > 0
              ? `${percentageFormatter.format((row.daily_used / row.daily_quota) * 100)}%`
              : "0%"}
          </span>
        </div>
      ),
    },
    {
      key: "monthly_used",
      header: t("quotaTable.headers.monthly"),
      render: (row) => (
        <div className="flex items-center gap-2">
          <DonutChart
            value={row.monthly_used}
            total={Math.max(1, row.monthly_quota)}
            size={28}
            strokeWidth={3}
            color={
              row.monthly_quota > 0 && row.monthly_used / row.monthly_quota > 0.8
                ? "rgb(248,113,113)"
                : "var(--primary)"
            }
          />
          <span className="text-xs text-[var(--muted)]">
            {row.monthly_quota > 0
              ? `${percentageFormatter.format((row.monthly_used / row.monthly_quota) * 100)}%`
              : "0%"}
          </span>
        </div>
      ),
    },
    {
      key: "rpm_limit",
      header: t("quotaTable.headers.rpm"),
      render: (row) => <span className="font-mono text-xs">{numberFormatter.format(row.rpm_limit)}</span>,
    },
    {
      key: "is_active",
      header: t("quotaTable.headers.active"),
      render: (row) => (
        <AdminStatusBadge
          text={row.is_active ? t("status.active") : t("status.inactive")}
          tone={row.is_active ? "success" : "error"}
        />
      ),
    },
  ]

  const txRows = useMemo(() => transactionsData?.items ?? [], [transactionsData?.items])

  const filteredTxRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return txRows
    return txRows.filter((row) => {
      return [row.trace_id, row.tenant_id, row.model, row.description].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [txRows, searchQuery])

  const txTypeTone = (type: string) => {
    if (type === "recharge") return "success" as const
    if (type === "refund") return "info" as const
    if (type === "adjust") return "warn" as const
    return "default" as const
  }

  const txColumns: ColumnDef<BillingTransactionItem>[] = [
    {
      key: "trace_id",
      header: t("txTable.headers.traceId"),
      render: (row) => <span className="font-mono text-[10px] text-[var(--muted)]">{row.trace_id.slice(0, 16)}...</span>,
    },
    {
      key: "tenant_id",
      header: t("txTable.headers.tenant"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.tenant_id)}</span>,
    },
    {
      key: "type",
      header: t("txTable.headers.type"),
      render: (row) => (
        <AdminStatusBadge
          text={txTypeLabelMap[row.type] ?? row.type}
          tone={txTypeTone(row.type)}
          dot={false}
        />
      ),
    },
    {
      key: "status",
      header: t("txTable.headers.status"),
      render: (row) => (
        <AdminStatusBadge
          text={txStatusLabelMap[row.status] ?? row.status}
          tone={getStatusTone(row.status)}
        />
      ),
    },
    {
      key: "amount",
      header: t("txTable.headers.amount"),
      align: "right",
      sortable: true,
      render: (row) => {
        const sign = row.type === "deduct" ? "-" : "+"
        return (
          <span className={`font-mono text-sm ${row.type === "deduct" ? "text-rose-400" : "text-emerald-400"}`}>
            {sign}
            {row.type === "deduct"
              ? currency4Formatter.format(Math.abs(row.amount))
              : currencyFormatter.format(Math.abs(row.amount))}
          </span>
        )
      },
    },
    {
      key: "model",
      header: t("txTable.headers.model"),
      render: (row) =>
        row.model ? <span className="font-mono text-xs text-[var(--muted)]">{row.model}</span> : <span className="text-[var(--muted)]">—</span>,
    },
    {
      key: "description",
      header: t("txTable.headers.description"),
      render: (row) => <span className="text-xs text-[var(--muted)]">{row.description || "—"}</span>,
    },
    {
      key: "created_at",
      header: t("txTable.headers.date"),
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{dateFormatter.format(new Date(row.created_at))}</span>,
    },
  ]

  useEffect(() => {
    if (!policyData) return
    setRatioInput(String(policyData.credit_per_unit))
    setCurrencyInput(policyData.currency || "USD")
  }, [policyData])

  const handleSavePolicy = async () => {
    const ratio = Number(ratioInput)
    if (!Number.isFinite(ratio) || ratio <= 0 || isSavingPolicy) {
      setPolicyFeedback(t("rechargePolicy.feedback.invalidRatio"))
      return
    }

    setIsSavingPolicy(true)
    setPolicyFeedback(null)
    try {
      await updateAdminRechargePolicy({
        credit_per_unit: ratio,
        currency: currencyInput.trim().toUpperCase() || "USD",
      })
      await mutatePolicy()
      setPolicyFeedback(t("rechargePolicy.feedback.updated"))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("rechargePolicy.feedback.updateFailed")
      setPolicyFeedback(message)
    } finally {
      setIsSavingPolicy(false)
    }
  }

  return (
    <>
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("rechargePolicy.title")}</h3>
          <p className="text-xs text-[var(--muted)]">{t("rechargePolicy.description")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={ratioInput}
            onChange={(event) => setRatioInput(event.target.value)}
            placeholder={t("rechargePolicy.creditPerUnit")}
          />
          <Input
            type="text"
            value={currencyInput}
            onChange={(event) => setCurrencyInput(event.target.value)}
            placeholder={t("rechargePolicy.currency")}
          />
          <Button
            onClick={() => void handleSavePolicy()}
            disabled={isSavingPolicy}
            size="sm"
          >
            {isSavingPolicy ? t("rechargePolicy.saving") : t("rechargePolicy.save")}
          </Button>
        </div>
        {policyFeedback ? (
          <p className="mt-2 text-xs text-[var(--muted)]">{policyFeedback}</p>
        ) : null}
      </div>

      <div className="w-fit rounded-lg bg-white/5 p-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTab("quotas")}
          className={tab === "quotas" ? "bg-[var(--primary)]/20 text-[var(--primary)]" : ""}
        >
          {t("tabs.quotas")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTab("transactions")}
          className={tab === "transactions" ? "bg-[var(--primary)]/20 text-[var(--primary)]" : ""}
        >
          {t("tabs.transactions")}
        </Button>
      </div>

      {tab === "quotas" ? (
        <>
          <AdminStatCards stats={quotaStats} columns={4} />
          <AdminDataTable
            columns={quotaColumns}
            data={quotaRows}
            emptyMessage={
              quotasLoading
                ? t("empty.quotasLoading")
                : quotasError
                  ? t("empty.quotasFailed")
                  : t("empty.quotasNoData")
            }
          />
        </>
      ) : (
        <>
          <AdminFilterBar
            searchPlaceholder={t("filters.searchPlaceholder")}
            onSearch={setSearchQuery}
            onFilterChange={(key, value) => {
              if (key === "type") setTxTypeFilter(value)
              if (key === "status") setTxStatusFilter(value)
            }}
            filters={[
              {
                key: "type",
                label: t("filters.type"),
                options: [
                  { label: t("type.deduct"), value: "deduct" },
                  { label: t("type.recharge"), value: "recharge" },
                  { label: t("type.refund"), value: "refund" },
                  { label: t("type.adjust"), value: "adjust" },
                ],
              },
              {
                key: "status",
                label: t("filters.status"),
                options: [
                  { label: t("transactionStatus.committed"), value: "committed" },
                  { label: t("transactionStatus.pending"), value: "pending" },
                  { label: t("transactionStatus.reversed"), value: "reversed" },
                ],
              },
            ]}
          />
          <AdminDataTable
            columns={txColumns}
            data={filteredTxRows}
            emptyMessage={
              transactionsLoading
                ? t("empty.transactionsLoading")
                : transactionsError
                  ? t("empty.transactionsFailed")
                  : t("empty.transactionsNoData")
            }
            pageSize={15}
          />
        </>
      )}
    </>
  )
}
