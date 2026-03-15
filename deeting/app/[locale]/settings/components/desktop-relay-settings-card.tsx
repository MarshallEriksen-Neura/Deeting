"use client"

import { useState } from "react"
import { Control } from "react-hook-form"
import { Server, Link2, Lock } from "lucide-react"

import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import { useI18n } from "@/hooks/use-i18n"
import type { SettingsFormValues } from "../types"

interface DesktopRelaySettingsCardProps {
  control: Control<SettingsFormValues>
  isTauriRuntime: boolean
  canEditDesktop: boolean
}

export function DesktopRelaySettingsCard({
  control,
  isTauriRuntime,
  canEditDesktop,
}: DesktopRelaySettingsCardProps) {
  const t = useI18n("settings")
  const [showSecret, setShowSecret] = useState(false)

  if (!isTauriRuntime) {
    return null
  }

  const isDisabled = !canEditDesktop

  return (
    <GlassCard blur="default" theme="surface" hover="lift" padding="lg" className="border-0">
      <GlassCardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <GlassCardTitle className="text-lg text-foreground">
              {t("desktop.relay.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("desktop.relay.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Server className="h-3 w-3" />
            {t("desktop.scopeBadge")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          <span>{t("desktop.relay.securityHint")}</span>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        <FormField
          control={control}
          name="relayBaseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("desktop.relay.baseUrlLabel")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground">
                    <Link2 className="mr-1 h-3 w-3" />
                  </span>
                  <Input
                    {...field}
                    type="url"
                    placeholder="https://your-relay.example.com"
                    className="pl-8"
                    disabled={isDisabled}
                  />
                </div>
              </FormControl>
              <FormDescription>{t("desktop.relay.baseUrlHelp")}</FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="relaySharedSecret"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("desktop.relay.sharedSecretLabel")}</FormLabel>
              <FormControl>
                <div className="relative flex items-center gap-2">
                  <Input
                    {...field}
                    type={showSecret ? "text" : "password"}
                    placeholder="********"
                    disabled={isDisabled}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {showSecret ? t("desktop.relay.hideSecret") : t("desktop.relay.showSecret")}
                  </button>
                </div>
              </FormControl>
              <FormDescription>{t("desktop.relay.sharedSecretHelp")}</FormDescription>
            </FormItem>
          )}
        />
      </GlassCardContent>
      <GlassCardFooter className="justify-end">
        <Badge variant="outline" className="text-xs">
          {t("desktop.relay.footerHint")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  )
}
