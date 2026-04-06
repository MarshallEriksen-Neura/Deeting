"use client"

import { useMemo, useState } from "react"
import { ImageIcon, ShieldCheck, Lock, ChevronDown } from "lucide-react"
import { Control } from "react-hook-form"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import {
  resolveModelVisual,
  type ModelPickerModel,
} from "@/components/models/model-visual"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useI18n } from "@/hooks/use-i18n"
import { type SettingsFormValues, type ModelGroup } from "../types"
import { DeferredSettingsModelPicker } from "./settings-lazy"

interface DesktopMultimodalSettingsCardProps {
  control: Control<SettingsFormValues>
  isTauriRuntime: boolean
  canEditDesktop: boolean
  hasAvailableModels: boolean
  modelGroups: ModelGroup[]
  isLoadingModels?: boolean
}

type SelectedModel = {
  model: ModelGroup["models"][number]
  group?: ModelGroup
}

const findSelectedModel = (
  value: string | undefined,
  groups: ModelGroup[]
): SelectedModel | null => {
  if (!value) return null
  for (const group of groups) {
    for (const model of group.models) {
      if (model.provider_model_id === value || model.id === value) {
        return { model, group }
      }
    }
  }
  return null
}

export function DesktopMultimodalSettingsCard({
  control,
  isTauriRuntime,
  canEditDesktop,
  hasAvailableModels,
  modelGroups,
  isLoadingModels = false,
}: DesktopMultimodalSettingsCardProps) {
  const t = useI18n("settings")
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const pickerModelGroups = useMemo(() =>
    modelGroups.map((group) => ({
      ...group,
      models: group.models.map(
        (model): ModelPickerModel => ({
          ...model,
          provider_model_id: model.provider_model_id ?? undefined,
        })
      ),
    }))
  , [modelGroups])

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400">
            <ImageIcon className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("desktop.multimodalLabel")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("desktop.multimodalHelp")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {canEditDesktop ? (
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>
            {canEditDesktop
              ? t("desktop.editableHint")
              : t("desktop.readonlyHint")}
          </span>
        </div>
      </div>

      <div className="space-y-4 px-6 py-5">
        {!isTauriRuntime ? (
          <div className="rounded-xl border border-border/30 bg-muted/20 px-4 py-3 dark:bg-muted/10">
            <p className="text-sm font-medium text-foreground">
              {t("desktop.unavailableTitle")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("desktop.unavailableDesc")}
            </p>
          </div>
        ) : (
          <FormField
            control={control}
            name="desktopMultimodalProviderModelId"
            render={({ field }) => {
              const selectedValue = field.value?.trim()
              const selectedModel = findSelectedModel(selectedValue, modelGroups)
              const displayName = isLoadingModels
                ? t("personal.currentLoading")
                : (selectedModel?.model.id ?? selectedValue) || t("personal.currentEmpty")
              const ownerText =
                selectedModel?.model.owned_by || selectedModel?.group?.provider
              const isDisabled = !canEditDesktop || !hasAvailableModels
              const visual = resolveModelVisual(
                selectedModel
                  ? {
                      ...selectedModel.model,
                      provider_model_id: selectedModel.model.provider_model_id ?? undefined,
                    }
                  : undefined
              )
              const Icon = visual.icon

              return (
                <FormItem>
                  <FormLabel className="sr-only">{t("desktop.multimodalLabel")}</FormLabel>
                  <Popover
                    open={isPickerOpen}
                    onOpenChange={(open) => {
                      if (isDisabled) return
                      setIsPickerOpen(open)
                    }}
                  >
                    <PopoverTrigger asChild>
                      <FormControl>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl border border-border/40 bg-background px-4 py-3 text-left transition-all hover:border-border/60 hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background/50"
                          disabled={isDisabled}
                          aria-expanded={isPickerOpen}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/40 dark:bg-muted/20">
                              <Icon className={`h-4 w-4 ${visual.color}`} />
                            </span>
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                {t("desktop.multimodalLabel")}
                              </span>
                              <span className="truncate text-sm font-medium text-foreground">
                                {displayName}
                              </span>
                              {ownerText ? (
                                <span className="truncate text-[11px] text-muted-foreground">
                                  {ownerText}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isPickerOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[min(520px,92vw)] p-0"
                      align="start"
                      side="bottom"
                      sideOffset={8}
                    >
                      {isPickerOpen ? (
                      <DeferredSettingsModelPicker
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value)
                          setIsPickerOpen(false)
                        }}
                        modelGroups={pickerModelGroups}
                        valueField="provider_model_id"
                        title={t("desktop.multimodalLabel")}
                        subtitle={t("desktop.multimodalPlaceholder")}
                        searchPlaceholder={t("personal.modelSearchPlaceholder")}
                        emptyText={t("personal.emptyHint")}
                        noResultsText={t("personal.modelNoResults")}
                        disabled={isDisabled}
                        scrollAreaClassName="h-64 pr-1"
                        className="rounded-xl border border-border/40"
                      />
                      ) : null}
                    </PopoverContent>
                  </Popover>
                  <FormDescription>{t("desktop.multimodalHelp")}</FormDescription>
                </FormItem>
              )
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">{t("desktop.scopeBadge")}</span>
      </div>
    </div>
  )
}
