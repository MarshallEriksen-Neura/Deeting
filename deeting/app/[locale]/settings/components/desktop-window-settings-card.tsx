"use client"

import * as React from "react"
import {
  AppWindow,
  Keyboard,
  Minimize2,
  PictureInPicture2,
  Power,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import { GlassButton } from "@/ui/common/glass-button"
import { Label } from "@/ui/shadcn/label"
import { RadioGroup, RadioGroupItem } from "@/ui/shadcn/radio-group"
import { useI18n } from "@/hooks/use-i18n"
import {
  DEFAULT_ISLAND_TOGGLE_SHORTCUT,
  DEFAULT_SELECTION_ASSISTANT_WAKE_SHORTCUT,
  type DesktopWindowCloseAction,
  getDesktopWindowCloseAction,
  getIslandToggleShortcut,
  getSelectionAssistantWakeShortcut,
  setDesktopWindowCloseAction,
  setIslandToggleShortcut,
  setSelectionAssistantWakeShortcut,
} from "@/lib/api/desktop-config"

interface DesktopWindowSettingsCardProps {
  isTauriRuntime: boolean
}

const CLOSE_ACTION_OPTIONS: Array<{
  value: DesktopWindowCloseAction
  icon: typeof PictureInPicture2
  labelKey: string
  descriptionKey: string
}> = [
  {
    value: "show_island",
    icon: PictureInPicture2,
    labelKey: "window.closeAction.showIsland",
    descriptionKey: "window.closeActionDesc.showIsland",
  },
  {
    value: "minimize",
    icon: Minimize2,
    labelKey: "window.closeAction.minimize",
    descriptionKey: "window.closeActionDesc.minimize",
  },
  {
    value: "quit",
    icon: Power,
    labelKey: "window.closeAction.quit",
    descriptionKey: "window.closeActionDesc.quit",
  },
]

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"])

function shortcutParts(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part === "CommandOrControl" ? "Ctrl" : part))
}

function keyFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null
  }
  if (event.code === "Space") {
    return "Space"
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase()
  }
  return event.key.replace(/^Arrow/, "")
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = keyFromKeyboardEvent(event)
  if (!key) {
    return null
  }

  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) {
    modifiers.push("CommandOrControl")
  }
  if (event.altKey) {
    modifiers.push("Alt")
  }
  if (event.shiftKey) {
    modifiers.push("Shift")
  }
  if (modifiers.length === 0 && !/^F\d{1,2}$/.test(key)) {
    return null
  }
  return [...modifiers, key].join("+")
}

interface ShortcutRecorderProps {
  id: string
  value: string
  defaultValue: string
  disabled: boolean
  onChange: (value: string) => void
  recordLabel: string
  recordingLabel: string
  resetLabel: string
  waitingLabel: string
}

function ShortcutRecorder({
  id,
  value,
  defaultValue,
  disabled,
  onChange,
  recordLabel,
  recordingLabel,
  resetLabel,
  waitingLabel,
}: ShortcutRecorderProps) {
  const [isRecording, setIsRecording] = React.useState(false)

  React.useEffect(() => {
    if (!isRecording) return

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === "Escape") {
        setIsRecording(false)
        return
      }

      const shortcut = shortcutFromKeyboardEvent(event)
      if (!shortcut) return
      onChange(shortcut)
      setIsRecording(false)
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [isRecording, onChange])

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/30 bg-muted/15 px-4 py-3 dark:bg-muted/10 sm:flex-row sm:items-center">
      <button
        id={id}
        type="button"
        onClick={() => setIsRecording(true)}
        disabled={disabled}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg border border-border/40 bg-background/60 px-3 text-left transition-colors hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" />
        {isRecording ? (
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            {waitingLabel}
          </span>
        ) : (
          <span className="flex min-w-0 flex-wrap gap-1.5">
            {shortcutParts(value).map((part) => (
              <kbd
                key={part}
                className="rounded-md border border-border/50 bg-background px-2 py-1 font-mono text-[11px] font-semibold text-foreground shadow-sm"
              >
                {part}
              </kbd>
            ))}
          </span>
        )}
      </button>
      <div className="flex shrink-0 gap-2">
        <GlassButton
          type="button"
          size="sm"
          variant={isRecording ? "default" : "secondary"}
          onClick={() => setIsRecording((value) => !value)}
          disabled={disabled}
        >
          {isRecording ? recordingLabel : recordLabel}
        </GlassButton>
        <GlassButton
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange(defaultValue)}
          disabled={disabled}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {resetLabel}
        </GlassButton>
      </div>
    </div>
  )
}

export function DesktopWindowSettingsCard({
  isTauriRuntime,
}: DesktopWindowSettingsCardProps) {
  const t = useI18n("settings")
  const [closeAction, setCloseAction] =
    React.useState<DesktopWindowCloseAction>("show_island")
  const [savedCloseAction, setSavedCloseAction] =
    React.useState<DesktopWindowCloseAction>("show_island")
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
      getDesktopWindowCloseAction(),
      getIslandToggleShortcut(),
      getSelectionAssistantWakeShortcut(),
    ])
      .then(([closeActionValue, islandShortcutValue, wakeShortcutValue]) => {
        if (cancelled) return
        setCloseAction(closeActionValue)
        setSavedCloseAction(closeActionValue)
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
    closeAction !== savedCloseAction ||
    normalizedIslandShortcut !== savedIslandShortcut ||
    normalizedWakeShortcut !== savedWakeShortcut

  const handleSave = async () => {
    if (!normalizedIslandShortcut) {
      toast.error(t("window.islandShortcutRequired"))
      return
    }
    if (!normalizedWakeShortcut) {
      toast.error(t("window.wakeShortcutRequired"))
      return
    }

    setIsSaving(true)
    try {
      if (closeAction !== savedCloseAction) {
        await setDesktopWindowCloseAction(closeAction)
        setSavedCloseAction(closeAction)
      }
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
      toast.success(t("window.saveSuccess"))
    } catch {
      toast.error(t("window.saveFailed"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-400">
            <AppWindow className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("window.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("window.description")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        <div className="space-y-2">
          <Label className="text-xs font-medium">
            {t("window.minimizeLabel")}
          </Label>
          <p className="text-sm text-foreground">
            {t("window.minimizeValue")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("window.minimizeHelp")}
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="island-toggle-shortcut"
              className="text-xs font-medium"
            >
              {t("window.islandShortcutLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("window.islandShortcutHelp")}
            </p>
          </div>
          <ShortcutRecorder
            id="island-toggle-shortcut"
            value={islandShortcut}
            defaultValue={DEFAULT_ISLAND_TOGGLE_SHORTCUT}
            disabled={isLoading || isSaving}
            onChange={setIslandShortcut}
            recordLabel={t("window.shortcutRecord")}
            recordingLabel={t("window.shortcutRecording")}
            resetLabel={t("window.shortcutReset")}
            waitingLabel={t("window.shortcutWaiting")}
          />
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="selection-assistant-wake-shortcut"
              className="text-xs font-medium"
            >
              {t("window.wakeShortcutLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("window.wakeShortcutHelp")}
            </p>
          </div>
          <ShortcutRecorder
            id="selection-assistant-wake-shortcut"
            value={wakeShortcut}
            defaultValue={DEFAULT_SELECTION_ASSISTANT_WAKE_SHORTCUT}
            disabled={isLoading || isSaving}
            onChange={setWakeShortcut}
            recordLabel={t("window.shortcutRecord")}
            recordingLabel={t("window.shortcutRecording")}
            resetLabel={t("window.shortcutReset")}
            waitingLabel={t("window.shortcutWaiting")}
          />
          <p className="text-xs text-muted-foreground">
            {t("window.shortcutSyntaxHelp")}
          </p>
        </div>

        <div className="space-y-3">
          <Label className="text-xs font-medium">
            {t("window.closeActionLabel")}
          </Label>
          <RadioGroup
            value={closeAction}
            onValueChange={(value) =>
              setCloseAction(value as DesktopWindowCloseAction)
            }
            className="gap-3"
          >
            {CLOSE_ACTION_OPTIONS.map((option) => {
              const Icon = option.icon
              const id = `desktop-close-action-${option.value}`
              return (
                <div
                  key={option.value}
                  className="flex items-start gap-3 rounded-xl border border-border/30 bg-muted/15 px-4 py-3 dark:bg-muted/10"
                >
                  <RadioGroupItem
                    id={id}
                    value={option.value}
                    disabled={isLoading || isSaving}
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-0.5 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="grid gap-1">
                      <Label
                        htmlFor={id}
                        className="cursor-pointer text-sm font-medium text-foreground"
                      >
                        {t(option.labelKey)}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t(option.descriptionKey)}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">
            {t("window.closeActionHelp")}
          </p>
        </div>

        {hasChanges ? (
          <GlassButton
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isLoading || isSaving}
          >
            {isSaving ? t("window.saving") : t("window.save")}
          </GlassButton>
        ) : null}
      </div>

      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">
          {t("window.footerHint")}
        </span>
      </div>
    </div>
  )
}
