"use client"

import Link from "next/link"
import { Monitor, ShieldCheck, Lock, Download } from "lucide-react"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { GlassButton } from "@/components/ui/glass-button"
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

interface DesktopSettingsCardProps {
  control: Control<SettingsFormValues>
  canEditDesktop: boolean
  isTauri: boolean
}

export function DesktopSettingsCard({ control, canEditDesktop, isTauri }: DesktopSettingsCardProps) {
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
            <GlassCardTitle className="text-lg text-slate-900">
              {t("desktop.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-slate-600">
              {t("desktop.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Monitor className="h-3 w-3" />
            {t("env.desktop")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {canEditDesktop ? (
            <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-slate-400" />
          )}
          <span>
            {canEditDesktop
              ? t("desktop.editableHint")
              : t("desktop.readonlyHint")}
          </span>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        <FormField
          control={control}
          name="desktopModel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("desktop.modelLabel")}</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                disabled={!canEditDesktop}
              >
                <FormControl>
                  <SelectTrigger disabled={!canEditDesktop}>
                    <SelectValue placeholder={t("desktop.modelPlaceholder")} />
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
              <FormDescription>{t("desktop.modelHelp")}</FormDescription>
            </FormItem>
          )}
        />
        {!isTauri && (
          <Alert className="border-0 bg-slate-50">
            <Download className="h-4 w-4 text-slate-500" />
            <AlertTitle className="text-slate-800">
              {t("desktop.unavailableTitle")}
            </AlertTitle>
            <AlertDescription className="text-slate-600">
              <p>{t("desktop.unavailableDesc")}</p>
              <div className="mt-3">
                <GlassButton asChild variant="secondary" size="sm">
                  <Link href="/market">{t("desktop.download")}</Link>
                </GlassButton>
              </div>
            </AlertDescription>
          </Alert>
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