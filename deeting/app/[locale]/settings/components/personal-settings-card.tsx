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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
              <FormLabel>{t("personal.secretaryLabel")}</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                disabled={!canEditPersonal || !hasAvailableModels}
              >
                <FormControl>
                  <SelectTrigger disabled={!canEditPersonal || !hasAvailableModels}>
                    <SelectValue placeholder={t("personal.secretaryPlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {hasAvailableModels ? (
                    modelGroups.map((group) => (
                      <SelectGroup key={group.instance_id}>
                        <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {group.instance_name}
                        </SelectLabel>
                        {group.models.map((model) => (
                          <SelectItem key={`${group.instance_id}-${model.id}`} value={model.id}>
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-foreground">{model.id}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {group.provider || model.owned_by || "provider"}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))
                  ) : (
                    <SelectItem value="empty" disabled>
                      {t("personal.emptyHint")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
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
