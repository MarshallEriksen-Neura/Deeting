"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
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

type AnalysisMode = "concise" | "deep" | "alert_first"

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
  const t = useTranslations("monitoring")
  const isEdit = Boolean(editTask)
  const [submitting, setSubmitting] = useState(false)
  const [title, setTitle] = useState("")
  const [objective, setObjective] = useState("")
  const [taskAgentId, setTaskAgentId] = useState("")
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("concise")
  const [cronPreset, setCronPreset] = useState<string>("0 */6 * * *")
  const [customCron, setCustomCron] = useState("")
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [taskAgents, setTaskAgents] = useState<CustomTaskAgentProfile[]>([])
  const [loadingTaskAgents, setLoadingTaskAgents] = useState(false)
  const { data: channelsData } = useNotificationChannels()

  const cronPresets = useMemo(
    () => [
      {
        key: "highFreq",
        label: t("monitors.modal.cronPresets.highFreq.label"),
        description: t("monitors.modal.cronPresets.highFreq.description"),
        value: "*/30 * * * *",
      },
      {
        key: "balanced",
        label: t("monitors.modal.cronPresets.balanced.label"),
        description: t("monitors.modal.cronPresets.balanced.description"),
        value: "0 */6 * * *",
      },
      {
        key: "light",
        label: t("monitors.modal.cronPresets.light.label"),
        description: t("monitors.modal.cronPresets.light.description"),
        value: "0 9 * * *",
      },
      {
        key: "custom",
        label: t("monitors.modal.cronPresets.custom.label"),
        description: t("monitors.modal.cronPresets.custom.description"),
        value: "custom",
      },
    ],
    [t],
  )

  const analysisModes = useMemo(
    () => [
      {
        value: "concise" as const,
        label: t("monitors.modal.analysisModes.concise.label"),
        description: t("monitors.modal.analysisModes.concise.description"),
      },
      {
        value: "deep" as const,
        label: t("monitors.modal.analysisModes.deep.label"),
        description: t("monitors.modal.analysisModes.deep.description"),
      },
      {
        value: "alert_first" as const,
        label: t("monitors.modal.analysisModes.alertFirst.label"),
        description: t("monitors.modal.analysisModes.alertFirst.description"),
      },
    ],
    [t],
  )

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
      const matchedPreset = cronPresets.find((preset) => preset.value === editTask.cron_expr)
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
  }, [cronPresets, editTask, open])

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
          <DialogTitle>
            {isEdit ? t("monitors.modal.titleEdit") : t("monitors.modal.titleCreate")}
          </DialogTitle>
          <DialogDescription>
            {t("monitors.modal.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <section className="space-y-2">
              <label className="text-sm font-medium">{t("monitors.modal.taskAgentLabel")}</label>
              {bindableTaskAgents.length ? (
                <select
                  value={taskAgentId}
                  onChange={(event) => setTaskAgentId(event.target.value)}
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
                >
                  <option value="">{t("monitors.modal.taskAgentPlaceholder")}</option>
                  {bindableTaskAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Link
                  href="/dashboard/user/task-agents"
                  className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
                >
                  {loadingTaskAgents ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {t("monitors.modal.taskAgentHint")}
                </Link>
              )}
            </section>

            <section className="space-y-2">
              <label className="text-sm font-medium">{t("monitors.modal.titleLabel")}</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("monitors.modal.titlePlaceholder")}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
              />
            </section>

            <section className="space-y-2">
              <label className="text-sm font-medium">{t("monitors.modal.objectiveLabel")}</label>
              <textarea
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                rows={5}
                placeholder={t("monitors.modal.objectivePlaceholder")}
                className="w-full rounded-2xl border border-input bg-background px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
              />
            </section>
          </div>

          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="size-4" />
                {t("monitors.modal.frequencyLabel")}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {cronPresets.map((preset) => (
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
                  placeholder={t("monitors.modal.customCronPlaceholder")}
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ios-ring)]"
                />
              ) : null}
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Radio className="size-4" />
                {t("monitors.modal.analysisModeLabel")}
              </div>
              <div className="space-y-2">
                {analysisModes.map((mode) => (
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
                      {analysisMode === mode.value ? <Badge variant="secondary">{t("monitors.modal.current")}</Badge> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{mode.description}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bot className="size-4" />
                {t("monitors.modal.channelLabel")}
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
                        {checked ? <Badge variant="secondary">{t("monitors.modal.selected")}</Badge> : null}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                  {t("monitors.modal.noChannels")}
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("monitors.modal.cancel")}
          </Button>
          <Button
            variant="ios-primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || !title.trim() || !objective.trim() || !taskAgentId.trim() || !cronExpr}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? t("monitors.modal.save") : t("monitors.modal.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
