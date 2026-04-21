"use client"

import * as React from "react"
import { Badge } from "@/components/ui/shadcn/badge"
import { ScrollArea } from "@/components/ui/shadcn/scroll-area"

type BindingPanelProps = {
  title: string
  description?: string
  count: number
  headerAction?: React.ReactNode
  toolbar?: React.ReactNode
  scrollHeight?: string
  children: React.ReactNode
}

export function BindingPanel({
  title,
  description,
  count,
  headerAction,
  toolbar,
  scrollHeight = "h-[320px]",
  children,
}: BindingPanelProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--hairline-subtle)] bg-[var(--panel-bg-inset)]/40 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <p className="ws-control text-sm font-bold text-[var(--ink-1)]">{title}</p>
          {description ? (
            <p className="ws-caption text-[11px] opacity-60 leading-snug">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant="secondary"
            className="ws-num h-6 px-2 text-[10px] font-bold tabular-nums bg-[var(--panel-bg)] border border-[var(--hairline)] text-[var(--ink-2)]"
          >
            {count}
          </Badge>
          {headerAction}
        </div>
      </header>

      {toolbar ? (
        <div className="border-b border-[var(--hairline-subtle)] bg-[var(--panel-bg)]/40 px-4 py-3">
          {toolbar}
        </div>
      ) : null}

      <ScrollArea className={`${scrollHeight} px-4 py-3`}>{children}</ScrollArea>
    </div>
  )
}
