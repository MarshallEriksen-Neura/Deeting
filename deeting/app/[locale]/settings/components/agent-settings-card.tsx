"use client"

import * as React from "react"
import { Bot, ShieldCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { GlassButton } from "@/components/ui/glass-button"
import { toast } from "sonner"
import { useI18n } from "@/hooks/use-i18n"
import {
  getDesktopConfig,
  setDesktopConfig,
  DESKTOP_CONFIG_KEYS,
} from "@/lib/api/desktop-config"

const DEFAULT_MAX_ROUNDS = 10
const MIN_ROUNDS = 1
const MAX_ROUNDS = 50

interface AgentSettingsCardProps {
  isTauriRuntime: boolean
}

export function AgentSettingsCard({ isTauriRuntime }: AgentSettingsCardProps) {
  const t = useI18n("settings")
  const [maxRounds, setMaxRounds] = React.useState<string>(String(DEFAULT_MAX_ROUNDS))
  const [savedValue, setSavedValue] = React.useState<string>(String(DEFAULT_MAX_ROUNDS))
  const [personaPrompt, setPersonaPrompt] = React.useState("")
  const [savedPersonaPrompt, setSavedPersonaPrompt] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!isTauriRuntime) return
    let cancelled = false
    Promise.all([
      getDesktopConfig(DESKTOP_CONFIG_KEYS.maxAgenticRounds),
      getDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt),
    ])
      .then(([value, personaValue]) => {
        if (cancelled) return
        const parsed = value ? String(parseInt(value, 10) || DEFAULT_MAX_ROUNDS) : String(DEFAULT_MAX_ROUNDS)
        setMaxRounds(parsed)
        setSavedValue(parsed)
        const nextPersonaPrompt = personaValue?.trim() ?? ""
        setPersonaPrompt(nextPersonaPrompt)
        setSavedPersonaPrompt(nextPersonaPrompt)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [isTauriRuntime])

  if (!isTauriRuntime) return null

  const hasChanges = maxRounds !== savedValue || personaPrompt !== savedPersonaPrompt

  const handleSave = async () => {
    const parsed = parseInt(maxRounds, 10)
    if (isNaN(parsed) || parsed < MIN_ROUNDS || parsed > MAX_ROUNDS) {
      toast.error(t("agent.roundsValidation", { min: MIN_ROUNDS, max: MAX_ROUNDS }))
      return
    }
    setIsSaving(true)
    try {
      await Promise.all([
        setDesktopConfig(DESKTOP_CONFIG_KEYS.maxAgenticRounds, String(parsed)),
        setDesktopConfig(DESKTOP_CONFIG_KEYS.personaPrompt, personaPrompt.trim()),
      ])
      setSavedValue(String(parsed))
      setMaxRounds(String(parsed))
      setSavedPersonaPrompt(personaPrompt.trim())
      setPersonaPrompt(personaPrompt.trim())
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
              max={MAX_ROUNDS}
              value={maxRounds}
              onChange={(e) => setMaxRounds(e.target.value)}
              disabled={isLoading || isSaving}
              className="w-28 rounded-xl"
            />
            <span className="text-xs text-muted-foreground">
              {t("agent.maxRoundsRange", { min: MIN_ROUNDS, max: MAX_ROUNDS })}
            </span>
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
