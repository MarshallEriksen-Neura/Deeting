"use client"

import { useEffect, useState } from "react"
import {
  Bell,
  Bot,
  Clock3,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Radio,
  Send,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog"
import { Button } from "@/components/ui/shadcn/button"
import { Badge } from "@/components/ui/shadcn/badge"
import { cn } from "@/lib/utils"
import {
  createMonitorTask,
  updateMonitorTask,
  type MonitorTask,
  type MonitorTaskCreateInput,
  type MonitorTaskUpdateInput,
} from "@/lib/api/monitors"
import {
  listCustomTaskAgents,
  type CustomTaskAgentProfile,
} from "@/lib/api/custom-task-agents"
import { useNotificationChannels } from "@/lib/swr/use-notification-channels"
import type { ChannelType } from "@/lib/api/notification-channels"
import { CHANNEL_META } from "@/lib/api/notification-channels"

interface MonitorCreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTask: MonitorTask | null
  onSuccess: () => void
}

const CRON_PRESETS = [
  { label: "高频", description: "每 30 分钟", value: "*/30 * * * *" },
  { label: "平衡", description: "每 6 小时", value: "0 */6 * * *" },
  { label: "轻量", description: "每天 09:00", value: "0 9 * * *" },
  { label: "自定义", description: "手动输入 Cron", value: "custom" },
] as const

const ANALYSIS_MODES = [
  { value: "concise", label: "精简", description: "聚焦是否有变化以及最关键摘要。" },
  { value: "deep", label: "深度", description: "保留更多上下文和原因链路。" },
  { value: "alert_first", label: "预警优先", description: "优先识别风险、异常和突发变化。" },
] as const

const CHANNEL_ICON_MAP: Record<ChannelType, typeof Bell> = {
  feishu: MessageSquare,
  wechat: MessageSquare,
  dingtalk: MessageSquare,
  telegram: Send,
  email: Mail,
  webhook: Globe,
}

export function MonitorCreateModal({
  open,
  onOpenChange,
  editTask,
  onSuccess,
}: MonitorCreateModalProps) {
  const isEdit = Boolean(editTask)
  const [submitting, setSubmitting] = useState(false)
  const [title, setTitle] = useState("")
  const [objective, setObjective] = useState("")
  const [taskAgentId, setTaskAgentId] = useState("")
  const [analysisMode, setAnalysisMode] = useState<"concise" | "deep" | "alert_first">("concise")
  const [cronPreset, setCronPreset] = useState<string>("0 */6 * * *")
  const [customCron, setCustomCron] = useState("")
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [taskAgents, setTaskAgents] = useState<CustomTaskAgentProfile[]>([])
  const [loadingTaskAgents, setLoadingTaskAgents] = useState(false)
  const { data: channelsData } = useNotificationChannels()

  const activeChannels = (channelsData?.items ?? []).filter((channel) => channel.is_active)
  const bindableTaskAgents = taskAgents.filter(
    (agent) => agent.invocation_kind === "chat" && agent.is_enabled && !agent.is_deleted,
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingTaskAgents(true)
    void listCustomTaskAgents()
      .then((items) => {
        if (!cancelled) {
          setTaskAgents(items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTaskAgents([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTaskAgents(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    if (editTask) {
      setTitle(editTask.title)
      setObjective(editTask.objective)
      setTaskAgentId(editTask.task_agent_id ?? editTask.assistant_id ?? "")
      setAnalysisMode(editTask.analysis_mode)
      const matchedPreset = CRON_PRESETS.find((preset) => preset.value === editTask.cron_expr)
      setCronPreset(matchedPreset?.value ?? "custom")
      setCustomCron(matchedPreset ? "" : editTask.cron_expr)
      setSelectedChannelIds(editTask.notify_config?.channel_ids ?? [])
      return
    }

    setTitle("")
    setObjective("")
    setTaskAgentId("")
    setAnalysisMode("concise")
    setCronPreset("0 */6 * * *")
    setCustomCron("")
    setSelectedChannelIds([])
  }, [editTask, open])

  const cronExpr = cronPreset === "custom" ? customCron.trim() : cronPreset

  async function handleSubmit() {
    if (!title.trim() || !objective.trim() || !taskAgentId.trim() || !cronExpr) {
      return
    }

    setSubmitting(true)
    try {
      if (isEdit && editTask) {
        const payload: MonitorTaskUpdateInput = {
          title: title.trim(),
          objective: objective.trim(),
          task_agent_id: taskAgentId.trim(),
          cron_expr: cronExpr,
          analysis_mode: analysisMode,
          notify_config: selectedChannelIds.length ? { channel_ids: selectedChannelIds } : undefined,
        }
        await updateMonitorTask(editTask.id, payload)
      } else {
        const payload: MonitorTaskCreateInput = {
          title: title.trim(),
          objective: objective.trim(),
          assistant_id: taskAgentId.trim(),
          task_agent_id: taskAgentId.trim(),
          cron_expr: cronExpr,
          analysis_mode: analysisMode,
          notify_config: selectedChannelIds.length ? { channel_ids: selectedChannelIds } : undefined,
          execution_target: "desktop",
        }
        await createMonitorTask(payload)
      }

      onSuccess()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑主动寻猎任务" : "新建主动寻猎任务"}</DialogTitle>
          <DialogDescription>
            仅配置桌面端本地执行。云端相关路径不在此页启用。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <section className="space-y-2">
              <label className="text-sm font-medium">绑定任务智能体</label>
              {bindableTaskAgents.length ? (
                <select
                  value={taskAgentId}
                  onChange={(event) => setTaskAgentId(event.target.value)}
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
                >
                  <option value="">选择一个聊天型任务智能体</option>
                  {bindableTaskAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              ) : (
                <a
                  href="/dashboard/user/task-agents"
                  className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
                >
                  {loadingTaskAgents ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  先去创建或启用聊天型任务智能体
                </a>
              )}
            </section>

            <section className="space-y-2">
              <label className="text-sm font-medium">任务标题</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：竞品价格监控 / 论坛舆情巡检"
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
              />
            </section>

            <section className="space-y-2">
              <label className="text-sm font-medium">监控意图</label>
              <textarea
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                rows={5}
                placeholder="描述持续观察的对象、变化判断标准，以及你希望输出怎样的结论。"
                className="w-full rounded-2xl border border-input bg-background px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
              />
            </section>
          </div>

          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="size-4" />
                执行频率
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setCronPreset(preset.value)}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition-colors",
                      cronPreset === preset.value ? "border-primary bg-primary/5" : "border-border bg-card",
                    )}
                  >
                    <div className="font-medium">{preset.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{preset.description}</div>
                  </button>
                ))}
              </div>
              {cronPreset === "custom" ? (
                <input
                  value={customCron}
                  onChange={(event) => setCustomCron(event.target.value)}
                  placeholder="例如：0 */2 * * *"
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
                />
              ) : null}
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Radio className="size-4" />
                分析模式
              </div>
              <div className="space-y-2">
                {ANALYSIS_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setAnalysisMode(mode.value)}
                    className={cn(
                      "w-full rounded-2xl border p-3 text-left transition-colors",
                      analysisMode === mode.value ? "border-primary bg-primary/5" : "border-border bg-card",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{mode.label}</span>
                      {analysisMode === mode.value ? <Badge variant="secondary">当前</Badge> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{mode.description}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bot className="size-4" />
                通知渠道
              </div>
              {activeChannels.length ? (
                <div className="space-y-2">
                  {activeChannels.map((channel) => {
                    const meta = CHANNEL_META[channel.channel as ChannelType]
                    const Icon = CHANNEL_ICON_MAP[channel.channel as ChannelType] ?? Bell
                    const checked = selectedChannelIds.includes(channel.id)

                    return (
                      <button
                        key={channel.id}
                        type="button"
                        onClick={() =>
                          setSelectedChannelIds((current) =>
                            checked ? current.filter((id) => id !== channel.id) : [...current, channel.id],
                          )
                        }
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                          checked ? "border-primary bg-primary/5" : "border-border bg-card",
                        )}
                      >
                        <Icon className={cn("size-4 shrink-0", meta?.color ?? "text-muted-foreground")} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {channel.display_name || meta?.label || channel.channel}
                          </div>
                          <div className="text-xs text-muted-foreground">{channel.channel}</div>
                        </div>
                        {checked ? <Badge variant="secondary">已选</Badge> : null}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                  还没有可用通知渠道。可以稍后在通知设置里补充。
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="ios-primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || !title.trim() || !objective.trim() || !taskAgentId.trim() || !cronExpr}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? "保存修改" : "创建任务"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
