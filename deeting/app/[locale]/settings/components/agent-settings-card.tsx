"use client"

import * as React from "react"
import { Bot, ShieldCheck } from "lucide-react"
import { Input } from "@/ui/shadcn/input"
import { Textarea } from "@/ui/shadcn/textarea"
import { Label } from "@/ui/shadcn/label"
import { GlassButton } from "@/ui/common/glass-button"
import { toast } from "sonner"
import { useI18n } from "@/hooks/use-i18n"
import {
  getDesktopConfig,
  setDesktopConfig,
  DESKTOP_CONFIG_KEYS,
  normalizeDesktopApprovalPolicyLevel,
  type DesktopApprovalPolicyLevel,
} from "@/lib/api/desktop-config"

const DEFAULT_MAX_ROUNDS = 150
const MIN_ROUNDS = 1
const ROUND_PRESETS = [
  { value: 30, labelKey: "maxRoundsPresetQuick" },
  { value: 80, labelKey: "maxRoundsPresetStandard" },
  { value: 150, labelKey: "maxRoundsPresetDeep" },
  { value: 300, labelKey: "maxRoundsPresetLong" },
] as const
const DEFAULT_CHAT_HISTORY_RETENTION_DAYS = "0"
const CHAT_HISTORY_RETENTION_OPTIONS = [
  "0",
  "7",
  "30",
  "90",
  "180",
  "365",
] as const

function normalizeChatHistoryRetentionDays(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ""
  if (
    CHAT_HISTORY_RETENTION_OPTIONS.includes(
      normalized as (typeof CHAT_HISTORY_RETENTION_OPTIONS)[number]
    )
  ) {
    return normalized
  }
  return DEFAULT_CHAT_HISTORY_RETENTION_DAYS
}

interface AgentSettingsCardProps {
  isTauriRuntime: boolean
  onManageApprovalRules?: () => void
}

export function AgentSettingsCard({
  isTauriRuntime,
  onManageApprovalRules,
}: AgentSettingsCardProps) {
  const t = useI18n("settings")
  const [maxRounds, setMaxRounds] = React.useState<string>(String(DEFAULT_MAX_ROUNDS))
  const [savedValue, setSavedValue] = React.useState<string>(String(DEFAULT_MAX_ROUNDS))
  const [personaPrompt, setPersonaPrompt] = React.useState("")
  const [savedPersonaPrompt, setSavedPersonaPrompt] = React.useState("")
  const [chatHistoryRetentionDays, setChatHistoryRetentionDays] = React.useState(
    DEFAULT_CHAT_HISTORY_RETENTION_DAYS
  )
  const [savedChatHistoryRetentionDays, setSavedChatHistoryRetentionDays] =
    React.useState(DEFAULT_CHAT_HISTORY_RETENTION_DAYS)
  const [approvalPolicyLevel, setApprovalPolicyLevel] =
    React.useState<DesktopApprovalPolicyLevel>("medium")
  const [savedApprovalPolicyLevel, setSavedApprovalPolicyLevel] =
    React.useState<DesktopApprovalPolicyLevel>("medium")
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!isTauriRuntime) return
    let cancelled = false
    Promise.all([
      getDesktopConfig(DESKTOP_CONFIG_KEYS.maxAgenticRounds),
      getDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt),
      getDesktopConfig(DESKTOP_CONFIG_KEYS.chatHistoryRetentionDays),
      getDesktopConfig(DESKTOP_CONFIG_KEYS.approvalPolicyLevel),
    ])
      .then(([value, personaValue, retentionValue, approvalPolicyValue]) => {
        if (cancelled) return
        const parsed = value ? String(parseInt(value, 10) || DEFAULT_MAX_ROUNDS) : String(DEFAULT_MAX_ROUNDS)
        setMaxRounds(parsed)
        setSavedValue(parsed)
        const nextPersonaPrompt = personaValue?.trim() ?? ""
        setPersonaPrompt(nextPersonaPrompt)
        setSavedPersonaPrompt(nextPersonaPrompt)
        const nextChatHistoryRetentionDays =
          normalizeChatHistoryRetentionDays(retentionValue)
        setChatHistoryRetentionDays(nextChatHistoryRetentionDays)
        setSavedChatHistoryRetentionDays(nextChatHistoryRetentionDays)
        const nextApprovalPolicyLevel =
          normalizeDesktopApprovalPolicyLevel(approvalPolicyValue)
        setApprovalPolicyLevel(nextApprovalPolicyLevel)
        setSavedApprovalPolicyLevel(nextApprovalPolicyLevel)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [isTauriRuntime])

  if (!isTauriRuntime) return null

  const hasChanges =
    maxRounds !== savedValue ||
    personaPrompt !== savedPersonaPrompt ||
    chatHistoryRetentionDays !== savedChatHistoryRetentionDays ||
    approvalPolicyLevel !== savedApprovalPolicyLevel

  const handleSave = async () => {
    const parsed = parseInt(maxRounds, 10)
    if (isNaN(parsed) || parsed < MIN_ROUNDS) {
      toast.error(t("agent.roundsValidation", { min: MIN_ROUNDS }))
      return
    }
    setIsSaving(true)
    try {
      const normalizedChatHistoryRetentionDays =
        normalizeChatHistoryRetentionDays(chatHistoryRetentionDays)
      const normalizedApprovalPolicyLevel =
        normalizeDesktopApprovalPolicyLevel(approvalPolicyLevel)
      await Promise.all([
        setDesktopConfig(DESKTOP_CONFIG_KEYS.maxAgenticRounds, String(parsed)),
        setDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt, personaPrompt.trim()),
        setDesktopConfig(
          DESKTOP_CONFIG_KEYS.chatHistoryRetentionDays,
          normalizedChatHistoryRetentionDays
        ),
        setDesktopConfig(
          DESKTOP_CONFIG_KEYS.approvalPolicyLevel,
          normalizedApprovalPolicyLevel
        ),
      ])
      setSavedValue(String(parsed))
      setMaxRounds(String(parsed))
      setSavedPersonaPrompt(personaPrompt.trim())
      setPersonaPrompt(personaPrompt.trim())
      setSavedChatHistoryRetentionDays(normalizedChatHistoryRetentionDays)
      setChatHistoryRetentionDays(normalizedChatHistoryRetentionDays)
      setSavedApprovalPolicyLevel(normalizedApprovalPolicyLevel)
      setApprovalPolicyLevel(normalizedApprovalPolicyLevel)
      toast.success(t("agent.saveSuccess"))
    } catch {
      toast.error(t("agent.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-400">
            <Bot className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("agent.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("agent.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          <span>{t("agent.hint")}</span>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-5 px-6 py-5">
        <div className="space-y-2">
          <Label htmlFor="max-agentic-rounds" className="text-xs font-medium">
            {t("agent.maxRoundsLabel")}
          </Label>
          <div className="flex items-center gap-3">
            <Input
              id="max-agentic-rounds"
              type="number"
              min={MIN_ROUNDS}
              value={maxRounds}
              onChange={(e) => setMaxRounds(e.target.value)}
              disabled={isLoading || isSaving}
              className="w-28 rounded-xl"
            />
            <span className="text-xs text-muted-foreground">
              {t("agent.maxRoundsRange", { min: MIN_ROUNDS })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ROUND_PRESETS.map((preset) => {
              const isActive = maxRounds.trim() === String(preset.value)
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setMaxRounds(String(preset.value))}
                  disabled={isLoading || isSaving}
                  className={[
                    "h-9 rounded-xl border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-background/70 text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  ].join(" ")}
                >
                  {t(`agent.${preset.labelKey}`)}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("agent.maxRoundsHelp")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="desktop-persona-prompt" className="text-xs font-medium">
            {t("agent.personaPromptLabel")}
          </Label>
          <Textarea
            id="desktop-persona-prompt"
            value={personaPrompt}
            onChange={(event) => setPersonaPrompt(event.target.value)}
            disabled={isLoading || isSaving}
            placeholder={t("agent.personaPromptPlaceholder")}
            className="min-h-32 rounded-xl"
          />
          <p className="text-xs text-muted-foreground">
            {t("agent.personaPromptHelp")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="approval-policy-level" className="text-xs font-medium">
            {t("agent.approvalPolicyLabel")}
          </Label>
          <select
            id="approval-policy-level"
            value={approvalPolicyLevel}
            onChange={(event) =>
              setApprovalPolicyLevel(
                normalizeDesktopApprovalPolicyLevel(event.target.value)
              )
            }
            disabled={isLoading || isSaving}
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-xl border px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background/50"
          >
            <option value="high">{t("agent.approvalPolicyHigh")}</option>
            <option value="medium">{t("agent.approvalPolicyMedium")}</option>
            <option value="low">{t("agent.approvalPolicyLow")}</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {t("agent.approvalPolicyHelp")}
          </p>
          {approvalPolicyLevel === "medium" ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {t("agent.approvalPolicyRecommended")}
            </p>
          ) : null}
          {approvalPolicyLevel === "low" ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("agent.approvalPolicyLowWarning")}
            </p>
          ) : null}
          <div className="pt-1">
            <GlassButton
              type="button"
              size="sm"
              variant="secondary"
              onClick={onManageApprovalRules}
            >
              {t("agent.manageApprovalRules")}
            </GlassButton>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="chat-history-retention-days" className="text-xs font-medium">
            {t("agent.chatHistoryRetentionLabel")}
          </Label>
          <select
            id="chat-history-retention-days"
            value={chatHistoryRetentionDays}
            onChange={(event) => setChatHistoryRetentionDays(event.target.value)}
            disabled={isLoading || isSaving}
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-xl border px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background/50"
          >
            {CHAT_HISTORY_RETENTION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "0"
                  ? t("agent.chatHistoryRetentionForever")
                  : t("agent.chatHistoryRetentionDays", { days: Number(option) })}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t("agent.chatHistoryRetentionHelp")}
          </p>
        </div>

        {hasChanges && (
          <GlassButton
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? t("agent.saving") : t("agent.save")}
          </GlassButton>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">{t("agent.scopeBadge")}</span>
      </div>
    </div>
  )
}
