"use client"

import { useState } from "react"
import { HardDriveDownload, ShieldCheck, Lock, ChevronDown } from "lucide-react"
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

interface DesktopEmbeddingSettingsCardProps {
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

export function DesktopEmbeddingSettingsCard({
  control,
  isTauriRuntime,
  canEditDesktop,
  hasAvailableModels,
  modelGroups,
  isLoadingModels = false,
}: DesktopEmbeddingSettingsCardProps) {
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
              {t("desktop.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("desktop.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <HardDriveDownload className="h-3 w-3" />
            {t("desktop.scopeBadge")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {canEditDesktop ? (
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span>
            {canEditDesktop
              ? t("desktop.editableHint")
              : t("desktop.readonlyHint")}
          </span>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        {!isTauriRuntime ? (
          <div className="rounded-2xl border border-white/10 bg-[var(--surface)]/60 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              {t("desktop.unavailableTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("desktop.unavailableDesc")}
            </p>
          </div>
        ) : (
          <FormField
            control={control}
            name="desktopEmbeddingProviderModelId"
            render={({ field }) => {
              const selectedValue = field.value?.trim()
              const selectedModel = findSelectedModel(selectedValue, modelGroups)
              const displayName = isLoadingModels
                ? t("personal.currentLoading")
                : (selectedModel?.model.id ?? selectedValue) || t("personal.currentEmpty")
              const ownerText =
                selectedModel?.model.owned_by || selectedModel?.group?.provider
              const isDisabled = !canEditDesktop || !hasAvailableModels
              const visual = resolveModelVisual(selectedModel?.model)
              const Icon = visual.icon

              return (
                <FormItem>
                  <FormLabel className="sr-only">{t("desktop.modelLabel")}</FormLabel>
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
                                {t("desktop.modelLabel")}
                              </span>
                              <span className="truncate text-sm font-semibold text-foreground">
                                {displayName}
                              </span>
                              <span className="truncate text-[11px] text-muted-foreground">
                                {ownerText ?? t("desktop.modelPlaceholder")}
                              </span>
                            </span>
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <span className="hidden sm:inline">{t("desktop.modelPlaceholder")}</span>
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
                        valueField="provider_model_id"
                        title={t("desktop.modelLabel")}
                        subtitle={t("desktop.modelPlaceholder")}
                        searchPlaceholder={t("personal.modelSearchPlaceholder")}
                        emptyText={t("personal.emptyHint")}
                        noResultsText={t("personal.modelNoResults")}
                        disabled={isDisabled}
                        scrollAreaClassName="h-64 pr-1"
                        className="rounded-2xl border border-white/10"
                      />
                    </PopoverContent>
                  </Popover>
                  <FormDescription>{t("desktop.modelHelp")}</FormDescription>
                </FormItem>
              )
            }}
          />
        )}
      </GlassCardContent>
      <GlassCardFooter className="justify-end">
        <Badge variant="outline" className="text-xs">
          {t("desktop.scopeBadge")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  )
}
