"use client"

import { useState } from "react"
import { User, ShieldCheck, Lock, ChevronDown } from "lucide-react"
import { Control } from "react-hook-form"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import { Badge } from "@/components/ui/badge"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import { ModelPicker, resolveModelVisual } from "@/components/models/model-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useI18n } from "@/hooks/use-i18n"
import { type SettingsFormValues, type ModelGroup } from "../types"

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
              {t("personal.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("personal.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <User className="h-3 w-3" />
            {t("personal.badge")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {canEditPersonal ? (
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span>
            {canEditPersonal
              ? t("personal.editableHint")
              : t("personal.readonlyHint")}
          </span>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
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
            const visual = resolveModelVisual(selectedModel?.model)
            const Icon = visual.icon

            return (
              <FormItem>
                <FormLabel className="sr-only">{t("personal.secretaryLabel")}</FormLabel>
                <div className="rounded-2xl border border-white/10 bg-[var(--surface)]/60 px-4 py-3 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
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
                              ? "relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"
                              : selectionState === "loading"
                              ? "relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-400/70"
                              : "relative inline-flex h-2.5 w-2.5 rounded-full bg-slate-400"
                          }
                        />
                      </span>
                      <span>{t("personal.currentLabel")}</span>
                    </div>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-foreground/80">
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-col gap-1 text-sm font-semibold text-foreground">
                    <span className="truncate">{displayName}</span>
                    {ownerText ? (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {ownerText}
                      </span>
                    ) : null}
                  </div>
                  {selectionState === "unlisted" ? (
                    <div className="mt-2 text-[11px] text-amber-500">
                      {t("personal.currentUnlistedHint")}
                    </div>
                  ) : null}
                </div>
                <Popover
                  open={isPickerOpen}
                  onOpenChange={(open) => {
                    if (isDisabled) return
                    setIsPickerOpen(open)
                  }}
                >
                  <PopoverTrigger asChild>
                    <FormControl>
                      <GlassButton
                        type="button"
                        variant="secondary"
                        size="lg"
                        className="w-full justify-between rounded-2xl border border-white/15 bg-[var(--surface)]/70 px-4 py-3 text-left shadow-[0_10px_24px_-16px_rgba(15,23,42,0.35)]"
                        disabled={isDisabled}
                        aria-expanded={isPickerOpen}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:bg-white/10 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                            <Icon className={`h-4 w-4 ${visual.color}`} />
                          </span>
                          <span className="flex min-w-0 flex-col leading-tight">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                              {t("personal.secretaryLabel")}
                            </span>
                            <span className="truncate text-sm font-semibold text-foreground">
                              {displayName}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">
                              {ownerText ?? t("personal.secretaryPlaceholder")}
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="hidden sm:inline">{t("personal.secretaryPlaceholder")}</span>
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${isPickerOpen ? "rotate-180" : ""}`}
                          />
                        </span>
                      </GlassButton>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[min(520px,92vw)] p-0"
                    align="start"
                    side="bottom"
                    sideOffset={10}
                  >
                    <ModelPicker
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value)
                        setIsPickerOpen(false)
                      }}
                      modelGroups={modelGroups}
                      valueField="id"
                      title={t("personal.secretaryLabel")}
                      subtitle={t("personal.secretaryPlaceholder")}
                      searchPlaceholder={t("personal.modelSearchPlaceholder")}
                      emptyText={t("personal.emptyHint")}
                      noResultsText={t("personal.modelNoResults")}
                      disabled={isDisabled}
                      scrollAreaClassName="h-64 pr-1"
                      className="rounded-2xl border border-white/10"
                    />
                  </PopoverContent>
                </Popover>
                <FormDescription>{t("personal.secretaryHelp")}</FormDescription>
              </FormItem>
            )
          }}
        />
      </GlassCardContent>
      <GlassCardFooter className="justify-end">
        <Badge variant="outline" className="text-xs">
          {t("personal.scopeBadge")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  )
}
