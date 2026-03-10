"use client"

import * as React from "react"
import Link from "next/link"
import { Search, Package } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { PluginCard } from "@/components/plugins/plugin-card"
import { PermissionConfirmDialog } from "@/components/plugins/permission-confirm-dialog"
import { ImportRepoDialog } from "@/components/plugins/import-repo-dialog"
import { repairLocalSystemAssetIndexFromCloud } from "@/lib/api/desktop-system-assets"
import { usePluginMarket } from "@/lib/swr/use-plugin-market"
import {
  installPlugin,
  isDesktopRuntime,
  submitPluginRepo,
  syncLocalSkillInstallsFromCloud,
  uninstallPlugin,
} from "@/lib/api/plugin-market"
import { useDebounce } from "@/hooks/use-debounce"
import type { PluginMarketSkillItem } from "@/lib/api/plugin-market"

type PluginsViewMode = "installed" | "market"

interface PluginsClientProps {
  mode?: PluginsViewMode
}

export function PluginsClient({ mode = "installed" }: PluginsClientProps) {
  const t = useTranslations("plugins")
  const isMarketMode = mode === "market"
  const [searchQuery, setSearchQuery] = React.useState("")
  const debouncedQuery = useDebounce(searchQuery, 300)

  const { plugins, isLoading, error, mutate } = usePluginMarket()

  // Permission dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [selectedPlugin, setSelectedPlugin] = React.useState<PluginMarketSkillItem | null>(null)
  const [isInstalling, setIsInstalling] = React.useState(false)
  const [repairConfirmOpen, setRepairConfirmOpen] = React.useState(false)
  const [syncMode, setSyncMode] = React.useState<"sync" | "reinstall" | "repair" | null>(null)
  const showDesktopSync = isDesktopRuntime()

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
      void (async () => {
        for (let index = 0; index < 6; index += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000))
          await mutate()
        }
      })()
    },
    [mutate, t],
  )

  const handleSyncInstalls = React.useCallback(async (reinstallMissing: boolean) => {
    setSyncMode(reinstallMissing ? "reinstall" : "sync")
    try {
      const syncResult = await syncLocalSkillInstallsFromCloud({
        reinstallMissing,
        force: true,
      })
      if (syncResult) {
        toast.success(t("toast.syncSuccessTitle"), {
          description: t("toast.syncSuccessDesc", {
            fetched: syncResult.fetched_count,
            upserted: syncResult.upserted_count,
            reinstalled: syncResult.reinstalled_count,
            failed: syncResult.failed_count,
          }),
        })
      } else {
        toast.success(t("toast.syncSuccessTitle"), {
          description: t("toast.syncSuccessDescNoop"),
        })
      }
      await mutate()
    } catch {
      toast.error(t("toast.syncFailedTitle"), {
        description: t("toast.syncFailedDesc"),
      })
    } finally {
      setSyncMode(null)
    }
  }, [mutate, t])

  const handleRepairIndex = React.useCallback(async () => {
    setRepairConfirmOpen(false)
    setSyncMode("repair")
    try {
      const repairResult = await repairLocalSystemAssetIndexFromCloud()
      if (repairResult) {
        toast.success(t("toast.repairSuccessTitle"), {
          description: t("toast.repairSuccessDesc", {
            fetched: repairResult.sync.fetched_count,
            upserted: repairResult.sync.upserted_count,
            skills: repairResult.skill_reindexed_count,
            assistants: repairResult.assistant_reindexed_count,
          }),
        })
      } else {
        toast.success(t("toast.repairSuccessTitle"), {
          description: t("toast.repairSuccessDescNoop"),
        })
      }
      await mutate()
    } catch {
      toast.error(t("toast.repairFailedTitle"), {
        description: t("toast.repairFailedDesc"),
      })
    } finally {
      setSyncMode(null)
    }
  }, [mutate, t])

  const installedPlugins = React.useMemo(
    () => plugins.filter((plugin) => plugin.installed),
    [plugins],
  )

  const normalizedQuery = debouncedQuery.trim().toLowerCase()
  const matchPlugin = React.useCallback(
    (plugin: PluginMarketSkillItem) => {
      if (!normalizedQuery) return true
      const haystack = [
        plugin.name,
        plugin.description ?? "",
        plugin.id,
        plugin.source_repo ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    },
    [normalizedQuery],
  )

  const filteredMarketPlugins = React.useMemo(
    () => plugins.filter(matchPlugin),
    [matchPlugin, plugins],
  )
  const filteredInstalledPlugins = React.useMemo(
    () => installedPlugins.filter(matchPlugin),
    [installedPlugins, matchPlugin],
  )
  const visiblePlugins = isMarketMode ? filteredMarketPlugins : filteredInstalledPlugins

  const isInitialLoading = isLoading && plugins.length === 0
  const pageTitle = isMarketMode ? t("page.market.title") : t("page.installed.title")
  const pageSubtitle = isMarketMode
    ? t("page.market.description")
    : t("page.installed.description")
  const emptyTitle = isMarketMode ? t("page.empty.title") : t("page.emptyInstalled.title")
  const emptyDescription =
    isMarketMode ? t("page.empty.description") : t("page.emptyInstalled.description")

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
        <p className="text-muted-foreground text-lg">{pageTitle}</p>
        <p className="text-muted-foreground">{pageSubtitle}</p>

        {/* Import from GitHub */}
        {isMarketMode ? (
          <div className="pt-2 flex items-center justify-center gap-2 flex-wrap">
            <ImportRepoDialog onSubmit={handleImportRepo} />
            {showDesktopSync && (
              <>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void handleSyncInstalls(false)}
                  disabled={syncMode !== null}
                >
                  {syncMode === "sync" ? t("page.syncing") : t("page.syncAction")}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void handleSyncInstalls(true)}
                  disabled={syncMode !== null}
                >
                  {syncMode === "reinstall"
                    ? t("page.syncing")
                    : t("page.syncReinstallAction")}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setRepairConfirmOpen(true)}
                  disabled={syncMode !== null}
                >
                  {syncMode === "repair" ? t("page.repairingAction") : t("page.repairIndexAction")}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="pt-2 flex items-center justify-center gap-2 flex-wrap">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/plugins/market">{t("page.marketEntry")}</Link>
            </Button>
            {showDesktopSync && (
              <>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void handleSyncInstalls(false)}
                  disabled={syncMode !== null}
                >
                  {syncMode === "sync" ? t("page.syncing") : t("page.syncAction")}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void handleSyncInstalls(true)}
                  disabled={syncMode !== null}
                >
                  {syncMode === "reinstall"
                    ? t("page.syncing")
                    : t("page.syncReinstallAction")}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setRepairConfirmOpen(true)}
                  disabled={syncMode !== null}
                >
                  {syncMode === "repair" ? t("page.repairingAction") : t("page.repairIndexAction")}
                </Button>
              </>
            )}
          </div>
        )}

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
          : visiblePlugins.length === 0
            ? (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-semibold text-muted-foreground">
                  {emptyTitle}
                </h3>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {emptyDescription}
                </p>
              </div>
            )
            : visiblePlugins.map((plugin) => (
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

      <AlertDialog open={repairConfirmOpen} onOpenChange={setRepairConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repairConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("repairConfirm.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t("repairConfirm.warning")}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("repairConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => void handleRepairIndex()}
              disabled={syncMode === "repair"}
            >
              {syncMode === "repair" ? t("page.repairingAction") : t("repairConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
