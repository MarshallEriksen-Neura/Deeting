"use client"

import { Cloud, ShieldCheck, Lock } from "lucide-react"
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/hooks/use-i18n"
import { EMBEDDING_MODELS, type SettingsFormValues } from "../types"

interface CloudSettingsCardProps {
  control: Control<SettingsFormValues>
  canEditCloud: boolean
}

export function CloudSettingsCard({ control, canEditCloud }: CloudSettingsCardProps) {
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
              {t("cloud.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("cloud.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Cloud className="h-3 w-3" />
            {t("env.cloud")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {canEditCloud ? (
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span>
            {canEditCloud ? t("cloud.editableHint") : t("cloud.readonlyHint")}
          </span>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        <FormField
          control={control}
          name="cloudModel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("cloud.modelLabel")}</FormLabel>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[var(--surface)]/60 px-4 py-3 text-xs text-muted-foreground">
                <span>{t("cloud.currentLabel")}</span>
                <span className="text-sm font-semibold text-foreground">
                  {field.value || t("cloud.currentEmpty")}
                </span>
              </div>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={!canEditCloud}
              >
                <FormControl>
                  <SelectTrigger disabled={!canEditCloud}>
                    <SelectValue placeholder={t("cloud.modelPlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {EMBEDDING_MODELS.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>{t("cloud.modelHelp")}</FormDescription>
            </FormItem>
          )}
        />
        <div className="rounded-lg border border-white/10 bg-[var(--surface)]/50 px-4 py-3 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>{t("cloud.scopeLabel")}</span>
            <span className="text-foreground">{t("cloud.scopeValue")}</span>
          </div>
        </div>
      </GlassCardContent>
      <GlassCardFooter className="justify-end">
        <Badge variant="outline" className="text-xs">
          {t("cloud.scopeBadge")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  )
}
