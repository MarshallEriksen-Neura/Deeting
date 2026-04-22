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
    <section className="relative overflow-hidden rounded-[34px] border border-[color:var(--hairline)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--panel-bg)_90%,white_10%)_0%,color-mix(in_srgb,var(--accent-soft)_52%,var(--panel-bg)_48%)_100%)] shadow-[var(--elev-floating)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--accent-strong)_38%,white_62%),transparent)]" />
        <div className="absolute -left-12 top-0 h-40 w-40 rounded-full bg-[color:var(--accent-soft)] blur-3xl" />
        <div className="absolute right-0 top-10 h-40 w-40 rounded-full bg-[color:var(--info-soft)] blur-3xl" />
      </div>

      <div className="relative grid gap-8 px-6 py-7 lg:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)] lg:px-8 lg:py-8">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--accent-border)] bg-[color:var(--panel-bg)]/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-ink)] shadow-[var(--ios-button-shadow-soft)]">
            <Bell className="size-3.5" />
            Desktop Notification Matrix
          </div>

          <div className="space-y-3">
            <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-[-0.05em] text-[color:var(--ink)] md:text-5xl">
              让通知出口、桌面 IM 运行态和微信配对在同一页里说清楚
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-[color:var(--ink-3)] md:text-base">
              这一页现在不只是配置表单。它同时承担本地通知出口管理、桌面 IM
              运行态观察、以及微信联系人接入的主入口，所有颜色和层级都回到全局 token。
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {[
              { icon: Workflow, label: "结构化配置" },
              { icon: ShieldCheck, label: "微信配对审批" },
              { icon: Sparkles, label: "桌面运行态可见" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/76 px-3.5 py-2 text-xs font-medium text-[color:var(--ink-2)] shadow-[var(--ios-button-shadow-soft)]"
              >
                <Icon className="size-3.5 text-[color:var(--accent-strong)]" />
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="ios-primary" onClick={onCreate}>
              <Plus className="size-4" />
              新增通知渠道
            </Button>
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw className="size-4" />
              刷新运行态
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <HeroMetric
            label="总渠道数"
            value={String(stats.total)}
            hint="当前桌面端已注册的通知出口"
          />
          <HeroMetric
            label="启用中"
            value={String(stats.active)}
            hint="仍然允许参与通知投递的渠道"
          />
          <HeroMetric
            label="运行态就绪"
            value={String(stats.runtimeReady)}
            hint="桌面 IM profile 当前可用的渠道数"
          />
          <HeroMetric
            label="还能新增"
            value={String(stats.available)}
            hint="当前还没创建、仍可直接接入的渠道类型"
          />
        </div>
      </div>
    </section>
  )
}

function HeroMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-[28px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/82 p-4 shadow-[var(--ios-button-shadow-soft)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-4)]">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[color:var(--ink)]">
        {value}
      </div>
      <div className="mt-2 text-xs leading-5 text-[color:var(--ink-3)]">{hint}</div>
    </div>
  )
}
