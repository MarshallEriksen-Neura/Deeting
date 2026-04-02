"use client"

import * as React from "react"
import { AppWindow, Minimize2, PictureInPicture2, Power } from "lucide-react"
import { toast } from "sonner"
import { GlassButton } from "@/components/ui/glass-button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useI18n } from "@/hooks/use-i18n"
import {
  type DesktopWindowCloseAction,
  getDesktopWindowCloseAction,
  setDesktopWindowCloseAction,
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

export function DesktopWindowSettingsCard({
  isTauriRuntime,
}: DesktopWindowSettingsCardProps) {
  const t = useI18n("settings")
  const [closeAction, setCloseAction] =
    React.useState<DesktopWindowCloseAction>("show_island")
  const [savedCloseAction, setSavedCloseAction] =
    React.useState<DesktopWindowCloseAction>("show_island")
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!isTauriRuntime) return
    let cancelled = false

    getDesktopWindowCloseAction()
      .then((value) => {
        if (cancelled) return
        setCloseAction(value)
        setSavedCloseAction(value)
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

  const hasChanges = closeAction !== savedCloseAction

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await setDesktopWindowCloseAction(closeAction)
      setSavedCloseAction(closeAction)
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
