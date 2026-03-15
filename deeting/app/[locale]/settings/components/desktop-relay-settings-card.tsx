"use client"

import { useState } from "react"
import type { Control } from "react-hook-form"
import { Link2, Lock, PlugZap, Radio, Server } from "lucide-react"

import type { DesktopImSettingsSnapshot } from "@/lib/api/desktop-im"
import { getPrimaryFeishuResolution } from "@/lib/api/desktop-im"
import { Badge } from "@/components/ui/badge"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/hooks/use-i18n"
import type { SettingsFormValues } from "../types"

interface DesktopImSettingsCardProps {
  control: Control<SettingsFormValues>
  isTauriRuntime: boolean
  canEditDesktop: boolean
  snapshot: DesktopImSettingsSnapshot | null
}

export function DesktopImSettingsCard({
  control,
  isTauriRuntime,
  canEditDesktop,
  snapshot,
}: DesktopImSettingsCardProps) {
  const t = useI18n("settings")
  const [showDirectSecret, setShowDirectSecret] = useState(false)
  const [showRelaySecret, setShowRelaySecret] = useState(false)

  if (!isTauriRuntime) {
    return null
  }

  const isDisabled = !canEditDesktop
  const resolution = getPrimaryFeishuResolution(snapshot)
  const effectiveTransportKey = resolution?.resolution.effective ?? "unavailable"

  return (
    <GlassCard blur="default" theme="surface" hover="lift" padding="lg" className="border-0">
      <GlassCardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <GlassCardTitle className="text-lg text-foreground">
              {t("desktop.im.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("desktop.im.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Server className="h-3 w-3" />
            {t("desktop.scopeBadge")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          <span>{t("desktop.im.securityHint")}</span>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-5">
        <FormField
          control={control}
          name="imFeishuEnabled"
          render={({ field }) => (
            <FormItem className="rounded-2xl border border-white/10 bg-[var(--surface)]/50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <FormLabel>{t("desktop.im.enabledLabel")}</FormLabel>
                  <FormDescription>{t("desktop.im.enabledHelp")}</FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isDisabled}
                  />
                </FormControl>
              </div>
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="imFeishuTransportPreference"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("desktop.im.transportPreferenceLabel")}</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isDisabled}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("desktop.im.transportPreferencePlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="auto">{t("desktop.im.transport.auto")}</SelectItem>
                    <SelectItem value="direct">{t("desktop.im.transport.direct")}</SelectItem>
                    <SelectItem value="relay">{t("desktop.im.transport.relay")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>{t("desktop.im.transportPreferenceHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <div className="rounded-2xl border border-white/10 bg-[var(--surface)]/50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t("desktop.im.effectiveTransportLabel")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {resolution?.resolution.user_message ?? t("desktop.im.effectiveTransportHelp")}
                </p>
              </div>
              <Badge variant="outline" className="gap-1">
                <Radio className="h-3 w-3" />
                {t(`desktop.im.effective.${effectiveTransportKey}`)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-[var(--surface)]/50 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("desktop.im.directTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("desktop.im.directDescription")}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              control={control}
              name="imFeishuAppId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("desktop.im.appIdLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="cli_xxx"
                      disabled={isDisabled}
                    />
                  </FormControl>
                  <FormDescription>{t("desktop.im.appIdHelp")}</FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="imFeishuAppSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("desktop.im.appSecretLabel")}</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Input
                        {...field}
                        type={showDirectSecret ? "text" : "password"}
                        placeholder="********"
                        disabled={isDisabled}
                      />
                      <button
                        type="button"
                        onClick={() => setShowDirectSecret((value) => !value)}
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {showDirectSecret
                          ? t("desktop.im.hideSecret")
                          : t("desktop.im.showSecret")}
                      </button>
                    </div>
                  </FormControl>
                  <FormDescription>{t("desktop.im.appSecretHelp")}</FormDescription>
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-[var(--surface)]/50 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("desktop.im.relayTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("desktop.im.relayDescription")}</p>
          </div>

          <FormField
            control={control}
            name="imFeishuRelayBaseUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("desktop.im.relayBaseUrlLabel")}</FormLabel>
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
                <FormDescription>{t("desktop.im.relayBaseUrlHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="imFeishuRelaySharedSecret"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("desktop.im.relaySharedSecretLabel")}</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <Input
                      {...field}
                      type={showRelaySecret ? "text" : "password"}
                      placeholder="********"
                      disabled={isDisabled}
                    />
                    <button
                      type="button"
                      onClick={() => setShowRelaySecret((value) => !value)}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {showRelaySecret
                        ? t("desktop.im.hideSecret")
                        : t("desktop.im.showSecret")}
                    </button>
                  </div>
                </FormControl>
                <FormDescription>{t("desktop.im.relaySharedSecretHelp")}</FormDescription>
              </FormItem>
            )}
          />
        </div>
      </GlassCardContent>

      <GlassCardFooter className="justify-between gap-3">
        <Badge variant="outline" className="gap-1 text-xs">
          <PlugZap className="h-3 w-3" />
          {t("desktop.im.platformLabel")}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {t("desktop.im.footerHint")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  )
}
