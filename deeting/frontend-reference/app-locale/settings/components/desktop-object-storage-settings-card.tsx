"use client"

import { useState } from "react"
import { useWatch, type Control } from "react-hook-form"
import { Database, Eye, EyeOff, KeyRound, Link2 } from "lucide-react"

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/ui/shadcn/form"
import { Input } from "@/ui/shadcn/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select"
import { Switch } from "@/ui/shadcn/switch"
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
  const provider = useWatch({ control, name: "objectStorageProvider" }) ?? "cloudflare_r2_s3"
  const isAliyunOss = provider === "aliyun_oss"

  if (!isTauriRuntime) {
    return null
  }

  const isDisabled = !canEditDesktop

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400">
            <Database className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("storage.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("storage.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          <span>{t("storage.securityHint")}</span>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-5 px-6 py-5">
        {/* Enable toggle */}
        <FormField
          control={control}
          name="objectStorageEnabled"
          render={({ field }) => (
            <FormItem className="rounded-xl border border-border/30 bg-muted/15 px-4 py-3 dark:bg-muted/10">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <FormLabel className="text-sm">{t("storage.enabledLabel")}</FormLabel>
                  <FormDescription className="text-xs">{t("storage.enabledHelp")}</FormDescription>
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

        {/* Provider & Bucket row */}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="objectStorageProvider"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">{t("storage.providerLabel")}</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isDisabled}
                >
                  <FormControl>
                    <SelectTrigger className="rounded-xl">
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
                <FormDescription className="text-xs">{t("storage.providerHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStorageBucket"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">{t("storage.bucketLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t(
                      isAliyunOss
                        ? "storage.bucketPlaceholderAliyun"
                        : "storage.bucketPlaceholder",
                    )}
                    className="rounded-xl"
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  {t(isAliyunOss ? "storage.bucketHelpAliyun" : "storage.bucketHelp")}
                </FormDescription>
              </FormItem>
            )}
          />
        </div>

        {/* Region & Path-style row */}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="objectStorageRegion"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">{t("storage.regionLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t(
                      isAliyunOss
                        ? "storage.regionPlaceholderAliyun"
                        : "storage.regionPlaceholder",
                    )}
                    className="rounded-xl"
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  {t(isAliyunOss ? "storage.regionHelpAliyun" : "storage.regionHelp")}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStorageIsPathStyle"
            render={({ field }) => (
              <FormItem className="rounded-xl border border-border/30 bg-muted/15 px-4 py-3 dark:bg-muted/10">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <FormLabel className="text-xs font-medium">{t("storage.pathStyleLabel")}</FormLabel>
                    <FormDescription className="text-xs">
                      {t(isAliyunOss ? "storage.pathStyleHelpAliyun" : "storage.pathStyleHelp")}
                    </FormDescription>
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

        {/* Endpoint */}
        <FormField
          control={control}
          name="objectStorageEndpoint"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-medium">{t("storage.endpointLabel")}</FormLabel>
              <FormControl>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" />
                  </span>
                  <Input
                    {...field}
                    type="url"
                    placeholder={t(
                      isAliyunOss
                        ? "storage.endpointPlaceholderAliyun"
                        : "storage.endpointPlaceholder",
                    )}
                    className="rounded-xl pl-9"
                    disabled={isDisabled}
                  />
                </div>
              </FormControl>
              <FormDescription className="text-xs">
                {t(isAliyunOss ? "storage.endpointHelpAliyun" : "storage.endpointHelp")}
              </FormDescription>
            </FormItem>
          )}
        />

        {/* Public URL & Path prefix row */}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="objectStoragePublicBaseUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">{t("storage.publicBaseUrlLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="url"
                    placeholder={t(
                      isAliyunOss
                        ? "storage.publicBaseUrlPlaceholderAliyun"
                        : "storage.publicBaseUrlPlaceholder",
                    )}
                    className="rounded-xl"
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  {t(
                    isAliyunOss
                      ? "storage.publicBaseUrlHelpAliyun"
                      : "storage.publicBaseUrlHelp",
                  )}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStoragePathPrefix"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">{t("storage.pathPrefixLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="desktop/uploads"
                    className="rounded-xl"
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormDescription className="text-xs">{t("storage.pathPrefixHelp")}</FormDescription>
              </FormItem>
            )}
          />
        </div>

        {/* Credentials row */}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="objectStorageAccessKeyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">{t("storage.accessKeyIdLabel")}</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5" />
                    </span>
                    <Input
                      {...field}
                      placeholder="AKIA..."
                      className="rounded-xl pl-9"
                      disabled={isDisabled}
                    />
                  </div>
                </FormControl>
                <FormDescription className="text-xs">{t("storage.accessKeyIdHelp")}</FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="objectStorageSecretAccessKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">{t("storage.secretAccessKeyLabel")}</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <Input
                      {...field}
                      type={showSecret ? "text" : "password"}
                      placeholder="********"
                      className="rounded-xl"
                      disabled={isDisabled}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((value) => !value)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
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
                <FormDescription className="text-xs">{t("storage.secretAccessKeyHelp")}</FormDescription>
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">
          {t("storage.footerHint")}
        </span>
      </div>
    </div>
  )
}
