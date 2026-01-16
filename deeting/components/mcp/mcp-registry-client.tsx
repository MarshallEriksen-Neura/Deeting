"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { invoke } from "@tauri-apps/api/core"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { RegistryHeader } from "./registry-header"
import { SupplyChainSection } from "./supply-chain-section"
import { RuntimeGridSection } from "./runtime-grid-section"
import { MCPLogEntry, MCPSource, MCPTool, MCPToolConflict, MCPEnvConfigItem, McpSourceRecord, McpToolRecord } from "@/types/mcp"
import { useAuthStore } from "@/store/auth-store"
import { useNotifications } from "@/components/contexts/notification-context"

const ServerLogsSheet = dynamic(() => import("./server-logs-sheet").then(mod => mod.ServerLogsSheet), { ssr: false })
const ConflictResolutionDialog = dynamic(() => import("./conflict-resolution-dialog").then(mod => mod.ConflictResolutionDialog), { ssr: false })
const ToolConfigSheet = dynamic(() => import("./tool-config-sheet").then(mod => mod.ToolConfigSheet), { ssr: false })

interface MCPRegistryClientProps {
  initialTools: MCPTool[]
  initialSources: MCPSource[]
}

const MAX_LOG_LINES = 1000

const parseEnvConfig = (configJson: string): MCPEnvConfigItem[] => {
  try {
    const raw = JSON.parse(configJson)
    if (!Array.isArray(raw?.env_config)) return []
    return raw.env_config
      .filter((item: unknown) => typeof item === "object" && item !== null)
      .map((item: Record<string, unknown>) => ({
        key: String(item.key ?? ""),
        label: typeof item.label === "string" ? item.label : undefined,
        description: typeof item.description === "string" ? item.description : undefined,
        required: typeof item.required === "boolean" ? item.required : undefined,
        secret: typeof item.secret === "boolean" ? item.secret : undefined,
        default: typeof item.default === "string" ? item.default : undefined,
      }))
      .filter((item: MCPEnvConfigItem) => item.key.length > 0)
  } catch {
    return []
  }
}

const parseArgsFromConfig = (configJson?: string): string[] => {
  if (!configJson) return []
  try {
    const raw = JSON.parse(configJson)
    if (Array.isArray(raw?.args)) {
      return raw.args.filter((item: unknown) => typeof item === "string") as string[]
    }
  } catch {
    return []
  }
  return []
}

export function MCPRegistryClient({ initialTools, initialSources }: MCPRegistryClientProps) {
  const t = useTranslations("mcp")
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  const accessToken = useAuthStore((state) => state.accessToken)
  const { addNotification } = useNotifications()

  const [tools, setTools] = useState<MCPTool[]>(initialTools)
  const [sources, setSources] = useState<MCPSource[]>(initialSources)
  const [logsByTool, setLogsByTool] = useState<Record<string, MCPLogEntry[]>>({})
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [conflictTool, setConflictTool] = useState<MCPTool | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [configTool, setConfigTool] = useState<MCPTool | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [sourceTokens, setSourceTokens] = useState<Record<string, string>>({})

  const logListeners = useRef<Record<string, UnlistenFn>>({})
  const autoSyncRef = useRef(false)

  const mapSource = useCallback((source: McpSourceRecord): MCPSource => ({
    id: source.id,
    name: source.name,
    type: source.source_type,
    pathOrUrl: source.path_or_url,
    lastSynced: source.last_synced_at || undefined,
    status: source.status,
    isReadOnly: source.is_read_only,
    trustLevel: source.trust_level,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  }), [])

  const mapTool = useCallback((tool: McpToolRecord): MCPTool => {
    const envConfig = parseEnvConfig(tool.config_json)
    const baseTool: MCPTool = {
      id: tool.id,
      identifier: tool.identifier ?? undefined,
      name: tool.name,
      source: tool.source_type,
      sourceId: tool.source_id ?? undefined,
      status: tool.status,
      ping: tool.ping_ms ? `${tool.ping_ms}ms` : "-",
      pingMs: tool.ping_ms ?? undefined,
      capabilities: tool.capabilities || [],
      description: tool.description,
      error: tool.error ?? undefined,
      command: tool.command ?? undefined,
      args: tool.args ?? undefined,
      env: tool.env ?? undefined,
      configJson: tool.config_json,
      pendingConfigJson: tool.pending_config_json ?? undefined,
      configHash: tool.config_hash,
      pendingConfigHash: tool.pending_config_hash ?? undefined,
      conflictStatus: tool.conflict_status,
      isReadOnly: tool.is_read_only,
      isNew: tool.is_new,
      createdAt: tool.created_at,
      updatedAt: tool.updated_at,
      envConfig,
    }

    const pendingArgs = parseArgsFromConfig(baseTool.pendingConfigJson)
    const currentArgs = parseArgsFromConfig(baseTool.configJson)
    const conflict: MCPToolConflict | undefined =
      baseTool.conflictStatus !== "none" && baseTool.pendingConfigJson
        ? {
            currentArgs: currentArgs.length ? currentArgs : baseTool.args || [],
            incomingArgs: pendingArgs,
            warning:
              baseTool.conflictStatus === "conflict"
                ? t("conflict.warningDescription")
                : undefined,
          }
        : undefined

    return {
      ...baseTool,
      conflict,
    }
  }, [t])

  const refreshAll = useCallback(async () => {
    if (!isTauri) {
      setTools(initialTools)
      setSources(initialSources)
      return
    }
    try {
      const [sourceRecords, toolRecords] = await Promise.all([
        invoke<McpSourceRecord[]>("list_mcp_sources"),
        invoke<McpToolRecord[]>("list_mcp_tools"),
      ])
      setSources(sourceRecords.map(mapSource))
      setTools(toolRecords.map(mapTool))
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.loadFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, initialSources, initialTools, isTauri, mapSource, mapTool, t])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!isTauri || autoSyncRef.current) return
    if (sources.length === 0) return
    autoSyncRef.current = true
    const run = async () => {
      try {
        const localSources = sources.filter((source) => source.type === "local")
        await Promise.all(
          localSources.map((source) =>
            invoke("sync_mcp_source", {
              source_id: source.id,
              payload: { auth_token: null },
            })
          )
        )
        if (accessToken) {
          await invoke("sync_cloud_subscriptions", { access_token: accessToken })
        }
        await refreshAll()
      } catch (err) {
        addNotification({
          type: "error",
          title: t("toast.syncFailed"),
          description: String(err),
          timestamp: Date.now(),
        })
      }
    }
    run()
  }, [accessToken, addNotification, isTauri, refreshAll, sources, t])

  useEffect(() => {
    if (!selectedTool) return
    const updated = tools.find((item) => item.id === selectedTool.id)
    if (updated && updated !== selectedTool) {
      setSelectedTool(updated)
    }
  }, [selectedTool, tools])

  const pushLog = useCallback((toolId: string, entry: MCPLogEntry) => {
    setLogsByTool((prev) => {
      const existing = prev[toolId] || []
      const next = existing.length >= MAX_LOG_LINES
        ? [...existing.slice(existing.length - MAX_LOG_LINES + 1), entry]
        : [...existing, entry]
      return { ...prev, [toolId]: next }
    })
  }, [])

  useEffect(() => {
    if (!isTauri || !logsOpen || !selectedTool) {
      return
    }
    const toolId = selectedTool.id
    let active = true

    const setup = async () => {
      try {
        const entries = await invoke<MCPLogEntry[]>("get_mcp_logs", { tool_id: toolId })
        if (active) {
          setLogsByTool((prev) => ({ ...prev, [toolId]: entries }))
        }
        if (!logListeners.current[toolId]) {
          const unlisten = await listen<MCPLogEntry>(`mcp-log://${toolId}`, (event) => {
            pushLog(toolId, event.payload)
          })
          logListeners.current[toolId] = unlisten
        }
      } catch (err) {
        addNotification({
          type: "error",
          title: t("toast.loadFailed"),
          description: String(err),
          timestamp: Date.now(),
        })
      }
    }

    setup()

    return () => {
      active = false
      const unlisten = logListeners.current[toolId]
      if (unlisten) {
        unlisten()
        delete logListeners.current[toolId]
      }
    }
  }, [addNotification, isTauri, logsOpen, pushLog, selectedTool, t])

  const handleToggleTool = useCallback(async (tool: MCPTool, enabled: boolean) => {
    if (!isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    setTools((prev) =>
      prev.map((item) =>
        item.id === tool.id
          ? { ...item, status: enabled ? "starting" : "stopped" }
          : item
      )
    )
    try {
      const updated = enabled
        ? await invoke<McpToolRecord>("start_mcp_tool", { tool_id: tool.id })
        : await invoke<McpToolRecord>("stop_mcp_tool", { tool_id: tool.id })
      const mapped = mapTool(updated)
      setTools((prev) => prev.map((item) => (item.id === mapped.id ? mapped : item)))
    } catch (err) {
      addNotification({
        type: "error",
        title: enabled ? t("toast.startFailed") : t("toast.stopFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
      refreshAll()
    }
  }, [addNotification, isTauri, mapTool, refreshAll, t])

  const handleSyncSource = useCallback(async (source: MCPSource) => {
    if (!isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    setSources((prev) =>
      prev.map((item) => (item.id === source.id ? { ...item, status: "syncing" } : item))
    )
    try {
      if (source.type === "cloud") {
        if (!accessToken) {
          throw new Error(t("toast.missingToken"))
        }
        await invoke("sync_cloud_subscriptions", { access_token: accessToken })
      } else {
        const token = sourceTokens[source.id]
        await invoke("sync_mcp_source", {
          source_id: source.id,
          payload: { auth_token: token || null },
        })
      }
      await refreshAll()
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.syncFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
      refreshAll()
    }
  }, [accessToken, addNotification, isTauri, refreshAll, sourceTokens, t])

  const handleCreateSource = useCallback(async (payload: {
    name: string
    sourceType: MCPSource["type"]
    pathOrUrl: string
    trustLevel: MCPSource["trustLevel"]
    authToken?: string
  }) => {
    if (!isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    try {
      const created = await invoke<McpSourceRecord>("create_mcp_source", {
        payload: {
          name: payload.name,
          source_type: payload.sourceType,
          path_or_url: payload.pathOrUrl,
          trust_level: payload.trustLevel,
          is_read_only: payload.sourceType !== "local",
        },
      })
      const mapped = mapSource(created)
      setSources((prev) => [...prev, mapped])
      if (payload.authToken) {
        setSourceTokens((prev) => ({ ...prev, [created.id]: payload.authToken || "" }))
        await invoke("sync_mcp_source", {
          source_id: created.id,
          payload: { auth_token: payload.authToken },
        })
        await refreshAll()
      }
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.syncFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, mapSource, refreshAll, t])

  const handleImportConfig = useCallback(async (payload: {
    config: Record<string, unknown>
  }) => {
    if (!isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    try {
      await invoke("import_mcp_config", { payload })
      await refreshAll()
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.saveFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, refreshAll, t])

  const handleResolveConflict = useCallback(async (tool: MCPTool, action: "keep" | "update") => {
    if (!isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    try {
      const updated = await invoke<McpToolRecord>("resolve_mcp_conflict", {
        tool_id: tool.id,
        payload: { action },
      })
      const mapped = mapTool(updated)
      setTools((prev) => prev.map((item) => (item.id === mapped.id ? mapped : item)))
      setConflictOpen(false)
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.saveFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, mapTool, t])

  const handleUpdateEnv = useCallback(async (tool: MCPTool, env: Record<string, string>) => {
    if (!isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    try {
      const updated = await invoke<McpToolRecord>("update_mcp_tool_env", {
        tool_id: tool.id,
        env,
      })
      const mapped = mapTool(updated)
      setTools((prev) => prev.map((item) => (item.id === mapped.id ? mapped : item)))
      setConfigOpen(false)
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.saveFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, mapTool, t])

  const handleClearLogs = useCallback(async (tool: MCPTool) => {
    if (!isTauri) return
    await invoke("clear_mcp_logs", { tool_id: tool.id })
    setLogsByTool((prev) => ({ ...prev, [tool.id]: [] }))
  }, [isTauri])

  const handleShowLogs = useCallback((tool: MCPTool) => {
    setSelectedTool(tool)
    setLogsOpen(true)
  }, [])

  const handleOpenConfig = useCallback((tool: MCPTool) => {
    setConfigTool(tool)
    setConfigOpen(true)
  }, [])

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
            tools={tools}
            conflictCount={conflictCount}
            onToggleTool={(tool, enabled) => handleToggleTool(tool, enabled)}
            onShowLogs={handleShowLogs}
            onResolveConflict={(tool) => {
              setConflictTool(tool)
              setConflictOpen(true)
            }}
            onConfigure={handleOpenConfig}
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

      <ToolConfigSheet
        tool={configTool}
        open={configOpen}
        onOpenChange={setConfigOpen}
        onSave={(env) => (configTool ? handleUpdateEnv(configTool, env) : undefined)}
      />
    </div>
  )
}
