"use client"

import { Bell, Plus, RefreshCw, ShieldCheck, Sparkles, Workflow } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"

export function NotificationChannelsHeader({
  stats,
  onRefresh,
  onCreate,
}: {
  stats: {
    total: number
    active: number
    runtimeReady: number
    available: number
  }
  onRefresh: () => void
  onCreate: () => void
}) {
  return (
    <section className="border-b border-[color:var(--border)] bg-[color:var(--card)] px-6 py-8 md:px-10">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Bell className="size-3.5" />
            </div>
            <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Notification Matrix
            </span>
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              通知出口与运行态
            </h1>
            <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              集成通知出口管理、桌面 IM 运行态观察与微信配对。所有投递任务将根据此处定义的通道活性与优先级进行分发。
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              variant="ios-primary"
              size="sm"
              onClick={onCreate}
              className="h-9 px-5 font-medium shadow-none"
            >
              <Plus className="mr-2 size-4" />
              新增通知渠道
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-9 border-[color:var(--border)] bg-transparent px-4 font-medium transition-colors hover:bg-muted"
            >
              <RefreshCw className="mr-2 size-3.5" />
              刷新运行态
            </Button>
          </div>
        </div>

        <div className="grid shrink-0 gap-px overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-2 lg:grid-cols-4">
          <HeroMetric label="Total Channels" value={String(stats.total)} />
          <HeroMetric label="Active" value={String(stats.active)} />
          <HeroMetric label="Runtime Ready" value={String(stats.runtimeReady)} />
          <HeroMetric label="Available" value={String(stats.available)} />
        </div>
      </div>
    </section>
  )
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[color:var(--card)] p-4 min-w-[140px]">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
    </div>
  )
}
