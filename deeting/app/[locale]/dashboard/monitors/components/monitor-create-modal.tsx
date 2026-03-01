"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Crosshair,
  Clock,
  Cpu,
  Sparkles,
  Plus,
  X,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { MonitorTask, MonitorTaskCreateInput } from "@/lib/api/monitors"
import { createMonitorTask, updateMonitorTask } from "@/lib/api/monitors"

interface MonitorCreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTask: MonitorTask | null
  onSuccess: () => void
}

const CRON_PRESETS = [
  { label: "高频", desc: "每30分钟", value: "*/30 * * * *", icon: "🔥" },
  { label: "平衡", desc: "每6小时", value: "0 */6 * * *", icon: "⚖️" },
  { label: "节能", desc: "每天一次", value: "0 9 * * *", icon: "🌿" },
  { label: "自定义", desc: "手动输入", value: "custom", icon: "⚙️" },
]

const DEFAULT_STRATEGIES = [
  {
    id: "concise",
    label: "精简研判",
    template:
      "请以最简洁的方式对比新旧信息，只输出关键变化，忽略细节噪声。",
  },
  {
    id: "deep",
    label: "深度分析",
    template:
      "请对监控目标进行全面分析，关注结构性变化、因果链条和潜在影响。",
  },
  {
    id: "alert",
    label: "预警优先",
    template:
      "请优先识别风险信号和突发事件，输出应包含紧急程度评估和建议响应。",
  },
]

export function MonitorCreateModal({
  open,
  onOpenChange,
  editTask,
  onSuccess,
}: MonitorCreateModalProps) {
  const isEdit = !!editTask
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [title, setTitle] = useState("")
  const [objective, setObjective] = useState("")
  const [cronPreset, setCronPreset] = useState("0 */6 * * *")
  const [customCron, setCustomCron] = useState("")
  const [strategies, setStrategies] = useState(DEFAULT_STRATEGIES)
  const [newStrategyLabel, setNewStrategyLabel] = useState("")
  const [newStrategyTemplate, setNewStrategyTemplate] = useState("")
  const [showAddStrategy, setShowAddStrategy] = useState(false)

  // Populate on edit
  useEffect(() => {
    if (editTask) {
      setTitle(editTask.title)
      setObjective(editTask.objective)
      const matchedPreset = CRON_PRESETS.find(
        (p) => p.value === editTask.cron_expr
      )
      if (matchedPreset) {
        setCronPreset(editTask.cron_expr)
      } else {
        setCronPreset("custom")
        setCustomCron(editTask.cron_expr)
      }
      if (editTask.strategy_variants?.prompts?.length) {
        setStrategies(
          editTask.strategy_variants.prompts.map((p) => ({
            id: p.id,
            label: p.label,
            template: p.template,
          }))
        )
      }
    } else {
      setTitle("")
      setObjective("")
      setCronPreset("0 */6 * * *")
      setCustomCron("")
      setStrategies(DEFAULT_STRATEGIES)
    }
  }, [editTask, open])

  const cronValue = cronPreset === "custom" ? customCron : cronPreset

  const handleSubmit = async () => {
    if (!title.trim() || !objective.trim()) return
    setSubmitting(true)
    try {
      if (isEdit) {
        await updateMonitorTask(editTask.id, {
          title: title.trim(),
          objective: objective.trim(),
          cron_expr: cronValue,
        })
      } else {
        const payload: MonitorTaskCreateInput = {
          title: title.trim(),
          objective: objective.trim(),
          cron_expr: cronValue,
        }
        await createMonitorTask(payload)
      }
      onSuccess()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  const addStrategy = () => {
    if (!newStrategyLabel.trim() || !newStrategyTemplate.trim()) return
    setStrategies((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}`,
        label: newStrategyLabel.trim(),
        template: newStrategyTemplate.trim(),
      },
    ])
    setNewStrategyLabel("")
    setNewStrategyTemplate("")
    setShowAddStrategy(false)
  }

  const removeStrategy = (id: string) => {
    setStrategies((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <Dialog open={open} onOpenChange={() => onOpenChange(false)}>
      <DialogContent className="max-w-xl border-white/10 bg-[var(--card)]/95 backdrop-blur-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Crosshair className="h-5 w-5 text-[var(--primary)]" />
            {isEdit ? "编辑寻猎任务" : "新建寻猎任务"}
          </DialogTitle>
          <DialogDescription className="text-[var(--muted)]">
            {isEdit
              ? "修改任务参数，保存后立即生效"
              : "创建后将自动孵化专属寻猎者助手"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
              任务标题
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：伊朗局势72H监控"
              className="w-full rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            />
          </div>

          {/* Objective */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--primary)]" />
              监控意图
            </label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={4}
              placeholder="描述你希望持续监控的目标、关注的实体、以及触发预警的条件..."
              className="w-full resize-none rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--foreground)] placeholder:text-[var(--muted)]/50 outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            />
          </div>

          {/* Cron Frequency */}
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              执行频率
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setCronPreset(preset.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-all",
                    cronPreset === preset.value
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "border-white/5 bg-[var(--foreground)]/[0.02] text-[var(--muted)] hover:border-white/10 hover:bg-[var(--foreground)]/[0.05]"
                  )}
                >
                  <span className="text-base">{preset.icon}</span>
                  <span className="text-xs font-medium">{preset.label}</span>
                  <span className="text-[10px] opacity-70">{preset.desc}</span>
                </button>
              ))}
            </div>
            {cronPreset === "custom" && (
              <input
                type="text"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                placeholder="输入 Cron 表达式，如: 0 */2 * * *"
                className="mt-2 w-full rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3.5 py-2 text-sm font-mono text-[var(--foreground)] placeholder:text-[var(--muted)]/50 outline-none focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
              />
            )}
          </div>

          {/* Strategy Arms */}
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
              <Cpu className="h-3.5 w-3.5 text-teal-400" />
              研判策略臂
              <span className="ml-auto text-[10px] font-normal text-[var(--muted)]">
                MAB 将自动优化权重
              </span>
            </label>
            <div className="space-y-2">
              {strategies.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-start gap-2 rounded-xl border border-white/5 bg-[var(--foreground)]/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-[var(--foreground)]">
                      {s.label}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-[var(--muted)]">
                      {s.template}
                    </div>
                  </div>
                  <button
                    onClick={() => removeStrategy(s.id)}
                    className="shrink-0 rounded p-0.5 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {showAddStrategy ? (
                <div className="space-y-2 rounded-xl border border-dashed border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3">
                  <input
                    type="text"
                    value={newStrategyLabel}
                    onChange={(e) => setNewStrategyLabel(e.target.value)}
                    placeholder="策略名称"
                    className="w-full rounded-lg border border-white/10 bg-[var(--foreground)]/[0.03] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]/40"
                  />
                  <textarea
                    value={newStrategyTemplate}
                    onChange={(e) => setNewStrategyTemplate(e.target.value)}
                    rows={2}
                    placeholder="研判提示词模板..."
                    className="w-full resize-none rounded-lg border border-white/10 bg-[var(--foreground)]/[0.03] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]/40"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={addStrategy}
                      className="rounded-lg bg-[var(--primary)]/15 px-3 py-1 text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)]/25"
                    >
                      添加
                    </button>
                    <button
                      onClick={() => setShowAddStrategy(false)}
                      className="rounded-lg px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--foreground)]/5"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddStrategy(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 py-2 text-xs text-[var(--muted)] transition-colors hover:border-[var(--primary)]/30 hover:text-[var(--primary)]"
                >
                  <Plus className="h-3 w-3" />
                  添加策略臂
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-xl px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !objective.trim()}
            className={cn(
              "flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2 text-sm font-medium text-white shadow-lg shadow-[var(--primary)]/20 transition-all hover:shadow-xl hover:shadow-[var(--primary)]/30",
              (submitting || !title.trim() || !objective.trim()) &&
                "opacity-50 pointer-events-none"
            )}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "保存修改" : "创建任务"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
