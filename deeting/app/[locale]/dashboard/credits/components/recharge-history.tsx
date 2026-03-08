"use client"

import { useMemo, useState, type ReactNode } from "react"
import { CheckCircle2, Clock, Copy, Download, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDebounce } from "@/hooks/use-debounce"
import { exportCreditsRechargeOrdersCsv, type CreditsRechargeOrderItem } from "@/lib/api/credits"
import { cn } from "@/lib/utils"
import { useCreditsRechargeOrders } from "@/lib/swr/use-credits-recharge-orders"

type FilterValue = "success" | "failed" | "pending" | null
type SortState = { by: "time" | "amount"; direction: "desc" | "asc" }
const PAGE_SIZE = 10

const FILTERS: Array<{ value: FilterValue; key: string }> = [
  { value: null, key: "all" },
  { value: "success", key: "success" },
  { value: "pending", key: "pending" },
  { value: "failed", key: "failed" },
]

const PRESETS = ["last7Days", "last30Days", "thisMonth", "clear"] as const

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function getPresetRange(preset: (typeof PRESETS)[number]) {
  const today = new Date()
  const endDate = toIsoDate(today)

  if (preset === "clear") {
    return { startDate: "", endDate: "" }
  }
  if (preset === "thisMonth") {
    return {
      startDate: `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`,
      endDate,
    }
  }

  const offset = preset === "last7Days" ? 6 : 29
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - offset)
  return { startDate: toIsoDate(start), endDate }
}

export function RechargeHistory() {
  const t = useTranslations("credits")
  const [status, setStatus] = useState<FilterValue>(null)
  const [query, setQuery] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [isExporting, setIsExporting] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<CreditsRechargeOrderItem | null>(null)
  const [sort, setSort] = useState<SortState>({ by: "time", direction: "desc" })
  const debouncedQuery = useDebounce(query, 300)
  const { data, isLoading } = useCreditsRechargeOrders({
    limit,
    status,
    query: debouncedQuery.trim() || null,
    startDate: startDate || null,
    endDate: endDate || null,
    sortBy: sort.by,
    sortDirection: sort.direction,
  })
  const sortedOrders = useMemo(() => {
    const copy = [...(data?.items ?? [])]
    copy.sort((left, right) => {
      const leftValue = sort.by === "time" ? new Date(left.createdAt).getTime() : left.amount
      const rightValue = sort.by === "time" ? new Date(right.createdAt).getTime() : right.amount
      return sort.direction === "desc" ? rightValue - leftValue : leftValue - rightValue
    })
    return copy
  }, [data?.items, sort])

  const formatAmount = (value: number) =>
    value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const formatTime = (value?: string | null) => {
    if (!value) return "—"
    return new Date(value).toLocaleString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const exportRechargeOrders = async () => {
    setIsExporting(true)
    try {
      const blob = await exportCreditsRechargeOrdersCsv({
        status,
        query: query.trim() || null,
        startDate: startDate || null,
        endDate: endDate || null,
        sortBy: sort.by,
        sortDirection: sort.direction,
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      const filenameParts = ["recharge-orders"]
      if (status) filenameParts.push(status)
      if (query.trim()) filenameParts.push(query.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-"))
      if (startDate && endDate) filenameParts.push(`${startDate}-to-${endDate}`)
      else if (startDate) filenameParts.push(`from-${startDate}`)
      else if (endDate) filenameParts.push(`until-${endDate}`)
      else filenameParts.push(toIsoDate(new Date()))
      anchor.download = `${filenameParts.join("-")}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const range = getPresetRange(preset)
    setLimit(PAGE_SIZE)
    setStartDate(range.startDate)
    setEndDate(range.endDate)
  }

  const updateSort = (by: SortState["by"]) => {
    setSort((current) =>
      current.by === by
        ? { by, direction: current.direction === "desc" ? "asc" : "desc" }
        : { by, direction: "desc" }
    )
  }

  const copyText = async (value: string | null | undefined, label: string) => {
    if (!value) {
      toast.error(t("rechargeHistory.detail.copyFailed"))
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      toast.success(t("rechargeHistory.detail.copySuccess"), { description: label })
    } catch {
      toast.error(t("rechargeHistory.detail.copyFailed"))
    }
  }

  const exportReceipt = (order: CreditsRechargeOrderItem) => {
    const receipt = [
      `${t("rechargeHistory.detail.fields.order")}: ${order.outTradeNo}`,
      `${t("rechargeHistory.detail.fields.status")}: ${order.status.toUpperCase()}`,
      `${t("rechargeHistory.detail.fields.tradeStatus")}: ${order.tradeStatus ?? "—"}`,
      `${t("rechargeHistory.detail.fields.amount")}: ${formatAmount(order.amount)}`,
      `${t("rechargeHistory.detail.fields.credited")}: ${formatAmount(order.creditedAmount)}`,
      `${t("rechargeHistory.detail.fields.expectedCredited")}: ${formatAmount(order.expectedCreditedAmount)}`,
      `${t("rechargeHistory.detail.fields.currency")}: ${order.currency}`,
      `${t("rechargeHistory.detail.fields.channel")}: ${order.channel.toUpperCase()}`,
      `${t("rechargeHistory.detail.fields.tradeNo")}: ${order.tradeNo ?? "—"}`,
      `${t("rechargeHistory.detail.fields.failureReason")}: ${order.failureReason ?? "—"}`,
      `${t("rechargeHistory.detail.fields.createdAt")}: ${formatTime(order.createdAt)}`,
      `${t("rechargeHistory.detail.fields.settledAt")}: ${formatTime(order.settledAt)}`,
    ].join("\n")

    const blob = new Blob([receipt], { type: "text/plain;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `recharge-receipt-${order.outTradeNo}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-[var(--card)] rounded-2xl border border-[var(--muted)]/10 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--muted)]/10 flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[var(--foreground)]">{t("rechargeHistory.title")}</h3>
            <p className="text-xs text-[var(--muted)] mt-1">{t("rechargeHistory.subtitle")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={exportRechargeOrders} disabled={isExporting}>
            <Download className="h-4 w-4" />
            {isExporting ? t("rechargeHistory.exportingCSV") : t("rechargeHistory.exportCSV")}
          </Button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3">
            <Input
              value={query}
              placeholder={t("rechargeHistory.searchPlaceholder")}
              onChange={(event) => {
                setLimit(PAGE_SIZE)
                setQuery(event.target.value)
              }}
              className="w-full md:w-[280px]"
            />

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filter) => (
                <Button
                  key={filter.key}
                  size="sm"
                  variant={status === filter.value ? "default" : "outline"}
                  onClick={() => {
                    setLimit(PAGE_SIZE)
                    setStatus(filter.value)
                  }}
                >
                  {t(`rechargeHistory.filters.${filter.key}`)}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button key={preset} size="sm" variant="outline" onClick={() => applyPreset(preset)}>
                  {t(`rechargeHistory.presets.${preset}`)}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => updateSort("time")}>
                {t("rechargeHistory.sorts.time")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => updateSort("amount")}>
                {t("rechargeHistory.sorts.amount")}
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              <span>{t("rechargeHistory.filters.startDate")}</span>
              <Input
                aria-label={t("rechargeHistory.filters.startDate")}
                type="date"
                value={startDate}
                onChange={(event) => {
                  setLimit(PAGE_SIZE)
                  setStartDate(event.target.value)
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              <span>{t("rechargeHistory.filters.endDate")}</span>
              <Input
                aria-label={t("rechargeHistory.filters.endDate")}
                type="date"
                value={endDate}
                onChange={(event) => {
                  setLimit(PAGE_SIZE)
                  setEndDate(event.target.value)
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="px-2 md:px-4 pb-2">
        {sortedOrders.length === 0 ? (
          <div className="px-6 py-6 text-xs text-[var(--muted)]">{isLoading ? "—" : t("rechargeHistory.empty")}</div>
        ) : (
          <Table>
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead>{t("rechargeHistory.status")}</TableHead>
                <TableHead>{t("rechargeHistory.order")}</TableHead>
                <TableHead className="text-right">{t("rechargeHistory.time")}</TableHead>
                <TableHead className="text-right">{t("rechargeHistory.amount")}</TableHead>
                <TableHead className="text-right">{t("rechargeHistory.credited")}</TableHead>
                <TableHead className="text-right">{t("rechargeHistory.actions.viewDetails")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOrders.map((order) => (
                <RechargeHistoryRow
                  key={order.id}
                  order={order}
                  formatAmount={formatAmount}
                  formatTime={formatTime}
                  tradeNoLabel={t("rechargeHistory.labels.tradeNo")}
                  channelLabel={t("rechargeHistory.labels.channel")}
                  settledAtLabel={t("rechargeHistory.labels.settledAt")}
                  viewDetailsLabel={t("rechargeHistory.actions.viewDetails")}
                  statusLabel={t("rechargeHistory.status")}
                  timeLabel={t("rechargeHistory.time")}
                  amountLabel={t("rechargeHistory.amount")}
                  creditedLabel={t("rechargeHistory.credited")}
                  onViewDetails={() => setSelectedOrder(order)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {data?.nextOffset != null ? (
        <div className="border-t border-[var(--muted)]/10 px-6 py-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
            {t("rechargeHistory.loadMore")}
          </Button>
        </div>
      ) : null}

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rechargeHistory.detail.title")}</DialogTitle>
            <DialogDescription>{t("rechargeHistory.detail.description")}</DialogDescription>
          </DialogHeader>

          {selectedOrder ? (
            <div className="grid gap-3 text-sm">
              <DetailRow
                label={t("rechargeHistory.detail.fields.order")}
                value={selectedOrder.outTradeNo}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => void copyText(selectedOrder.outTradeNo, t("rechargeHistory.actions.copyOrder"))}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    {t("rechargeHistory.actions.copyOrder")}
                  </Button>
                }
              />
              <DetailRow label={t("rechargeHistory.detail.fields.status")} value={selectedOrder.status.toUpperCase()} />
              <DetailRow label={t("rechargeHistory.detail.fields.tradeStatus")} value={selectedOrder.tradeStatus ?? "—"} />
              <DetailRow label={t("rechargeHistory.detail.fields.amount")} value={formatAmount(selectedOrder.amount)} />
              <DetailRow label={t("rechargeHistory.detail.fields.credited")} value={formatAmount(selectedOrder.creditedAmount)} />
              <DetailRow label={t("rechargeHistory.detail.fields.expectedCredited")} value={formatAmount(selectedOrder.expectedCreditedAmount)} />
              <DetailRow label={t("rechargeHistory.detail.fields.currency")} value={selectedOrder.currency} />
              <DetailRow label={t("rechargeHistory.detail.fields.channel")} value={selectedOrder.channel.toUpperCase()} />
              <DetailRow
                label={t("rechargeHistory.detail.fields.tradeNo")}
                value={selectedOrder.tradeNo ?? "—"}
                action={
                  selectedOrder.tradeNo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => void copyText(selectedOrder.tradeNo, t("rechargeHistory.actions.copyTradeNo"))}
                    >
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      {t("rechargeHistory.actions.copyTradeNo")}
                    </Button>
                  ) : null
                }
              />
              <DetailRow label={t("rechargeHistory.detail.fields.failureReason")} value={selectedOrder.failureReason ?? "—"} />
              <DetailRow label={t("rechargeHistory.detail.fields.createdAt")} value={formatTime(selectedOrder.createdAt)} />
              <DetailRow label={t("rechargeHistory.detail.fields.settledAt")} value={formatTime(selectedOrder.settledAt)} />
            </div>
          ) : null}

          {selectedOrder ? (
            <div className="pt-3 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => exportReceipt(selectedOrder)}>
                {t("rechargeHistory.actions.exportReceipt")}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RechargeHistoryRow({
  order,
  formatAmount,
  formatTime,
  tradeNoLabel,
  channelLabel,
  settledAtLabel,
  viewDetailsLabel,
  statusLabel,
  timeLabel,
  amountLabel,
  creditedLabel,
  onViewDetails,
}: {
  order: CreditsRechargeOrderItem
  formatAmount: (value: number) => string
  formatTime: (value?: string | null) => string
  tradeNoLabel: string
  channelLabel: string
  settledAtLabel: string
  viewDetailsLabel: string
  statusLabel: string
  timeLabel: string
  amountLabel: string
  creditedLabel: string
  onViewDetails: () => void
}) {
  const StatusIcon = { success: CheckCircle2, failed: XCircle, pending: Clock }[order.status]
  const statusColor = { success: "text-emerald-500", failed: "text-red-500", pending: "text-amber-500" }[order.status]
  const badgeClassName = {
    success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
    failed: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
    pending: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300",
  }[order.status]

  return (
    <TableRow data-testid="recharge-order-row" className="block border-b md:table-row">
      <TableCell className="block border-0 px-4 pb-2 pt-4 md:table-cell md:px-2 md:py-2">
        <div className="flex items-center gap-3 min-w-[100px]">
          <span className="text-xs text-[var(--muted)] md:hidden">{statusLabel}</span>
          <StatusIcon className={cn("w-4 h-4", statusColor)} />
          <Badge variant="outline" className={cn("text-[10px] font-mono", badgeClassName)}>
            {order.status.toUpperCase()}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="block min-w-0 border-0 px-4 py-2 align-top md:table-cell md:min-w-[280px] md:px-2">
        <p data-testid="recharge-order-number" className="text-sm font-medium text-[var(--foreground)] truncate">{order.outTradeNo}</p>
        <div className="mt-1 space-y-0.5 text-xs text-[var(--muted)]">
          <p>{`${tradeNoLabel}: ${order.tradeNo ?? "—"}`}</p>
          <p>{`${channelLabel}: ${order.channel.toUpperCase()}`}</p>
          <p>{`${settledAtLabel}: ${formatTime(order.settledAt)}`}</p>
          {order.failureReason ? <p className="text-red-500">{order.failureReason}</p> : null}
        </div>
      </TableCell>
      <TableCell className="block border-0 px-4 py-1 text-sm text-[var(--muted)] md:table-cell md:px-2 md:py-2 md:text-right">
        <span className="mr-2 text-xs md:hidden">{timeLabel}</span>
        {formatTime(order.createdAt)}
      </TableCell>
      <TableCell className="block border-0 px-4 py-1 text-sm font-mono text-[var(--foreground)] md:table-cell md:px-2 md:py-2 md:text-right">
        <span className="mr-2 text-xs font-sans text-[var(--muted)] md:hidden">{amountLabel}</span>
        {formatAmount(order.amount)}
      </TableCell>
      <TableCell className="block border-0 px-4 py-1 text-sm font-mono font-bold text-[var(--foreground)] md:table-cell md:px-2 md:py-2 md:text-right">
        <span className="mr-2 text-xs font-sans text-[var(--muted)] md:hidden">{creditedLabel}</span>
        {formatAmount(order.creditedAmount)}
      </TableCell>
      <TableCell className="block border-0 px-4 pb-4 pt-2 text-left align-top md:table-cell md:px-2 md:py-2 md:text-right">
        <Button className="h-7 px-2" size="sm" variant="ghost" onClick={onViewDetails}>
          {viewDetailsLabel}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function DetailRow({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <div className="grid gap-2 md:grid-cols-[140px_1fr_auto] md:items-start">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
      {action ? <div className="md:justify-self-end">{action}</div> : null}
    </div>
  )
}