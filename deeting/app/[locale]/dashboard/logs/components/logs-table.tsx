"use client"

import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/shadcn/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/shadcn/table"
import { getNormalizedCacheSource } from "@/lib/gateway-log/cache-metrics"
import type { GatewayLogDTO } from "@/types/gateway_log"

interface LogsTableProps {
  items: GatewayLogDTO[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (log: GatewayLogDTO) => void
}

export function LogsTable({ items, isLoading, selectedId, onSelect }: LogsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[120px]">状态</TableHead>
          <TableHead>模型</TableHead>
          <TableHead className="w-[180px]">时间</TableHead>
          <TableHead className="w-[180px]">延迟</TableHead>
          <TableHead className="w-[180px]">成本</TableHead>
          <TableHead className="w-[150px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
              暂无日志数据
            </TableCell>
          </TableRow>
        ) : null}

        {items.map((item) => {
          const isSelected = selectedId === item.id
          const cacheSource = getNormalizedCacheSource(item)

          return (
            <TableRow
              key={item.id}
              className={isSelected ? "bg-primary/5" : undefined}
              onClick={() => onSelect(item)}
            >
              <TableCell>
                <Badge variant="secondary" className={statusBadgeTone(item.status_code, item.error_code)}>
                  {item.status_code}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.model}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{shortId(item.id)}</span>
                    {item.error_code ? <Badge variant="outline">{item.error_code}</Badge> : null}
                    {item.is_cached ? (
                      <Badge variant="outline">
                        {cacheSource === "provider_reported" ? "Provider Cache" : "Cache Hit"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell>{formatDateTime(item.created_at)}</TableCell>
              <TableCell>
                <div className="font-mono text-sm">{item.duration_ms}ms</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {item.ttft_ms != null ? `TTFT ${item.ttft_ms}ms` : "TTFT -"}
                </div>
              </TableCell>
              <TableCell>
                <div className="font-mono text-sm">${formatCurrency(item.cost_user)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{item.total_tokens.toLocaleString()} tokens</div>
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                  查看详情
                  <ChevronRight className="size-3.5" />
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
}

function shortId(value: string) {
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function statusBadgeTone(statusCode: number, errorCode?: string | null) {
  if (statusCode <= 0 && errorCode) return "text-red-700"
  if (statusCode >= 500) return "text-red-700"
  if (statusCode >= 400) return "text-amber-700"
  if (statusCode >= 300) return "text-blue-700"
  return "text-emerald-700"
}
