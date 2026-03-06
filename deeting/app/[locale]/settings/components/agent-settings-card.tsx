"use client"

import * as React from "react"
import { Bot, ShieldCheck } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardFooter,
} from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!isTauriRuntime) return
    let cancelled = false
    getDesktopConfig(DESKTOP_CONFIG_KEYS.maxAgenticRounds)
      .then((value) => {
        if (cancelled) return
        const parsed = value ? String(parseInt(value, 10) || DEFAULT_MAX_ROUNDS) : String(DEFAULT_MAX_ROUNDS)
        setMaxRounds(parsed)
        setSavedValue(parsed)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [isTauriRuntime])

  if (!isTauriRuntime) return null

  const hasChanges = maxRounds !== savedValue

  const handleSave = async () => {
    const parsed = parseInt(maxRounds, 10)
    if (isNaN(parsed) || parsed < MIN_ROUNDS || parsed > MAX_ROUNDS) {
      toast.error(t("agent.roundsValidation", { min: MIN_ROUNDS, max: MAX_ROUNDS }))
      return
    }
    setIsSaving(true)
    try {
      await setDesktopConfig(DESKTOP_CONFIG_KEYS.maxAgenticRounds, String(parsed))
      setSavedValue(String(parsed))
      setMaxRounds(String(parsed))
      toast.success(t("agent.saveSuccess"))
    } catch {
      toast.error(t("agent.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <GlassCard
      blur="default"
      theme="surface"
      hover="lift"
      padding="lg"
      className="border-0"
    >
      <GlassCardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <GlassCardTitle className="text-lg text-foreground">
              {t("agent.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("agent.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Bot className="h-3 w-3" />
            {t("agent.badge")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          <span>{t("agent.hint")}</span>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="max-agentic-rounds" className="text-sm font-medium">
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
      </GlassCardContent>
      <GlassCardFooter className="justify-end">
        <Badge variant="outline" className="text-xs">
          {t("agent.scopeBadge")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  )
}
