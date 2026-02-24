"use client"

import * as React from "react"
import { Search, Package } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { PluginCard } from "@/components/plugins/plugin-card"
import { PermissionConfirmDialog } from "@/components/plugins/permission-confirm-dialog"
import { ImportRepoDialog } from "@/components/plugins/import-repo-dialog"
import { usePluginMarket } from "@/lib/swr/use-plugin-market"
import { installPlugin, uninstallPlugin, submitPluginRepo } from "@/lib/api/plugin-market"
import { useDebounce } from "@/hooks/use-debounce"
import type { PluginMarketSkillItem } from "@/lib/api/plugin-market"

export function PluginsClient() {
  const t = useTranslations("plugins")
  const [searchQuery, setSearchQuery] = React.useState("")
  const debouncedQuery = useDebounce(searchQuery, 300)

  const { plugins, isLoading, error, mutate } = usePluginMarket({
    q: debouncedQuery || undefined,
  })

  // Permission dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [selectedPlugin, setSelectedPlugin] = React.useState<PluginMarketSkillItem | null>(null)
  const [isInstalling, setIsInstalling] = React.useState(false)

  const handleInstallClick = React.useCallback((plugin: PluginMarketSkillItem) => {
    setSelectedPlugin(plugin)
    setDialogOpen(true)
  }, [])

  const handleConfirmInstall = React.useCallback(
    async (skillId: string, alias?: string) => {
      setIsInstalling(true)
      try {
        await installPlugin(skillId, alias ? { alias } : undefined)
        toast.success(
          t("toast.installedTitle", { name: selectedPlugin?.name ?? skillId }),
          { description: t("toast.installedDesc") }
        )
        setDialogOpen(false)
        await mutate()
      } catch {
        toast.error(t("toast.installFailedTitle"), {
          description: t("toast.installFailedDesc"),
        })
      } finally {
        setIsInstalling(false)
      }
    },
    [mutate, selectedPlugin?.name, t]
  )

  const handleUninstall = React.useCallback(
    async (skillId: string) => {
      try {
        await uninstallPlugin(skillId)
        toast.success(t("toast.uninstalledTitle"), {
          description: t("toast.uninstalledDesc"),
        })
        await mutate()
      } catch {
        toast.error(t("toast.uninstallFailedTitle"), {
          description: t("toast.uninstallFailedDesc"),
        })
      }
    },
    [mutate, t]
  )

  const handleImportRepo = React.useCallback(
    async (payload: { repo_url: string; revision?: string; skill_id?: string }) => {
      await submitPluginRepo(payload)
      toast.success(t("importRepo.successTitle"), {
        description: t("importRepo.successDesc"),
      })
      await mutate()
    },
    [mutate, t],
  )

  const isInitialLoading = isLoading && plugins.length === 0

  return (
    <div className="min-h-[60vh] space-y-8 animate-in fade-in duration-700">
      {/* Hero section */}
      <div className="text-center space-y-4 max-w-2xl mx-auto py-10 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[150%] bg-gradient-to-r from-primary/20 via-purple-500/20 to-pink-500/20 blur-3xl -z-10 opacity-50 rounded-full pointer-events-none" />

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t("page.hero.titlePrefix")}{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-blue-600">
            {t("page.hero.titleHighlight")}
          </span>
        </h1>
        <p className="text-muted-foreground text-lg">{t("page.hero.subtitle")}</p>

        {/* Import from GitHub */}
        <div className="pt-2">
          <ImportRepoDialog onSubmit={handleImportRepo} />
        </div>

        {/* Search */}
        <div className="relative group max-w-lg mx-auto mt-8">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-1000" />
          <div className="relative flex items-center bg-background rounded-xl shadow-xl border border-border/50">
            <Search className="ml-4 text-muted-foreground" />
            <Input
              className="border-none shadow-none focus-visible:ring-0 text-lg py-6 bg-transparent"
              placeholder={t("page.search.placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300">
          {t("page.error.loadFailed", { message: error.message || "unknown" })}
        </div>
      )}

      {/* Plugin grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
        {isInitialLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card p-4 space-y-4"
              >
                <div className="h-24 bg-muted rounded-lg animate-pulse" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <div className="space-y-2 pt-4">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))
          : plugins.length === 0
            ? (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-semibold text-muted-foreground">
                  {t("page.empty.title")}
                </h3>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {t("page.empty.description")}
                </p>
              </div>
            )
            : plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onInstall={handleInstallClick}
                onUninstall={handleUninstall}
              />
            ))}
      </div>

      {/* Permission confirmation dialog */}
      <PermissionConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plugin={selectedPlugin}
        onConfirm={handleConfirmInstall}
        isInstalling={isInstalling}
      />
    </div>
  )
}
