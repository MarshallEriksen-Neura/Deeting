"use client"

import { RefreshCw, Search } from "lucide-react"

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
    <div className="border-b border-[var(--hairline)] bg-[var(--panel-bg)]/90 px-4 py-4 backdrop-blur-xl">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto]">
        <div className="space-y-2">
          <span className="ws-meta">模型 / 搜索</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
            <Input
              value={value.model}
              onChange={(event) => onChange({ ...value, model: event.target.value })}
              placeholder="按模型名筛选"
              className="h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] pl-9 text-[var(--ink)] shadow-none placeholder:text-[var(--ink-3)]"
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="ws-meta">状态码</span>
          <Select value={value.statusCode} onValueChange={(statusCode) => onChange({ ...value, statusCode })}>
            <SelectTrigger className="h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)] shadow-none">
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

        <div className="space-y-2">
          <span className="ws-meta">缓存</span>
          <Select
            value={value.cache}
            onValueChange={(cache) => onChange({ ...value, cache: cache as LogsFilters["cache"] })}
          >
            <SelectTrigger className="h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)] shadow-none">
              <SelectValue placeholder="缓存" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部缓存状态</SelectItem>
              <SelectItem value="hit">命中</SelectItem>
              <SelectItem value="miss">未命中</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <span className="ws-meta">错误码</span>
          <Input
            value={value.errorCode}
            onChange={(event) => onChange({ ...value, errorCode: event.target.value })}
            placeholder="如 rate_limit"
            className="h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)] shadow-none placeholder:text-[var(--ink-3)]"
          />
        </div>

        <div className="space-y-2">
          <span className="ws-meta">操作</span>
          <Button
            type="button"
            variant="outline"
            size="default"
            className="h-10 w-full rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
            onClick={onRefresh}
          >
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
            刷新
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
        <div className="space-y-2">
          <span className="ws-meta">开始时间</span>
          <Input
            type="datetime-local"
            value={value.start}
            onChange={(event) => onChange({ ...value, start: event.target.value })}
            className="h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)] shadow-none"
          />
        </div>

        <div className="space-y-2">
          <span className="ws-meta">结束时间</span>
          <Input
            type="datetime-local"
            value={value.end}
            onChange={(event) => onChange({ ...value, end: event.target.value })}
            className="h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)] shadow-none"
          />
        </div>

        <div className="space-y-2">
          <span className="ws-meta">分页</span>
          <Select value={value.pageSize} onValueChange={(pageSize) => onChange({ ...value, pageSize })}>
            <SelectTrigger className="h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)] shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  每页 {option} 条
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
