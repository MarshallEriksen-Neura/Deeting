"use client"

import { Crosshair } from "lucide-react"

interface MonitorEmptyStateProps {
  onCreate: () => void
}

export function MonitorEmptyState({ onCreate }: MonitorEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
        <Crosshair className="h-8 w-8 text-[var(--primary)] opacity-60" />
      </div>
      <h3 className="text-base font-semibold text-[var(--foreground)]">
        尚无寻猎任务
      </h3>
      <p className="mt-1.5 max-w-sm text-center text-sm text-[var(--muted)]">
        创建你的第一个主动寻猎任务，系统将自动孵化专属 AI
        助手，持续监控并通过 MAB 算法自我进化研判策略
      </p>
      <button
        onClick={onCreate}
        className="mt-6 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[var(--primary)]/20 transition-all hover:shadow-xl hover:shadow-[var(--primary)]/30 hover:-translate-y-0.5"
      >
        新建寻猎任务
      </button>
    </div>
  )
}
