"use client"

import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { Input } from "@/components/ui/shadcn/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select"

export type LogsFilters = {
  model: string
  statusCode: string
  cache: "all" | "hit" | "miss"
  errorCode: string
  start: string
  end: string
  pageSize: string
}

interface LogsFilterBarProps {
  value: LogsFilters
  onChange: (next: LogsFilters) => void
  onRefresh: () => void
  refreshing: boolean
}

const PAGE_SIZE_OPTIONS = ["20", "50", "100"] as const
const STATUS_OPTIONS = ["all", "200", "400", "401", "403", "404", "429", "500", "502", "503", "504"] as const

export function LogsFilterBar({ value, onChange, onRefresh, refreshing }: LogsFilterBarProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <Input
            value={value.model}
            onChange={(event) => onChange({ ...value, model: event.target.value })}
            placeholder="按模型筛选"
          />
        </div>

        <div className="lg:col-span-2">
          <Select value={value.statusCode} onValueChange={(statusCode) => onChange({ ...value, statusCode })}>
            <SelectTrigger>
              <SelectValue placeholder="状态码" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((code) => (
                <SelectItem key={code} value={code}>
                  {code === "all" ? "全部状态码" : code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="lg:col-span-2">
          <Select
            value={value.cache}
            onValueChange={(cache) => onChange({ ...value, cache: cache as LogsFilters["cache"] })}
          >
            <SelectTrigger>
              <SelectValue placeholder="缓存" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部缓存状态</SelectItem>
              <SelectItem value="hit">命中</SelectItem>
              <SelectItem value="miss">未命中</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="lg:col-span-2">
          <Input
            value={value.errorCode}
            onChange={(event) => onChange({ ...value, errorCode: event.target.value })}
            placeholder="错误码"
          />
        </div>

        <div className="lg:col-span-3">
          <div className="grid grid-cols-2 gap-3">
            <Input type="datetime-local" value={value.start} onChange={(event) => onChange({ ...value, start: event.target.value })} />
            <Input type="datetime-local" value={value.end} onChange={(event) => onChange({ ...value, end: event.target.value })} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>每页</span>
          <Select value={value.pageSize} onValueChange={(pageSize) => onChange({ ...value, pageSize })}>
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          刷新
        </Button>
      </div>
    </div>
  )
}
