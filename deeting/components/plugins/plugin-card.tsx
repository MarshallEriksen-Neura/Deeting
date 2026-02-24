"use client"

import * as React from "react"
import { Download, GitBranch, Plug, Shield } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { PluginMarketSkillItem } from "@/lib/api/plugin-market"

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
  onInstall?: (plugin: PluginMarketSkillItem) => void
  onUninstall?: (skillId: string) => void
}

export function PluginCard({ plugin, onInstall, onUninstall }: PluginCardProps) {
  const t = useTranslations("plugins")
  const color = pickColor(plugin.id)
  const repoName = plugin.source_repo
    ? plugin.source_repo.replace(/^https?:\/\/github\.com\//, "")
    : null

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
          <Badge
            variant={plugin.status === "active" ? "default" : "secondary"}
            className="text-[10px] uppercase tracking-wide shrink-0 ml-2"
          >
            {t(`status.${plugin.status}`)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-2 flex-1">
        <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
          {plugin.description || t("card.noDescription")}
        </p>
        {repoName && (
          <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
            <GitBranch size={12} />
            <span className="truncate">{repoName}</span>
            {plugin.source_revision && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">
                {plugin.source_revision}
              </Badge>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="px-4 py-4 border-t bg-muted/30 flex justify-between items-center mt-auto">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Shield size={12} />
          <span>{t("card.permissions")}</span>
        </div>

        {plugin.installed ? (
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
          <Button
            size="sm"
            className="rounded-full px-4 h-8 text-xs font-bold shadow-lg transition-all duration-300"
            onClick={() => onInstall?.(plugin)}
          >
            <Download size={14} className="mr-1" />
            {t("card.install")}
          </Button>
        )}
      </CardFooter>
    </div>
  )
}
