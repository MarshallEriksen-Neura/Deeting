"use client"

import * as React from "react"
import { Keyboard } from "lucide-react"
import { toast } from "sonner"
import { GlassButton } from "@/ui/common/glass-button"
import { Label } from "@/ui/shadcn/label"
import { useI18n } from "@/hooks/use-i18n"
import {
  DEFAULT_ISLAND_TOGGLE_SHORTCUT,
  DEFAULT_SELECTION_ASSISTANT_WAKE_SHORTCUT,
  getIslandToggleShortcut,
  getSelectionAssistantWakeShortcut,
  setIslandToggleShortcut,
  setSelectionAssistantWakeShortcut,
} from "@/lib/api/desktop-config"
import { ShortcutRecorder } from "./shortcut-recorder"

interface DesktopShortcutSettingsCardProps {
  isTauriRuntime: boolean
}

export function DesktopShortcutSettingsCard({
  isTauriRuntime,
}: DesktopShortcutSettingsCardProps) {
  const t = useI18n("settings")
  const [islandShortcut, setIslandShortcut] = React.useState(
    DEFAULT_ISLAND_TOGGLE_SHORTCUT,
  )
  const [savedIslandShortcut, setSavedIslandShortcut] = React.useState(
    DEFAULT_ISLAND_TOGGLE_SHORTCUT,
  )
  const [wakeShortcut, setWakeShortcut] = React.useState(
    DEFAULT_SELECTION_ASSISTANT_WAKE_SHORTCUT,
  )
  const [savedWakeShortcut, setSavedWakeShortcut] = React.useState(
    DEFAULT_SELECTION_ASSISTANT_WAKE_SHORTCUT,
  )
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!isTauriRuntime) return
    let cancelled = false

    Promise.all([
      getIslandToggleShortcut(),
      getSelectionAssistantWakeShortcut(),
    ])
      .then(([islandShortcutValue, wakeShortcutValue]) => {
        if (cancelled) return
        setIslandShortcut(islandShortcutValue)
        setSavedIslandShortcut(islandShortcutValue)
        setWakeShortcut(wakeShortcutValue)
        setSavedWakeShortcut(wakeShortcutValue)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isTauriRuntime])

  if (!isTauriRuntime) {
    return null
  }

  const normalizedIslandShortcut = islandShortcut.trim()
  const normalizedWakeShortcut = wakeShortcut.trim()
  const hasChanges =
    normalizedIslandShortcut !== savedIslandShortcut ||
    normalizedWakeShortcut !== savedWakeShortcut

  const handleSave = async () => {
    if (!normalizedIslandShortcut) {
      toast.error(t("shortcuts.islandShortcutRequired"))
      return
    }
    if (!normalizedWakeShortcut) {
      toast.error(t("shortcuts.wakeShortcutRequired"))
      return
    }

    setIsSaving(true)
    try {
      if (normalizedIslandShortcut !== savedIslandShortcut) {
        const savedShortcut = await setIslandToggleShortcut(
          normalizedIslandShortcut,
        )
        setIslandShortcut(savedShortcut)
        setSavedIslandShortcut(savedShortcut)
      }
      if (normalizedWakeShortcut !== savedWakeShortcut) {
        const savedShortcut = await setSelectionAssistantWakeShortcut(
          normalizedWakeShortcut,
        )
        setWakeShortcut(savedShortcut)
        setSavedWakeShortcut(savedShortcut)
      }
      toast.success(t("shortcuts.saveSuccess"))
    } catch {
      toast.error(t("shortcuts.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-400">
            <Keyboard className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("shortcuts.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("shortcuts.description")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="island-toggle-shortcut"
              className="text-xs font-medium"
            >
              {t("shortcuts.islandShortcutLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("shortcuts.islandShortcutHelp")}
            </p>
          </div>
          <ShortcutRecorder
            id="island-toggle-shortcut"
            value={islandShortcut}
            defaultValue={DEFAULT_ISLAND_TOGGLE_SHORTCUT}
            disabled={isLoading || isSaving}
            onChange={setIslandShortcut}
            recordLabel={t("shortcuts.shortcutRecord")}
            recordingLabel={t("shortcuts.shortcutRecording")}
            resetLabel={t("shortcuts.shortcutReset")}
            waitingLabel={t("shortcuts.shortcutWaiting")}
          />
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="selection-assistant-wake-shortcut"
              className="text-xs font-medium"
            >
              {t("shortcuts.wakeShortcutLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("shortcuts.wakeShortcutHelp")}
            </p>
          </div>
          <ShortcutRecorder
            id="selection-assistant-wake-shortcut"
            value={wakeShortcut}
            defaultValue={DEFAULT_SELECTION_ASSISTANT_WAKE_SHORTCUT}
            disabled={isLoading || isSaving}
            onChange={setWakeShortcut}
            recordLabel={t("shortcuts.shortcutRecord")}
            recordingLabel={t("shortcuts.shortcutRecording")}
            resetLabel={t("shortcuts.shortcutReset")}
            waitingLabel={t("shortcuts.shortcutWaiting")}
          />
          <p className="text-xs text-muted-foreground">
            {t("shortcuts.shortcutSyntaxHelp")}
          </p>
        </div>

        {hasChanges ? (
          <GlassButton
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isLoading || isSaving}
          >
            {isSaving ? t("shortcuts.saving") : t("shortcuts.save")}
          </GlassButton>
        ) : null}
      </div>

      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">
          {t("shortcuts.footerHint")}
        </span>
      </div>
    </div>
  )
}
