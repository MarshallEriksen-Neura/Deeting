"use client"

import { useMemo, useState } from "react"
import { User, ShieldCheck, Lock, ChevronDown } from "lucide-react"
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

interface PersonalSettingsCardProps {
  control: Control<SettingsFormValues>
  canEditPersonal: boolean
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
      if (model.id === value || model.provider_model_id === value) {
        return { model, group }
      }
    }
  }
  return null
}

export function PersonalSettingsCard({
  control,
  canEditPersonal,
  hasAvailableModels,
  modelGroups,
  isLoadingModels = false,
}: PersonalSettingsCardProps) {
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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400">
            <User className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("personal.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("personal.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {canEditPersonal ? (
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>
            {canEditPersonal
              ? t("personal.editableHint")
              : t("personal.readonlyHint")}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4 px-6 py-5">
        <FormField
          control={control}
          name="secretaryModel"
          render={({ field }) => {
            const selectedValue = field.value?.trim()
            const selectedModel = findSelectedModel(selectedValue, modelGroups)
            const selectionState = isLoadingModels
              ? "loading"
              : selectedValue
              ? selectedModel
                ? "configured"
                : "unlisted"
              : "empty"
            const statusLabel =
              selectionState === "loading"
                ? t("personal.currentLoading")
                : selectionState === "configured"
                ? t("personal.currentConfigured")
                : selectionState === "unlisted"
                ? t("personal.currentUnlisted")
                : t("personal.currentEmpty")
            const displayName =
              selectionState === "loading"
                ? selectedValue || t("personal.currentLoading")
                : selectionState === "configured"
                ? selectedModel?.model.id
                : selectedValue
                ? selectedValue
                : t("personal.currentEmpty")
            const ownerText =
              selectionState === "configured"
                ? selectedModel?.model.owned_by || selectedModel?.group?.provider
                : null
            const isDisabled = !canEditPersonal || !hasAvailableModels
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
                <FormLabel className="sr-only">{t("personal.secretaryLabel")}</FormLabel>

                {/* Current status indicator */}
                <div className="rounded-xl border border-border/30 bg-muted/20 px-4 py-3 dark:bg-muted/10">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="relative flex h-2 w-2">
                        <span
                          className={
                            selectionState === "configured"
                              ? "absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40"
                              : "absolute inline-flex h-full w-full rounded-full bg-slate-400/30"
                          }
                        />
                        <span
                          className={
                            selectionState === "configured"
                              ? "relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
                              : selectionState === "loading"
                              ? "relative inline-flex h-2 w-2 rounded-full bg-blue-400/70"
                              : "relative inline-flex h-2 w-2 rounded-full bg-slate-400"
                          }
                        />
                      </span>
                      <span>{t("personal.currentLabel")}</span>
                    </div>
                    <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-muted/20">
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-col text-sm font-semibold text-foreground">
                    <span className="truncate">{displayName}</span>
                    {ownerText ? (
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {ownerText}
                      </span>
                    ) : null}
                  </div>
                  {selectionState === "unlisted" ? (
                    <p className="mt-1.5 text-[11px] text-amber-500">
                      {t("personal.currentUnlistedHint")}
                    </p>
                  ) : null}
                </div>

                {/* Model picker trigger */}
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
                              {t("personal.secretaryLabel")}
                            </span>
                            <span className="truncate text-sm font-medium text-foreground">
                              {displayName}
                            </span>
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
                      valueField="id"
                      title={t("personal.secretaryLabel")}
                      subtitle={t("personal.secretaryPlaceholder")}
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
                <FormDescription>{t("personal.secretaryHelp")}</FormDescription>
              </FormItem>
            )
          }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">{t("personal.scopeBadge")}</span>
      </div>
    </div>
  )
}
