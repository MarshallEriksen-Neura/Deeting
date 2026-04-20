"use client"

import * as React from "react"
import { Download, Plug, Settings2, Shield } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import { CardContent, CardFooter, CardHeader } from "@/ui/shadcn/card"
import { Avatar, AvatarFallback } from "@/ui/shadcn/avatar"
import { cn } from "@/lib/utils"
import type { PluginMarketSkillItem } from "@/lib/api/plugin-market"
import type { LocalSkillRuntimeStatus } from "@/lib/api/plugin-market"

const COLOR_OPTIONS = [
  "from-blue-500 to-cyan-500",
  "from-pink-500 to-rose-500",
  "from-emerald-500 to-teal-500",
  "from-violet-500 to-purple-500",
  "from-orange-400 to-amber-500",
  "from-fuchsia-500 to-pink-500",
  "from-indigo-500 to-blue-500",
  "from-teal-500 to-green-500",
]

const pickColor = (id: string) => {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 10000
  }
  return COLOR_OPTIONS[hash % COLOR_OPTIONS.length]
}

interface PluginCardProps {
  plugin: PluginMarketSkillItem
  runtimeStatus?: LocalSkillRuntimeStatus | null
  onInstall?: (plugin: PluginMarketSkillItem) => void
  onUninstall?: (skillId: string) => void
  onConfigure?: (plugin: PluginMarketSkillItem) => void
}

export function PluginCard({ plugin, runtimeStatus, onInstall, onUninstall, onConfigure }: PluginCardProps) {
  const t = useTranslations("plugins")
  const color = pickColor(plugin.id)
  const canInstall = typeof onInstall === "function"
  const canUninstall = typeof onUninstall === "function"
  const canConfigure = typeof onConfigure === "function"
  const surfaceLabel =
    runtimeStatus == null
      ? null
      : t(`runtimeLabels.executionSurface.${runtimeStatus.normalized_execution_surface}`)
  const runtimeBadge =
    runtimeStatus == null
      ? null
      : runtimeStatus.runnable_now
        ? { label: t("runtimeStatus.ready"), className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" }
        : runtimeStatus.runtime_install_state === "installing"
          ? { label: t("runtimeStatus.installing"), className: "bg-blue-500/10 text-blue-700 border-blue-500/20" }
        : runtimeStatus.runtime_install_supported && runtimeStatus.runtime_install_state === "install_failed"
          ? { label: t("runtimeStatus.installFailed"), className: "bg-red-500/10 text-red-700 border-red-500/20" }
          : runtimeStatus.runtime_install_supported && runtimeStatus.runtime_install_state !== "ready"
            ? { label: t("runtimeStatus.installRequired"), className: "bg-amber-500/10 text-amber-700 border-amber-500/20" }
        : runtimeStatus.missing_bins.length > 0
          ? { label: t("runtimeStatus.missingBin"), className: "bg-amber-500/10 text-amber-700 border-amber-500/20" }
          : runtimeStatus.missing_env.length > 0
            ? { label: t("runtimeStatus.missingEnv"), className: "bg-amber-500/10 text-amber-700 border-amber-500/20" }
            : runtimeStatus.missing_config.length > 0
              ? { label: t("runtimeStatus.missingConfig"), className: "bg-blue-500/10 text-blue-700 border-blue-500/20" }
              : { label: t("runtimeStatus.docsOnly"), className: "bg-muted text-muted-foreground border-border" }

  return (
    <div className="group relative transition-all duration-300 hover:-translate-y-1 hover:shadow-xl rounded-xl bg-white dark:bg-zinc-900 border border-border overflow-hidden flex flex-col h-full">
      {/* Gradient header */}
      <div
        className={cn(
          "h-24 bg-gradient-to-r opacity-80 relative transition-opacity group-hover:opacity-100",
          color
        )}
      >
        <div className="absolute -bottom-6 left-4">
          <Avatar className="w-16 h-16 border-4 border-white dark:border-zinc-900 shadow-md">
            <AvatarFallback>
              <Plug className="h-6 w-6" />
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      <CardHeader className="pt-8 pb-2 px-4">
        <div className="flex justify-between items-start">
          <div className="space-y-1 min-w-0 flex-1">
            <h3 className="font-bold text-lg leading-none truncate">{plugin.name}</h3>
            {plugin.version && (
              <p className="text-xs text-muted-foreground">v{plugin.version}</p>
            )}
          </div>
          <div className="flex flex-col gap-1 items-end">
            <Badge
              variant={plugin.status === "active" ? "default" : "secondary"}
              className="text-[10px] uppercase tracking-wide shrink-0 ml-2"
            >
              {t(`status.${plugin.status}`)}
            </Badge>
            {runtimeBadge && (
              <Badge variant="outline" className={cn("text-[10px] shrink-0 ml-2", runtimeBadge.className)}>
                {runtimeBadge.label}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-2 flex-1">
        <p className="text-sm text-muted-foreground line-clamp-3 min-h-[2.5rem]">
          {plugin.description || t("card.noDescription")}
        </p>
        {surfaceLabel && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("runtimeConfig.executionSurface", { surface: surfaceLabel })}
          </p>
        )}
        {runtimeStatus && !runtimeStatus.runnable_now && (
          <p className="mt-2 text-xs text-muted-foreground">
            {runtimeStatus.blocking_reason
              ? t(`runtimeStatus.reason.${runtimeStatus.blocking_reason}`)
              : t("runtimeStatus.reason.unknown")}
          </p>
        )}
        {runtimeStatus?.runtime_install_error && !runtimeStatus.runnable_now && (
          <p
            className="mt-2 line-clamp-3 text-[11px] text-destructive break-words"
            title={runtimeStatus.runtime_install_error}
          >
            {runtimeStatus.runtime_install_error}
          </p>
        )}
      </CardContent>

      <CardFooter className="px-4 py-4 border-t bg-muted/30 flex justify-between items-center mt-auto">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Shield size={12} />
          <span>
            {runtimeStatus && !runtimeStatus.runnable_now
              ? t("card.missingRuntime")
              : t("card.permissions")}
          </span>
        </div>

        {plugin.installed ? (
          <div className="flex items-center gap-2">
            {runtimeStatus && canConfigure && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full px-3 h-8 text-xs"
                onClick={() => onConfigure?.(plugin)}
              >
                <Settings2 size={14} className="mr-1" />
                {t("card.configure")}
              </Button>
            )}
            {canUninstall ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full px-4 h-8 text-xs font-bold text-green-600 border-green-600/30 hover:bg-red-50 hover:text-red-600 hover:border-red-600/30 dark:hover:bg-red-950/20 transition-colors group/btn"
                onClick={() => onUninstall?.(plugin.id)}
              >
                <span className="group-hover/btn:hidden">{t("card.installed")}</span>
                <span className="hidden group-hover/btn:inline">{t("card.uninstall")}</span>
              </Button>
            ) : (
              <Badge variant="outline" className="text-xs">
                {t("card.installed")}
              </Badge>
            )}
          </div>
        ) : canInstall ? (
          <Button
            size="sm"
            className="rounded-full px-4 h-8 text-xs font-bold shadow-lg transition-all duration-300"
            onClick={() => onInstall?.(plugin)}
          >
            <Download size={14} className="mr-1" />
            {t("card.install")}
          </Button>
        ) : null}
      </CardFooter>
    </div>
  )
}
