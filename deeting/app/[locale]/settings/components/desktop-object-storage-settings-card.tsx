"use client"

import { useState } from "react"
import type { Control } from "react-hook-form"
import { Database, Eye, EyeOff, HardDriveDownload, KeyRound, Link2 } from "lucide-react"

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

interface DesktopObjectStorageSettingsCardProps {
  control: Control<SettingsFormValues>
  isTauriRuntime: boolean
  canEditDesktop: boolean
}

export function DesktopObjectStorageSettingsCard({
  control,
  isTauriRuntime,
  canEditDesktop,
}: DesktopObjectStorageSettingsCardProps) {
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
              {t("storage.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("storage.description")}
            </GlassCardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <HardDriveDownload className="h-3 w-3" />
            {t("storage.scopeBadge")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          <span>{t("storage.securityHint")}</span>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-5">
        <FormField
          control={control}
          name="objectStorageEnabled"
          render={({ field }) => (
            <FormItem className="rounded-2xl border border-white/10 bg-[var(--surface)]/50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <FormLabel>{t("storage.enabledLabel")}</FormLabel>
                  <FormDescription>{t("storage.enabledHelp")}</FormDescription>
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
            name="objectStorageProvider"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("storage.providerLabel")}</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isDisabled}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("storage.providerPlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="cloudflare_r2_s3">
                      {t("storage.provider.cloudflare_r2_s3")}
                    </SelectItem>
                    <SelectItem value="aliyun_oss">
                      {t("storage.provider.aliyun_oss")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>{t("storage.providerHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStorageBucket"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("storage.bucketLabel")}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="deeting-assets" disabled={isDisabled} />
                </FormControl>
                <FormDescription>{t("storage.bucketHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStorageRegion"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("storage.regionLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t("storage.regionPlaceholder")}
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormDescription>{t("storage.regionHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStorageIsPathStyle"
            render={({ field }) => (
              <FormItem className="rounded-2xl border border-white/10 bg-[var(--surface)]/50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <FormLabel>{t("storage.pathStyleLabel")}</FormLabel>
                    <FormDescription>{t("storage.pathStyleHelp")}</FormDescription>
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
        </div>

        <FormField
          control={control}
          name="objectStorageEndpoint"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("storage.endpointLabel")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground">
                    <Link2 className="mr-1 h-3 w-3" />
                  </span>
                  <Input
                    {...field}
                    type="url"
                    placeholder={t("storage.endpointPlaceholder")}
                    className="pl-8"
                    disabled={isDisabled}
                  />
                </div>
              </FormControl>
              <FormDescription>{t("storage.endpointHelp")}</FormDescription>
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="objectStoragePublicBaseUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("storage.publicBaseUrlLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="url"
                    placeholder={t("storage.publicBaseUrlPlaceholder")}
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormDescription>{t("storage.publicBaseUrlHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStoragePathPrefix"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("storage.pathPrefixLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="desktop/uploads"
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormDescription>{t("storage.pathPrefixHelp")}</FormDescription>
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="objectStorageAccessKeyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("storage.accessKeyIdLabel")}</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground">
                      <KeyRound className="mr-1 h-3 w-3" />
                    </span>
                    <Input
                      {...field}
                      placeholder="AKIA..."
                      className="pl-8"
                      disabled={isDisabled}
                    />
                  </div>
                </FormControl>
                <FormDescription>{t("storage.accessKeyIdHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStorageSecretAccessKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("storage.secretAccessKeyLabel")}</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <Input
                      {...field}
                      type={showSecret ? "text" : "password"}
                      placeholder="********"
                      disabled={isDisabled}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((value) => !value)}
                      className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {showSecret ? (
                        <>
                          <EyeOff className="h-3.5 w-3.5" />
                          {t("storage.hideSecret")}
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" />
                          {t("storage.showSecret")}
                        </>
                      )}
                    </button>
                  </div>
                </FormControl>
                <FormDescription>{t("storage.secretAccessKeyHelp")}</FormDescription>
              </FormItem>
            )}
          />
        </div>
      </GlassCardContent>

      <GlassCardFooter className="justify-end">
        <Badge variant="outline" className="text-xs">
          {t("storage.footerHint")}
        </Badge>
      </GlassCardFooter>
    </GlassCard>
  )
}
