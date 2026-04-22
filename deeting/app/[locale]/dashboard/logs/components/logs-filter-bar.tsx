"use client"

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

const STATUS_OPTIONS = ["all", "200", "400", "401", "403", "404", "429", "500", "502", "503", "504"] as const

const BRUTAL_INPUT = "h-8 rounded-none border border-[var(--hairline)] bg-transparent px-2 text-[11px] font-mono text-[var(--ink)] placeholder:text-[var(--ink-4)] focus-visible:border-[var(--accent-strong)] focus-visible:ring-0 shadow-none"

export function LogsFilterBar({
  value,
  activeCount,
  onChange,
  onRefresh,
  onReset,
  refreshing,
}: LogsFilterBarProps) {
  return (
    <div className="border-b border-[var(--hairline)] bg-[var(--background)] p-2">
      <div className="flex flex-wrap items-center gap-4">
        {/* Compact Search */}
        <div className="relative w-48">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-4)]" />
          <Input
            value={value.model}
            onChange={(event) => onChange({ ...value, model: event.target.value })}
            placeholder="FILTER_MODEL"
            className={`${BRUTAL_INPUT} pl-8`}
          />
        </div>

        {/* Status Select */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-tight">Status:</span>
          <Select value={value.statusCode} onValueChange={(statusCode) => onChange({ ...value, statusCode })}>
            <SelectTrigger className={`${BRUTAL_INPUT} w-[80px]`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-[var(--hairline)] bg-[var(--popover)] font-mono text-[var(--ink-2)]">
              {STATUS_OPTIONS.map((code) => (
                <SelectItem key={code} value={code} className="focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)]">
                  {code.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Cache Select */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-tight">Cache:</span>
          <Select
            value={value.cache}
            onValueChange={(cache) => onChange({ ...value, cache: cache as LogsFilters["cache"] })}
          >
            <SelectTrigger className={`${BRUTAL_INPUT} w-[100px]`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-[var(--hairline)] bg-[var(--popover)] font-mono text-[var(--ink-2)]">
              <SelectItem value="all" className="focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)]">ALL</SelectItem>
              <SelectItem value="hit" className="focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)]">HIT</SelectItem>
              <SelectItem value="miss" className="focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)]">MISS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Time Inputs */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-tight">Window:</span>
          <Input
            type="datetime-local"
            value={value.start}
            onChange={(event) => onChange({ ...value, start: event.target.value })}
            className={`${BRUTAL_INPUT} w-[180px]`}
          />
          <span className="text-[var(--ink-4)]">{"->"}</span>
          <Input
            type="datetime-local"
            value={value.end}
            onChange={(event) => onChange({ ...value, end: event.target.value })}
            className={`${BRUTAL_INPUT} w-[180px]`}
          />
        </div>

        {/* Action Buttons */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-none border border-[var(--hairline)] bg-transparent px-3 text-[10px] font-bold text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] uppercase shadow-none"
            disabled={activeCount === 0}
            onClick={onReset}
          >
            <RotateCcw className="mr-1 size-3" />
            Reset
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-none border border-[var(--ok-border)] bg-[var(--ok-soft)] px-3 text-[10px] font-bold text-[var(--ok)] hover:bg-[var(--ok)] hover:text-white uppercase shadow-none"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={refreshing ? "mr-1 size-3 animate-spin" : "mr-1 size-3"} />
            Refresh
          </Button>
        </div>
      </div>
    </div>
  )
}
