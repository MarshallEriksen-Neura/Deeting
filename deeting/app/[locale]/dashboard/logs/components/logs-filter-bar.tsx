"use client"

import { type ReactNode } from "react"
import { RefreshCw, RotateCcw, Search } from "lucide-react"

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
  activeCount: number
  onChange: (next: LogsFilters) => void
  onRefresh: () => void
  onReset: () => void
  refreshing: boolean
}

const PAGE_SIZE_OPTIONS = ["20", "50", "100"] as const
const STATUS_OPTIONS = ["all", "200", "400", "401", "403", "404", "429", "500", "502", "503", "504"] as const
const CONTROL_CLASS =
  "h-10 rounded-[14px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink)] shadow-none placeholder:text-[var(--ink-3)]"

export function LogsFilterBar({
  value,
  activeCount,
  onChange,
  onRefresh,
  onReset,
  refreshing,
}: LogsFilterBarProps) {
  return (
    <div className="border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="ws-meta">查询视图</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="ws-pane-title text-[var(--ink)]">筛选与时间窗口</div>
            <span
              className={
                activeCount > 0
                  ? "inline-flex items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] text-[var(--accent-ink)]"
                  : "inline-flex items-center rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-2.5 py-1 text-[11px] text-[var(--ink-3)]"
              }
            >
              {activeCount > 0 ? `已启用 ${activeCount} 个条件` : "当前为全部流量"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-[12px] border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
            disabled={activeCount === 0}
            onClick={onReset}
          >
            <RotateCcw className="size-4" />
            重置
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-[12px] border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
            刷新
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <section className="rounded-[22px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-3">
          <div className="ws-meta mb-3">请求筛选</div>
          <div className="grid gap-3 md:grid-cols-2">
            <FilterField label="模型 / 搜索">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
                <Input
                  value={value.model}
                  onChange={(event) => onChange({ ...value, model: event.target.value })}
                  placeholder="按模型名筛选"
                  className={`${CONTROL_CLASS} pl-9`}
                />
              </div>
            </FilterField>

            <FilterField label="状态码">
              <Select value={value.statusCode} onValueChange={(statusCode) => onChange({ ...value, statusCode })}>
                <SelectTrigger className={CONTROL_CLASS}>
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
            </FilterField>

            <FilterField label="缓存">
              <Select
                value={value.cache}
                onValueChange={(cache) => onChange({ ...value, cache: cache as LogsFilters["cache"] })}
              >
                <SelectTrigger className={CONTROL_CLASS}>
                  <SelectValue placeholder="缓存" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部缓存状态</SelectItem>
                  <SelectItem value="hit">命中</SelectItem>
                  <SelectItem value="miss">未命中</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="错误码">
              <Input
                value={value.errorCode}
                onChange={(event) => onChange({ ...value, errorCode: event.target.value })}
                placeholder="如 rate_limit"
                className={CONTROL_CLASS}
              />
            </FilterField>
          </div>
        </section>

        <section className="rounded-[22px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-3">
          <div className="ws-meta mb-3">时间与分页</div>
          <div className="grid gap-3 md:grid-cols-2">
            <FilterField label="开始时间">
              <Input
                type="datetime-local"
                value={value.start}
                onChange={(event) => onChange({ ...value, start: event.target.value })}
                className={CONTROL_CLASS}
              />
            </FilterField>

            <FilterField label="结束时间">
              <Input
                type="datetime-local"
                value={value.end}
                onChange={(event) => onChange({ ...value, end: event.target.value })}
                className={CONTROL_CLASS}
              />
            </FilterField>

            <div className="md:col-span-2">
              <FilterField label="分页">
                <Select value={value.pageSize} onValueChange={(pageSize) => onChange({ ...value, pageSize })}>
                  <SelectTrigger className={CONTROL_CLASS}>
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
              </FilterField>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="ws-meta">{label}</span>
      {children}
    </div>
  )
}
