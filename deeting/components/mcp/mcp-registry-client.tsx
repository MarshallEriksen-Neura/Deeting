"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { invoke } from "@tauri-apps/api/core"
import {
  mapDesktopToolRecordToTool,
  mapMcpSourceRecordToSource,
  mapRemoteServerToRuntimeTool,
  mapRemoteServerToolRecordToTool,
} from "@/lib/mcp/registry-mappers"
import {
  patchMcpRemoteToolToggle,
  patchMcpSourceStatus,
  patchMcpToolStatus,
  upsertMcpSource,
  upsertMcpTool,
} from "@/lib/mcp/registry-patches"
import {
  getMcpRegistryServer,
  getMcpRegistryServerId,
  resolveMcpRegistrySseServer,
} from "./registry-guards"
import {
  getMcpRegistryCountNotification,
  getMcpRegistryErrorNotification,
  getMcpRegistryNotification,
} from "./registry-notifications"
import { parseMcpRegistryImportConfig } from "./registry-import"
import {
  getDesktopMcpRegistrySourceCreatePayload,
  getMcpRegistrySourceCreateRequest,
  getMcpRegistrySourceSyncPayload,
  shouldSyncCreatedMcpSource,
} from "@/components/mcp/registry-source-actions"
import {
  useMcpRegistryLoadErrorEffect,
  useMcpRegistryToolLogs,
} from "./registry-effects"
import { getMcpPrimaryActionIntent, getMcpToggleActionIntent } from "./tool-semantics"
import { RegistryHeader } from "./registry-header"
import { SupplyChainSection } from "./supply-chain-section"
import { RuntimeGridSection } from "./runtime-grid-section"
import { MCPLogEntry, MCPSource, MCPTool, McpSourceRecord, McpToolRecord } from "@/types/mcp"
import { useMcpServers } from "@/lib/swr/use-mcp-servers"
import { useMcpSources } from "@/lib/swr/use-mcp-sources"
import { useMcpTools, type McpServerToolRecord } from "@/lib/swr/use-mcp-tools"
import { useMcpToolToggle } from "@/lib/swr/use-mcp-tool-toggle"
import { type McpServer, type McpServerUpdateRequest } from "@/lib/api/mcp"
import { useAuthStore } from "@/store/auth-store"
import { useNotifications } from "@/components/contexts/notification-context"

const ServerLogsSheet = dynamic(() => import("./server-logs-sheet").then(mod => mod.ServerLogsSheet), { ssr: false })
const ConflictResolutionDialog = dynamic(() => import("./conflict-resolution-dialog").then(mod => mod.ConflictResolutionDialog), { ssr: false })
const EditServerSheet = dynamic(() => import("./edit-server-sheet").then(mod => mod.EditServerSheet), { ssr: false })

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

  const initialRefreshRef = useRef(false)

  const mapTool = useCallback((tool: McpToolRecord): MCPTool => mapDesktopToolRecordToTool(tool, t("conflict.warningDescription")), [t])

  const serverById = useMemo(() => {
    const map = new Map<string, McpServer>()
    mcpServers.data?.forEach((server) => map.set(server.id, server))
    return map
  }, [mcpServers.data])

  const editServerTools = useMemo(() => {
    if (!editServer) return []
    return (mcpTools.data ?? [])
      .filter((tool) => tool.server_id === editServer.id)
      .map((tool) => {
        const { server_id: serverId, ...rest } = tool
        void serverId
        return rest
      })
  }, [editServer, mcpTools.data])


  const mapServerTool = useCallback((tool: McpServerToolRecord): MCPTool => {
    return mapRemoteServerToolRecordToTool(tool, serverById.get(tool.server_id))
  }, [serverById])

  const refreshAll = useCallback(async () => {
    if (!isTauri) {
      refreshSources()
      refreshServers()
      await refreshTools()
      return
    }
    try {
      const [sourceRecords, toolRecords] = await Promise.all([
        invoke<McpSourceRecord[]>("list_mcp_sources"),
        invoke<McpToolRecord[]>("list_mcp_tools"),
      ])
      setSources(sourceRecords.map(mapMcpSourceRecordToSource))
      setTools(toolRecords.map(mapTool))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "load", err))
    }
  }, [addNotification, isTauri, mapTool, refreshServers, refreshSources, refreshTools, t])

  useEffect(() => {
    if (initialRefreshRef.current) return
    initialRefreshRef.current = true
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (isTauri) return
    if (mcpSources.data) {
      setSources(mcpSources.data.map(mapMcpSourceRecordToSource))
    }
  }, [isTauri, mcpSources.data])

  useEffect(() => {
    if (isTauri) return
    if (mcpTools.data) {
      setTools(mcpTools.data.map(mapServerTool))
    }
  }, [isTauri, mapServerTool, mcpTools.data])

  const handleLoadError = useCallback((error: unknown) => {
    addNotification(getMcpRegistryErrorNotification(t, "load", error))
  }, [addNotification, t])

  useMcpRegistryLoadErrorEffect({ isTauri, error: mcpSources.error, onError: handleLoadError })
  useMcpRegistryLoadErrorEffect({ isTauri, error: mcpServers.error, onError: handleLoadError })
  useMcpRegistryLoadErrorEffect({ isTauri, error: mcpTools.error, onError: handleLoadError })

  useEffect(() => {
    if (!selectedTool) return
    const updated = tools.find((item) => item.id === selectedTool.id)
    if (updated && updated !== selectedTool) {
      setSelectedTool(updated)
    }
  }, [selectedTool, tools])

  useMcpRegistryToolLogs({
    isTauri,
    logsOpen,
    selectedToolId: selectedTool?.id ?? null,
    setLogsByTool,
    onLoadError: handleLoadError,
    maxLogLines: MAX_LOG_LINES,
  })

  const updateToolList = useCallback((updater: (tools: MCPTool[]) => MCPTool[]) => {
    setTools((prev) => updater(prev))
  }, [])

  const updateSourceList = useCallback((updater: (sources: MCPSource[]) => MCPSource[]) => {
    setSources((prev) => updater(prev))
  }, [])

  const handleShowLogs = useCallback((tool: MCPTool) => {
    if (!isTauri) return
    setSelectedTool(tool)
    setLogsOpen(true)
  }, [isTauri])

  const handleToggleTool = useCallback(async (tool: MCPTool, enabled: boolean) => {
    const intent = getMcpToggleActionIntent(tool, enabled, isTauri ? "desktop" : "cloud")

    switch (intent) {
      case "toggle_remote_tool":
        if (!tool.sourceId) {
          addNotification(getMcpRegistryErrorNotification(t, "save", t("toast.missingServer")))
          return
        }
        updateToolList((prev) => patchMcpRemoteToolToggle(prev, tool.id, enabled))
        try {
          const updated = await toolToggleMutation.trigger({
            serverId: tool.sourceId,
            toolName: tool.name,
            enabled,
          })
          const mapped = mapServerTool({ ...updated, server_id: tool.sourceId })
          updateToolList((prev) => upsertMcpTool(prev, mapped))
          await refreshTools()
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, enabled ? "start" : "stop", err))
          refreshAll()
        }
        return
      case "stop_tool":
        updateToolList((prev) => patchMcpToolStatus(prev, tool.id, "stopped", false))
        try {
          await invoke("stop_mcp_tool", { toolId: tool.id })
          await refreshAll()
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "stop", err))
          refreshAll()
        }
        return
      case "blocked_install":
        addNotification(getMcpRegistryNotification(t, "blocked_install"))
        return
      case "blocked_runtime":
        addNotification(getMcpRegistryNotification(t, "blocked_runtime"))
        return
      case "review":
        handleShowLogs(tool)
        return
      case "enable_skill":
        if (!tool.backingSkillId) {
          addNotification(getMcpRegistryNotification(t, "enable_skill_missing_id"))
          return
        }

        try {
          await invoke("enable_local_skill", { skillId: tool.backingSkillId })
          await refreshAll()
          addNotification(getMcpRegistryNotification(t, "enable_skill_success"))
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "enable_skill", err))
          refreshAll()
        }
        return
      case "start_tool":
        updateToolList((prev) => patchMcpToolStatus(prev, tool.id, "starting"))
        try {
          await invoke("start_mcp_tool", { toolId: tool.id })
          await refreshAll()
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "start", err))
          refreshAll()
        }
        return
    }
  }, [
    addNotification,
    isTauri,
    mapServerTool,
    refreshTools,
    refreshAll,
    t,
    handleShowLogs,
    toolToggleMutation,
    updateToolList,
  ])

  const handleSyncSource = useCallback(async (source: MCPSource) => {
    if (!isTauri) {
      updateSourceList((prev) => patchMcpSourceStatus(prev, source.id, "syncing"))
      try {
        await syncSource.trigger([source.id, getMcpRegistrySourceSyncPayload(sourceTokens[source.id])])
        await refreshAll()
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "sync", err))
        refreshAll()
      }
      return
    }
    updateSourceList((prev) => patchMcpSourceStatus(prev, source.id, "syncing"))
    try {
      if (source.type === "cloud") {
        if (!accessToken) {
          throw new Error(t("toast.missingToken"))
        }
        await invoke("sync_cloud_subscriptions", { accessToken })
      } else {
        await invoke("sync_mcp_source", {
          sourceId: source.id,
          payload: getMcpRegistrySourceSyncPayload(sourceTokens[source.id]),
        })
      }
      await refreshAll()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
      refreshAll()
    }
  }, [accessToken, addNotification, isTauri, refreshAll, sourceTokens, syncSource, t, updateSourceList])

  const handleSyncServers = useCallback(async () => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }
    const servers = mcpServers.data ?? []
    const remoteServers = servers.filter((server) => server.server_type === "sse" && server.sse_url)
    if (remoteServers.length === 0) {
      addNotification(getMcpRegistryNotification(t, "no_remote_servers"))
      return
    }
    setSyncingServers(true)
    try {
      await syncServer.trigger(remoteServers[0].id)
      await refreshAll()
      addNotification(getMcpRegistryNotification(t, "sync_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
      refreshAll()
    } finally {
      setSyncingServers(false)
    }
  }, [addNotification, isTauri, mcpServers.data, refreshAll, syncServer, t])

  const handleSyncServer = useCallback(async (tool: MCPTool) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }
    if (tool.source === "local") {
      addNotification(getMcpRegistryNotification(t, "no_remote_servers"))
      return
    }
    const serverId = getMcpRegistryServerId(tool)
    setSyncingServerIds((prev) => ({ ...prev, [serverId]: true }))
    try {
      await syncServer.trigger(serverId)
      await refreshAll()
      addNotification(getMcpRegistryNotification(t, "sync_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
      refreshAll()
    } finally {
      setSyncingServerIds((prev) => ({ ...prev, [serverId]: false }))
    }
  }, [addNotification, isTauri, refreshAll, syncServer, t])

  const handleCreateSource = useCallback(async (payload: {
    name: string
    sourceType: MCPSource["type"]
    pathOrUrl: string
    trustLevel: MCPSource["trustLevel"]
    authToken?: string
  }) => {
    if (!isTauri) {
      try {
        const created = await createSource.trigger(getMcpRegistrySourceCreateRequest(payload))
        setSourceTokens((prev) => ({ ...prev, [created.id]: payload.authToken || "" }))
        await syncSource.trigger([created.id, getMcpRegistrySourceSyncPayload(payload.authToken)])
        await refreshAll()
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "sync", err))
        refreshAll()
      }
      return
    }
    try {
      const created = await invoke<McpSourceRecord>("create_mcp_source", {
        payload: getDesktopMcpRegistrySourceCreatePayload(payload),
      })
      const mapped = mapMcpSourceRecordToSource(created)
      updateSourceList((prev) => upsertMcpSource(prev, mapped))
      if (shouldSyncCreatedMcpSource(payload)) {
        setSourceTokens((prev) => ({ ...prev, [created.id]: payload.authToken || "" }))
        await invoke("sync_mcp_source", {
          sourceId: created.id,
          payload: getMcpRegistrySourceSyncPayload(payload.authToken),
        })
        await refreshAll()
      }
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
    }
  }, [addNotification, createSource, isTauri, refreshAll, syncSource, t, updateSourceList])

  const handleImportConfig = useCallback(async (payload: {
    config: Record<string, unknown>
  }) => {
    if (!isTauri) {
      const parsed = parseMcpRegistryImportConfig(payload.config)
      if (parsed.kind !== "ok") {
        addNotification(getMcpRegistryNotification(t, "invalid_config"))
        return
      }
      const results = await Promise.allSettled(
        parsed.requests.map((request) => createServer.trigger(request))
      )
      const succeeded = results.filter((item) => item.status === "fulfilled").length
      const failed = results.length - succeeded
      if (succeeded > 0) {
        addNotification(getMcpRegistryCountNotification(t, "import_success", succeeded))
      }
      if (failed > 0) {
        addNotification(getMcpRegistryCountNotification(t, "import_failed", failed))
      }
      const createdServers = results
        .filter((item): item is PromiseFulfilledResult<McpServer> => item.status === "fulfilled")
        .map((item) => item.value)
      const remoteServers = createdServers.filter((server) => server.server_type === "sse" && server.sse_url)
      if (remoteServers.length > 0) {
        try {
          await syncServer.trigger(remoteServers[0].id)
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "sync", err, "warning"))
        }
      }
      await refreshAll()
      return
    }
    try {
      await invoke("import_mcp_config", { payload })
      await refreshAll()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "save", err))
    }
  }, [addNotification, createServer, isTauri, refreshAll, syncServer, t])

  const handleResolveConflict = useCallback(async (tool: MCPTool, action: "keep" | "update") => {
    if (!isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }
    try {
      const updated = await invoke<McpToolRecord>("resolve_mcp_conflict", {
        tool_id: tool.id,
        payload: { action },
      })
      const mapped = mapTool(updated)
      updateToolList((prev) => upsertMcpTool(prev, mapped))
      setConflictOpen(false)
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "save", err))
    }
  }, [addNotification, isTauri, mapTool, t, updateToolList])

  const handleClearLogs = useCallback(async (tool: MCPTool) => {
    if (!isTauri) return
    await invoke("clear_mcp_logs", { toolId: tool.id })
    setLogsByTool((prev) => ({ ...prev, [tool.id]: [] }))
  }, [isTauri])

  const handleOpenEditServer = useCallback((tool: MCPTool) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }
    const server = getMcpRegistryServer(tool, serverById)
    if (!server) {
      addNotification(getMcpRegistryNotification(t, "missing_server"))
      return
    }
    setEditServer(server)
    setEditServerOpen(true)
  }, [addNotification, isTauri, serverById, t])

  const handleUpdateServer = useCallback(async (serverId: string, payload: McpServerUpdateRequest) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }
    try {
      await updateServer.trigger([serverId, payload])
      await refreshAll()
      setEditServerOpen(false)
      setEditServer(null)
      addNotification(getMcpRegistryNotification(t, "update_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "update", err))
    }
  }, [addNotification, isTauri, refreshAll, t, updateServer])

  const handleToggleServerTool = useCallback(async (toolName: string, enabled: boolean) => {
    if (isTauri || !editServer) return
    try {
      await toolToggleMutation.trigger({
        serverId: editServer.id,
        toolName,
        enabled,
      })
      await refreshTools()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "update", err))
      refreshTools()
    }
  }, [addNotification, editServer, isTauri, refreshTools, t, toolToggleMutation])

  const handleToggleServerEnabled = useCallback(async (tool: MCPTool, enabled: boolean) => {
    if (isTauri) return
    const resolution = resolveMcpRegistrySseServer(tool, serverById)
    if (resolution.kind === "missing_server") {
      addNotification(getMcpRegistryNotification(t, "missing_server"))
      return
    }
    if (resolution.kind === "unsupported_server") {
      addNotification(getMcpRegistryNotification(t, "toggle_unsupported"))
      return
    }
    try {
      await updateServer.trigger([resolution.serverId, { is_enabled: enabled }])
      await refreshAll()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "update", err))
    }
  }, [addNotification, isTauri, refreshAll, serverById, t, updateServer])

  const handlePrimaryAction = useCallback(async (tool: MCPTool) => {
    const intent = getMcpPrimaryActionIntent(tool, isTauri ? "desktop" : "cloud")

    if (intent === "blocked_install") {
      addNotification(getMcpRegistryNotification(t, "blocked_install"))
      return
    }

    if (intent === "blocked_runtime") {
      addNotification(getMcpRegistryNotification(t, "blocked_runtime"))
      return
    }

    switch (intent) {
      case "review":
        if (isTauri) {
          handleShowLogs(tool)
        } else {
          handleOpenEditServer(tool)
        }
        return
      case "sync_server":
        await handleSyncServer(tool)
        return
      case "enable_server":
        await handleToggleServerEnabled(tool, true)
        return
      case "toggle_tool":
        await handleToggleTool(tool, true)
        return
    }
  }, [
    addNotification,
    handleOpenEditServer,
    handleShowLogs,
    handleSyncServer,
    handleToggleServerEnabled,
    handleToggleTool,
    isTauri,
    t,
  ])

  const handleDeleteServer = useCallback(async (tool: MCPTool) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }
    const serverId = getMcpRegistryServerId(tool)
    try {
      await removeServer.trigger(serverId)
      await refreshAll()
      addNotification(getMcpRegistryNotification(t, "delete_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "delete", err))
    }
  }, [addNotification, isTauri, refreshAll, removeServer, t])

  const runtimeTools = useMemo(() => {
    if (isTauri) return tools
    const servers = mcpServers.data ?? []
    return servers.map(mapRemoteServerToRuntimeTool)
  }, [isTauri, mcpServers.data, tools])

  const conflictCount = useMemo(
    () => tools.filter((tool) => tool.conflictStatus !== "none").length,
    [tools]
  )

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
          <RuntimeGridSection
            tools={runtimeTools}
            conflictCount={conflictCount}
            toggleMode={isTauri ? "runtime" : "desired"}
            onToggleTool={isTauri ? (tool, enabled) => handleToggleTool(tool, enabled) : handleToggleServerEnabled}
            onPrimaryAction={handlePrimaryAction}
            onShowLogs={isTauri ? handleShowLogs : undefined}
            onResolveConflict={isTauri ? (tool) => {
              setConflictTool(tool)
              setConflictOpen(true)
            } : undefined}
            onEditServer={!isTauri ? handleOpenEditServer : undefined}
            onDeleteServer={!isTauri ? handleDeleteServer : undefined}
            onSyncAll={!isTauri ? handleSyncServers : undefined}
            syncAllLoading={syncingServers}
            onSyncTool={!isTauri ? handleSyncServer : undefined}
            syncingToolIds={!isTauri ? syncingServerIds : undefined}
          />
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
        onOpenChange={setConflictOpen}
        onResolve={(action) => {
          if (conflictTool) {
            handleResolveConflict(conflictTool, action)
          }
        }}
      />

      <EditServerSheet
        key={editServer?.id ?? "edit-server-sheet"}
        server={editServer}
        tools={editServerTools}
        open={editServerOpen}
        onOpenChange={(nextOpen) => {
          setEditServerOpen(nextOpen)
          if (!nextOpen) {
            setEditServer(null)
          }
        }}
        onSave={handleUpdateServer}
        onToggleTool={editServer?.server_type === "sse" ? handleToggleServerTool : undefined}
        loading={updateServer.isMutating}
        toggleLoading={toolToggleMutation.isMutating}
      />
    </div>
  )
}
