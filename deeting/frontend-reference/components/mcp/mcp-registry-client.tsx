"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { invoke } from "@tauri-apps/api/core"
import {
  mapDesktopToolRecordToTool,
  mapRemoteServerToolRecordToTool,
} from "@/lib/mcp/registry-mappers"
import {
  useMcpRegistryServerActions,
} from "@/components/mcp/registry-server-actions"
import {
  useMcpRegistryToolActions,
} from "@/components/mcp/registry-tool-actions"
import {
  getMcpRegistryErrorNotification,
} from "./registry-notifications"
import { useMcpRegistryImportAction } from "./registry-import"
import {
  useMcpRegistrySourceActions,
} from "@/components/mcp/registry-source-actions"
import {
  useMcpRegistryClearLogsAction,
  useMcpRegistryHydration,
  useMcpRegistryIndexProgress,
  useMcpRegistryLoadErrorEffect,
  useMcpRegistryRefreshAll,
  useMcpRegistryToolLogs,
  type McpToolIndexProgressEvent,
} from "./registry-effects"
import { useMcpRegistryViewModel } from "@/components/mcp/registry-view-model"
import { RegistryHeader } from "./registry-header"
import { Skeleton } from "@/ui/shadcn/skeleton"
import { MCPLogEntry, MCPSource, MCPTool, McpToolRecord } from "@/types/mcp"
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop"
import { useMcpServers } from "@/lib/swr/use-mcp-servers"
import { useMcpSources } from "@/lib/swr/use-mcp-sources"
import { useMcpTools, type McpServerToolRecord } from "@/lib/swr/use-mcp-tools"
import { useMcpToolToggle } from "@/lib/swr/use-mcp-tool-toggle"
import { type McpServer } from "@/lib/api/mcp"
import { useAuthStore } from "@/store/auth-store"
import { useNotifications } from "@/components/contexts/notification-context"

const ServerLogsSheet = dynamic(() => import("./server-logs-sheet").then(mod => mod.ServerLogsSheet), { ssr: false })
const ConflictResolutionDialog = dynamic(() => import("./conflict-resolution-dialog").then(mod => mod.ConflictResolutionDialog), { ssr: false })
const EditServerSheet = dynamic(() => import("./edit-server-sheet").then(mod => mod.EditServerSheet), { ssr: false })
const SupplyChainSection = dynamic(
  () => import("./supply-chain-section").then((mod) => mod.SupplyChainSection),
  { loading: () => <McpSectionSkeleton cardCount={3} columnsClassName="md:grid-cols-3" /> }
)
const RuntimeServerListSection = dynamic(
  () => import("./runtime-server-list-section").then((mod) => mod.RuntimeServerListSection),
  {
    loading: () => (
      <McpSectionSkeleton
        cardCount={4}
        columnsClassName="grid-cols-1"
      />
    ),
  }
)

interface MCPRegistryClientProps {
  initialTools: MCPTool[]
  initialSources: MCPSource[]
}

const MAX_LOG_LINES = 1000

export function MCPRegistryClient({ initialTools, initialSources }: MCPRegistryClientProps) {
  const t = useTranslations("mcp")
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  const accessToken = useAuthStore((state) => state.accessToken)
  const { addNotification } = useNotifications()
  const mcpSources = useMcpSources({ enabled: !isTauri })
  const mcpServers = useMcpServers({ enabled: !isTauri })
  const mcpTools = useMcpTools(!isTauri ? mcpServers.data : undefined)
  const toolToggleMutation = useMcpToolToggle()
  const refreshSources = mcpSources.refresh
  const refreshServers = mcpServers.refresh
  const createServer = mcpServers.create
  const updateServer = mcpServers.update
  const removeServer = mcpServers.remove
  const syncServer = mcpServers.sync
  const refreshTools = mcpTools.mutate
  const createSource = mcpSources.create
  const syncSource = mcpSources.sync

  const [tools, setTools] = useState<MCPTool[]>(initialTools)
  const [sources, setSources] = useState<MCPSource[]>(initialSources)
  const [logsByTool, setLogsByTool] = useState<Record<string, MCPLogEntry[]>>({})
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [conflictTool, setConflictTool] = useState<MCPTool | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [sourceTokens, setSourceTokens] = useState<Record<string, string>>({})
  const [syncingServers, setSyncingServers] = useState(false)
  const [syncingServerIds, setSyncingServerIds] = useState<Record<string, boolean>>({})
  const [editServer, setEditServer] = useState<McpServer | null>(null)
  const [editServerOpen, setEditServerOpen] = useState(false)
  const [reindexingMissingTools, setReindexingMissingTools] = useState(false)
  const [indexProgress, setIndexProgress] = useState<McpToolIndexProgressEvent | null>(null)

  const mapTool = useCallback((tool: McpToolRecord): MCPTool => mapDesktopToolRecordToTool(tool, t("conflict.warningDescription")), [t])

  const { serverById, editServerTools, runtimeGroups, conflictCount } = useMcpRegistryViewModel({
    isTauri,
    servers: mcpServers.data,
    sources,
    toolRecords: mcpTools.data,
    editServer,
    tools,
  })

  const mapServerTool = useCallback((tool: McpServerToolRecord): MCPTool => {
    return mapRemoteServerToolRecordToTool(tool, serverById.get(tool.server_id))
  }, [serverById])

  const handleLoadError = useCallback((error: unknown) => {
    addNotification(getMcpRegistryErrorNotification(t, "load", error))
  }, [addNotification, t])

  const refreshAll = useMcpRegistryRefreshAll({
    isTauri,
    refreshSources,
    refreshServers,
    refreshTools,
    setSources,
    setTools,
    mapTool,
    onLoadError: handleLoadError,
  })

  useMcpRegistryLoadErrorEffect({ isTauri, error: mcpSources.error, onError: handleLoadError })
  useMcpRegistryLoadErrorEffect({ isTauri, error: mcpServers.error, onError: handleLoadError })
  useMcpRegistryLoadErrorEffect({ isTauri, error: mcpTools.error, onError: handleLoadError })

  useMcpRegistryHydration({
    isTauri,
    sourceRecords: mcpSources.data,
    toolRecords: mcpTools.data,
    mapServerTool,
    tools,
    selectedTool,
    setSources,
    setTools,
    setSelectedTool,
    refreshAll,
  })

  useMcpRegistryToolLogs({
    isTauri,
    logsOpen,
    selectedToolId: selectedTool?.id ?? null,
    setLogsByTool,
    onLoadError: handleLoadError,
    maxLogLines: MAX_LOG_LINES,
  })

  useMcpRegistryIndexProgress({
    isTauri,
    onProgress: setIndexProgress,
    onCompleted: () => {
      void refreshAll()
      setTimeout(() => setIndexProgress(null), 1200)
    },
  })

  const updateToolList = useCallback((updater: (tools: MCPTool[]) => MCPTool[]) => {
    setTools((prev) => updater(prev))
  }, [])

  const updateSourceList = useCallback((updater: (sources: MCPSource[]) => MCPSource[]) => {
    setSources((prev) => updater(prev))
  }, [])

  const handleClearLogs = useMcpRegistryClearLogsAction({ isTauri, setLogsByTool })

  const {
    handleCreateSource,
    handleSyncSource,
  } = useMcpRegistrySourceActions({
    isTauri,
    t,
    accessToken,
    addNotification,
    sourceTokens,
    createSource,
    syncSource,
    refreshAll,
    updateSourceList,
    setSourceTokens,
  })

  const { handleImportConfig } = useMcpRegistryImportAction({
    isTauri,
    t,
    addNotification,
    createServer,
    syncServer,
    refreshAll,
  })

  const {
    handleDeleteServer,
    handleEditServerOpenChange,
    handleOpenEditServer,
    handleSyncServer,
    handleSyncServers,
    handleToggleServerEnabled,
    handleToggleServerTool,
    handleUpdateServer,
  } = useMcpRegistryServerActions({
    isTauri,
    t,
    addNotification,
    serverById,
    servers: mcpServers.data ?? [],
    editServer,
    refreshAll,
    refreshTools,
    syncServer,
    updateServer,
    removeServer,
    toolToggleMutation,
    setSyncingServers,
    setSyncingServerIds,
    setEditServer,
    setEditServerOpen,
  })

  const {
    handleConflictOpenChange,
    handleDeleteTool,
    handleOpenConflict,
    handlePrimaryAction,
    handleResolveConflict,
    handleToggleTool,
  } = useMcpRegistryToolActions({
    isTauri,
    t,
    addNotification,
    conflictTool,
    refreshAll,
    refreshTools,
    toolToggleMutation,
    mapTool,
    mapServerTool,
    updateToolList,
    handleOpenEditServer,
    handleSyncServer,
    handleToggleServerEnabled,
    setSelectedTool,
    setLogsOpen,
    setConflictTool,
    setConflictOpen,
  })

  const handleReindexMissingTools = useCallback(async (groupTools: MCPTool[]) => {
    if (!isTauri || groupTools.length === 0) {
      return
    }

    setReindexingMissingTools(true)
    try {
      let successCount = 0
      const failedToolNames: string[] = []

      for (const tool of groupTools) {
        try {
          await invoke<void>(DESKTOP_MCP_COMMANDS.reindexTool, { toolId: tool.id })
          successCount += 1
        } catch (error) {
          failedToolNames.push(tool.name)
          console.warn("[mcp] failed to reindex tool", tool.id, error)
        }
      }

      await refreshAll()

      if (successCount > 0) {
        addNotification({
          type: failedToolNames.length > 0 ? "warning" : "success",
          title: t(failedToolNames.length > 0 ? "toast.reindexMissingPartial" : "toast.reindexMissingSuccess"),
          description: failedToolNames.length > 0
            ? t("toast.reindexMissingPartialDesc", {
                successCount,
                failedCount: failedToolNames.length,
                failedTools: failedToolNames.join(", "),
              })
            : t("toast.reindexMissingSuccessDesc", { count: successCount }),
          timestamp: Date.now(),
        })
      }

      if (successCount === 0 && failedToolNames.length > 0) {
        addNotification({
          type: "error",
          title: t("toast.reindexMissingFailed"),
          description: t("toast.reindexMissingFailedDesc", {
            count: failedToolNames.length,
            failedTools: failedToolNames.join(", "),
          }),
          timestamp: Date.now(),
        })
      }
    } catch (error) {
      addNotification(getMcpRegistryErrorNotification(t, "save", error))
      await refreshAll()
    } finally {
      setReindexingMissingTools(false)
    }
  }, [addNotification, isTauri, refreshAll, t])

  return (
    <div className="relative min-h-screen bg-[var(--background)] px-6 py-12 lg:px-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-[var(--primary)]/5 blur-[120px]" />
        <div className="absolute top-[20%] -right-[5%] h-[35%] w-[35%] rounded-full bg-[var(--teal-accent)]/5 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl space-y-16">
        <div className="animate-glass-card-in stagger-1">
          <RegistryHeader onCreateManual={handleImportConfig} />
        </div>

        <div className="animate-glass-card-in stagger-2">
          <SupplyChainSection
            sources={sources}
            onSync={handleSyncSource}
            onCreateSource={handleCreateSource}
          />
        </div>

        <div className="animate-glass-card-in stagger-3">
          <div className="mcp-runtime-shell rounded-[2rem] border border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.66),rgba(248,250,252,0.94))] p-4 shadow-[0_32px_80px_-36px_rgba(15,23,42,0.34)] sm:p-5 lg:p-6">
            {isTauri && indexProgress && indexProgress.total > 0 && (
              <div className="mb-4 rounded-xl border border-sky-200/80 bg-sky-50/70 p-3">
                <div className="mb-1 flex items-center justify-between text-[12px] text-sky-700">
                  <span>{t("actions.reindexingMissing")}</span>
                  <span>{indexProgress.processed}/{indexProgress.total}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-sky-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-400 transition-all duration-300"
                    style={{ width: `${indexProgress.total > 0 ? Math.min(100, Math.round((indexProgress.processed / indexProgress.total) * 100)) : 100}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-sky-700/90">
                  {indexProgress.phase === "completed"
                    ? `${t("tool.labels.index")}: ${indexProgress.indexed}/${indexProgress.total}`
                    : `${t("tool.labels.index")}: ${indexProgress.indexed}/${indexProgress.total}${indexProgress.current ? ` - ${indexProgress.current}` : ""}`}
                </div>
              </div>
            )}
            <RuntimeServerListSection
              groups={runtimeGroups}
              conflictCount={conflictCount}
              platform={isTauri ? "desktop" : "cloud"}
              toggleMode={isTauri ? "runtime" : "desired"}
              onToggleTool={isTauri ? (tool, enabled) => handleToggleTool(tool, enabled) : handleToggleServerEnabled}
              onPrimaryAction={handlePrimaryAction}
              onResolveConflict={isTauri ? handleOpenConflict : undefined}
              onEditServer={!isTauri ? handleOpenEditServer : undefined}
              onDeleteServer={isTauri ? handleDeleteTool : handleDeleteServer}
              onSyncAll={!isTauri ? handleSyncServers : undefined}
              syncAllLoading={syncingServers}
              onSyncTool={!isTauri ? handleSyncServer : undefined}
              syncingToolIds={!isTauri ? syncingServerIds : undefined}
              onReindexMissingTools={isTauri ? handleReindexMissingTools : undefined}
              reindexMissingLoading={reindexingMissingTools}
            />
          </div>
        </div>
      </div>

      <ServerLogsSheet
        tool={selectedTool}
        open={logsOpen}
        onOpenChange={setLogsOpen}
        logs={selectedTool ? logsByTool[selectedTool.id] || [] : []}
        onClear={() => {
          if (selectedTool) {
            handleClearLogs(selectedTool)
          }
        }}
      />

      <ConflictResolutionDialog
        tool={conflictTool}
        open={conflictOpen}
        onOpenChange={handleConflictOpenChange}
        onResolve={handleResolveConflict}
      />

      <EditServerSheet
        key={editServer?.id ?? "edit-server-sheet"}
        server={editServer}
        tools={editServerTools}
        open={editServerOpen}
        onOpenChange={handleEditServerOpenChange}
        onSave={handleUpdateServer}
        onToggleTool={editServer && (editServer.server_type === "sse" || editServer.server_type === "streamable-http") ? handleToggleServerTool : undefined}
        loading={updateServer.isMutating}
        toggleLoading={toolToggleMutation.isMutating}
      />
    </div>
  )
}

function McpSectionSkeleton({
  cardCount,
  columnsClassName,
}: {
  cardCount: number
  columnsClassName: string
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-32" />
        <div className="h-px flex-1 bg-gray-100" />
      </div>

      <div className={`grid grid-cols-1 gap-4 ${columnsClassName}`}>
        {Array.from({ length: cardCount }).map((_, index) => (
          <div key={index} className="rounded-3xl border border-border/60 bg-card/80 p-6">
            <div className="space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
