"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { CreditCard } from "lucide-react"
import {
  AdminPageShell,
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  DonutChart,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import {
  fetchAdminBillingSummary,
  fetchAdminBillingTransactions,
  fetchAdminQuotas,
  type BillingTransactionItem,
  type TenantQuotaItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const [tab, setTab] = useState<"quotas" | "transactions">("quotas")
  const [searchQuery, setSearchQuery] = useState("")
  const [txTypeFilter, setTxTypeFilter] = useState("")
  const [txStatusFilter, setTxStatusFilter] = useState("")

  const { data: quotasData, error: quotasError, isLoading: quotasLoading } = useSWR(
    "/api/v1/admin/quotas?limit=100",
    () => fetchAdminQuotas({ limit: 100 })
  )

  const { data: summaryData } = useSWR(
    "/api/v1/admin/billing/summary",
    fetchAdminBillingSummary
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

  const quotaStats: StatCardData[] = [
    {
      label: "Total Balance",
      value: `$${totalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      color: "emerald",
    },
    {
      label: "Monthly Profit",
      value: `$${(summaryData?.profit ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      color: (summaryData?.profit ?? 0) >= 0 ? "teal" : "rose",
      subtitle: `${summaryData?.transaction_count ?? 0} transactions`,
    },
    { label: "Active Tenants", value: activeTenants, color: "primary" },
    {
      label: "Low Balance",
      value: lowBalance,
      color: lowBalance > 0 ? "rose" : "emerald",
    },
  ]

  const quotaColumns: ColumnDef<TenantQuotaItem>[] = [
    {
      key: "tenant_id",
      header: "Tenant",
      sortable: true,
      render: (row) => <span className="font-mono text-xs text-[var(--foreground)]">{shortId(row.tenant_id)}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      sortable: true,
      render: (row) => (
        <span className={`font-mono text-sm ${row.balance < 100 ? "text-rose-400" : "text-emerald-400"}`}>
          ${row.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "credit_limit",
      header: "Credit Limit",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">${row.credit_limit.toLocaleString()}</span>,
    },
    {
      key: "daily_used",
      header: "Daily",
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
            {row.daily_quota > 0 ? `${((row.daily_used / row.daily_quota) * 100).toFixed(0)}%` : "0%"}
          </span>
        </div>
      ),
    },
    {
      key: "monthly_used",
      header: "Monthly",
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
              ? `${((row.monthly_used / row.monthly_quota) * 100).toFixed(0)}%`
              : "0%"}
          </span>
        </div>
      ),
    },
    {
      key: "rpm_limit",
      header: "RPM",
      render: (row) => <span className="font-mono text-xs">{row.rpm_limit}</span>,
    },
    {
      key: "is_active",
      header: "Active",
      render: (row) => <AdminStatusBadge text={row.is_active ? "Active" : "Inactive"} tone={row.is_active ? "success" : "error"} />,
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
      header: "Trace ID",
      render: (row) => <span className="font-mono text-[10px] text-[var(--muted)]">{row.trace_id.slice(0, 16)}...</span>,
    },
    {
      key: "tenant_id",
      header: "Tenant",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.tenant_id)}</span>,
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <AdminStatusBadge text={row.type} tone={txTypeTone(row.type)} dot={false} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortable: true,
      render: (row) => (
        <span className={`font-mono text-sm ${row.type === "deduct" ? "text-rose-400" : "text-emerald-400"}`}>
          {row.type === "deduct" ? "-" : "+"}${row.amount.toFixed(row.type === "deduct" ? 4 : 2)}
        </span>
      ),
    },
    {
      key: "model",
      header: "Model",
      render: (row) =>
        row.model ? <span className="font-mono text-xs text-[var(--muted)]">{row.model}</span> : <span className="text-[var(--muted)]">—</span>,
    },
    {
      key: "description",
      header: "Description",
      render: (row) => <span className="text-xs text-[var(--muted)]">{row.description || "—"}</span>,
    },
    {
      key: "created_at",
      header: "Date",
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{new Date(row.created_at).toLocaleDateString()}</span>,
    },
  ]

  return (
    <AdminPageShell title="Billing & Quotas" description="Manage tenant quotas and billing transactions" icon={CreditCard}>
      <div className="w-fit rounded-lg bg-white/5 p-1">
        <button
          onClick={() => setTab("quotas")}
          className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === "quotas" ? "bg-[var(--primary)]/20 text-[var(--primary)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
        >
          Quotas
        </button>
        <button
          onClick={() => setTab("transactions")}
          className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === "transactions" ? "bg-[var(--primary)]/20 text-[var(--primary)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
        >
          Transactions
        </button>
      </div>

      {tab === "quotas" ? (
        <>
          <AdminStatCards stats={quotaStats} columns={4} />
          <AdminDataTable
            columns={quotaColumns}
            data={quotaRows}
            emptyMessage={quotasLoading ? "Loading quotas..." : quotasError ? "Failed to load quotas" : "No tenants found"}
          />
        </>
      ) : (
        <>
          <AdminFilterBar
            searchPlaceholder="Search transactions..."
            onSearch={setSearchQuery}
            onFilterChange={(key, value) => {
              if (key === "type") setTxTypeFilter(value)
              if (key === "status") setTxStatusFilter(value)
            }}
            filters={[
              { key: "type", label: "Type", options: [{ label: "Deduct", value: "deduct" }, { label: "Recharge", value: "recharge" }, { label: "Refund", value: "refund" }, { label: "Adjust", value: "adjust" }] },
              { key: "status", label: "Status", options: [{ label: "Committed", value: "committed" }, { label: "Pending", value: "pending" }, { label: "Reversed", value: "reversed" }] },
            ]}
          />
          <AdminDataTable
            columns={txColumns}
            data={filteredTxRows}
            emptyMessage={transactionsLoading ? "Loading transactions..." : transactionsError ? "Failed to load transactions" : "No transactions found"}
            pageSize={15}
          />
        </>
      )}
    </AdminPageShell>
  )
}
