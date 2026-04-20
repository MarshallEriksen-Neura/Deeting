"use client"

import { Link2, Network } from "lucide-react"
import { useWatch, type Control } from "react-hook-form"

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/ui/shadcn/form"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import { RadioGroup, RadioGroupItem } from "@/ui/shadcn/radio-group"
import { useI18n } from "@/hooks/use-i18n"
import type { SettingsFormValues } from "../types"

interface DesktopNetworkSettingsCardProps {
  control: Control<SettingsFormValues>
  isTauriRuntime: boolean
  canEditDesktop: boolean
}

const PROXY_MODE_OPTIONS: Array<{
  value: SettingsFormValues["desktopProxyMode"]
  labelKey: string
  descriptionKey: string
}> = [
  {
    value: "none",
    labelKey: "desktop.network.mode.none",
    descriptionKey: "desktop.network.modeDesc.none",
  },
  {
    value: "system",
    labelKey: "desktop.network.mode.system",
    descriptionKey: "desktop.network.modeDesc.system",
  },
  {
    value: "custom",
    labelKey: "desktop.network.mode.custom",
    descriptionKey: "desktop.network.modeDesc.custom",
  },
]

export function DesktopNetworkSettingsCard({
  control,
  isTauriRuntime,
  canEditDesktop,
}: DesktopNetworkSettingsCardProps) {
  const t = useI18n("settings")
  const proxyMode = useWatch({ control, name: "desktopProxyMode" }) ?? "system"

  if (!isTauriRuntime) {
    return null
  }

  const isDisabled = !canEditDesktop

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400">
            <Network className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("desktop.network.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("desktop.network.description")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        <FormField
          control={control}
          name="desktopProxyMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-medium">
                {t("desktop.network.modeLabel")}
              </FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="gap-3"
                >
                  {PROXY_MODE_OPTIONS.map((option) => {
                    const id = `desktop-proxy-mode-${option.value}`
                    return (
                      <div
                        key={option.value}
                        className="flex items-start gap-3 rounded-xl border border-border/30 bg-muted/15 px-4 py-3 dark:bg-muted/10"
                      >
                        <RadioGroupItem
                          id={id}
                          value={option.value}
                          disabled={isDisabled}
                          className="mt-0.5"
                        />
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
                    )
                  })}
                </RadioGroup>
              </FormControl>
              <FormDescription className="text-xs">
                {t("desktop.network.modeHelp")}
              </FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="desktopProxyUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-medium">
                {t("desktop.network.urlLabel")}
              </FormLabel>
              <FormControl>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" />
                  </span>
                  <Input
                    {...field}
                    type="url"
                    placeholder={t("desktop.network.urlPlaceholder")}
                    className="rounded-xl pl-9"
                    disabled={isDisabled || proxyMode !== "custom"}
                  />
                </div>
              </FormControl>
              <FormDescription className="text-xs">
                {t("desktop.network.urlHelp")}
              </FormDescription>
            </FormItem>
          )}
        />
      </div>

      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">
          {t("desktop.network.footerHint")}
        </span>
      </div>
    </div>
  )
}
