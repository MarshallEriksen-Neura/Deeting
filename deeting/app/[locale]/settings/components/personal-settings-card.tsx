"use client"

import { User, ShieldCheck, Lock } from "lucide-react"
import { Control } from "react-hook-form"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import { ModelPicker } from "@/components/models/model-picker"
import { useI18n } from "@/hooks/use-i18n"
import { type SettingsFormValues, type ModelGroup } from "../types"

interface PersonalSettingsCardProps {
  control: Control<SettingsFormValues>
  canEditPersonal: boolean
  hasAvailableModels: boolean
  modelGroups: ModelGroup[]
}

export function PersonalSettingsCard({ 
  control, 
  canEditPersonal, 
  hasAvailableModels, 
  modelGroups 
}: PersonalSettingsCardProps) {
  const t = useI18n("settings")

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
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">{t("personal.secretaryLabel")}</FormLabel>
              <FormControl>
                <ModelPicker
                  value={field.value}
                  onChange={field.onChange}
                  modelGroups={modelGroups}
                  title={t("personal.secretaryLabel")}
                  subtitle={t("personal.secretaryPlaceholder")}
                  searchPlaceholder={t("personal.modelSearchPlaceholder")}
                  emptyText={t("personal.emptyHint")}
                  noResultsText={t("personal.modelNoResults")}
                  disabled={!canEditPersonal || !hasAvailableModels}
                  scrollAreaClassName="h-64 pr-1"
                />
              </FormControl>
              <FormDescription>{t("personal.secretaryHelp")}</FormDescription>
            </FormItem>
          )}
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
