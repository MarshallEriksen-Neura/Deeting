"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { invoke } from "@tauri-apps/api/core"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { RegistryHeader } from "./registry-header"
import { SupplyChainSection } from "./supply-chain-section"
import { RuntimeGridSection } from "./runtime-grid-section"
import { MCPLogEntry, MCPSource, MCPTool, MCPToolConflict, MCPEnvConfigItem, MCPToolStatus, McpSourceRecord, McpToolRecord } from "@/types/mcp"
import { useMcpServers } from "@/lib/swr/use-mcp-servers"
import { useMcpSources } from "@/lib/swr/use-mcp-sources"
import { useMcpTools, type McpServerToolRecord } from "@/lib/swr/use-mcp-tools"
import { useMcpToolToggle } from "@/lib/swr/use-mcp-tool-toggle"
import { type McpServer, type McpServerUpdateRequest, type McpSource } from "@/lib/api/mcp"
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

  const logListeners = useRef<Record<string, UnlistenFn>>({})
  const autoSyncRef = useRef(false)
  const initialRefreshRef = useRef(false)

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

  const mapRemoteSource = useCallback((source: McpSource): MCPSource => ({
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

  const serverById = useMemo(() => {
    const map = new Map<string, McpServer>()
    mcpServers.data?.forEach((server) => map.set(server.id, server))
    return map
  }, [mcpServers.data])


  const mapServerTool = useCallback((tool: McpServerToolRecord): MCPTool => {
    const server = serverById.get(tool.server_id)
    const enabled = tool.enabled
    return {
      id: `${tool.server_id}:${tool.name}`,
      identifier: undefined,
      name: tool.name,
      source: server?.server_type === "stdio" ? "local" : "url",
      sourceId: tool.server_id,
      status: enabled ? "healthy" : "stopped",
      ping: "-",
      pingMs: undefined,
      capabilities: [],
      description: tool.description || "",
      error: undefined,
      command: undefined,
      args: undefined,
      env: undefined,
      configJson: JSON.stringify({ input_schema: tool.input_schema || {} }),
      pendingConfigJson: undefined,
      configHash: tool.name,
      pendingConfigHash: undefined,
      conflictStatus: "none",
      isReadOnly: true,
      isNew: false,
      createdAt: server?.created_at,
      updatedAt: server?.updated_at,
      envConfig: [],
    }
  }, [serverById])

  const mapServerToRuntimeTool = useCallback((server: McpServer): MCPTool => {
    const isRemote = server.server_type === "sse"
    const status: MCPToolStatus =
      server.status === "active" || server.is_enabled
        ? "healthy"
        : "stopped"
    return {
      id: server.id,
      identifier: undefined,
      name: server.name,
      source: isRemote ? "url" : "local",
      sourceId: server.id,
      status,
      ping: "-",
      pingMs: undefined,
      capabilities: [],
      description: server.description || server.sse_url || "",
      error: undefined,
      command: undefined,
      args: [],
      env: {},
      configJson: "",
      pendingConfigJson: undefined,
      configHash: "",
      pendingConfigHash: undefined,
      conflictStatus: "none",
      isReadOnly: false,
      isNew: false,
      createdAt: server.created_at,
      updatedAt: server.updated_at,
      envConfig: [],
    }
  }, [])

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
  }, [addNotification, isTauri, mapSource, mapTool, refreshServers, refreshSources, refreshTools, t])

  useEffect(() => {
    if (initialRefreshRef.current) return
    initialRefreshRef.current = true
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (isTauri) return
    if (mcpSources.data) {
      setSources(mcpSources.data.map(mapRemoteSource))
    }
  }, [isTauri, mapRemoteSource, mcpSources.data])

  useEffect(() => {
    if (isTauri) return
    if (mcpTools.data) {
      setTools(mcpTools.data.map(mapServerTool))
    }
  }, [isTauri, mapServerTool, mcpTools.data])

  useEffect(() => {
    if (isTauri) return
    if (mcpSources.error) {
      addNotification({
        type: "error",
        title: t("toast.loadFailed"),
        description: String(mcpSources.error),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, mcpSources.error, t])

  useEffect(() => {
    if (isTauri) return
    if (mcpServers.error) {
      addNotification({
        type: "error",
        title: t("toast.loadFailed"),
        description: String(mcpServers.error),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, mcpServers.error, t])

  useEffect(() => {
    if (isTauri) return
    if (mcpTools.error) {
      addNotification({
        type: "error",
        title: t("toast.loadFailed"),
        description: String(mcpTools.error),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, mcpTools.error, t])

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
      if (!tool.sourceId) {
        addNotification({
          type: "error",
          title: t("toast.saveFailed"),
          description: t("toast.missingServer"),
          timestamp: Date.now(),
        })
        return
      }
      setTools((prev) =>
        prev.map((item) =>
          item.id === tool.id
            ? { ...item, status: enabled ? "healthy" : "stopped" }
            : item
        )
      )
      try {
        const updated = await toolToggleMutation.trigger({
          serverId: tool.sourceId,
          toolName: tool.name,
          enabled,
        })
        const mapped = mapServerTool({ ...updated, server_id: tool.sourceId })
        setTools((prev) => prev.map((item) => (item.id === mapped.id ? mapped : item)))
        await refreshTools()
      } catch (err) {
        addNotification({
          type: "error",
          title: enabled ? t("toast.startFailed") : t("toast.stopFailed"),
          description: String(err),
          timestamp: Date.now(),
        })
        refreshAll()
      }
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
  }, [
    addNotification,
    isTauri,
    mapServerTool,
    mapTool,
    refreshTools,
    refreshAll,
    t,
    toolToggleMutation,
  ])

  const handleSyncSource = useCallback(async (source: MCPSource) => {
    if (!isTauri) {
      setSources((prev) =>
        prev.map((item) => (item.id === source.id ? { ...item, status: "syncing" } : item))
      )
      try {
        const token = sourceTokens[source.id]
        await syncSource.trigger([source.id, { auth_token: token || null }])
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
  }, [accessToken, addNotification, isTauri, refreshAll, sourceTokens, syncSource, t])

  const handleSyncServers = useCallback(async () => {
    if (isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: t("toast.desktopOnly"),
        timestamp: Date.now(),
      })
      return
    }
    const servers = mcpServers.data ?? []
    const remoteServers = servers.filter((server) => server.server_type === "sse" && server.sse_url)
    if (remoteServers.length === 0) {
      addNotification({
        type: "warning",
        title: t("toast.syncFailed"),
        description: t("toast.noRemoteServers"),
        timestamp: Date.now(),
      })
      return
    }
    setSyncingServers(true)
    try {
      await syncServer.trigger(remoteServers[0].id)
      await refreshAll()
      addNotification({
        type: "success",
        title: t("toast.syncSuccess"),
        description: t("toast.syncSuccessDesc"),
        timestamp: Date.now(),
      })
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.syncFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
      refreshAll()
    } finally {
      setSyncingServers(false)
    }
  }, [addNotification, isTauri, mcpServers.data, refreshAll, syncServer, t])

  const handleSyncServer = useCallback(async (tool: MCPTool) => {
    if (isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: t("toast.desktopOnly"),
        timestamp: Date.now(),
      })
      return
    }
    if (tool.source === "local") {
      addNotification({
        type: "warning",
        title: t("toast.syncFailed"),
        description: t("toast.noRemoteServers"),
        timestamp: Date.now(),
      })
      return
    }
    const serverId = tool.sourceId || tool.id
    setSyncingServerIds((prev) => ({ ...prev, [serverId]: true }))
    try {
      await syncServer.trigger(serverId)
      await refreshAll()
      addNotification({
        type: "success",
        title: t("toast.syncSuccess"),
        description: t("toast.syncSuccessDesc"),
        timestamp: Date.now(),
      })
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.syncFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
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
        const created = await createSource.trigger({
          name: payload.name,
          source_type: payload.sourceType,
          path_or_url: payload.pathOrUrl,
          trust_level: payload.trustLevel,
        })
        setSourceTokens((prev) => ({ ...prev, [created.id]: payload.authToken || "" }))
        await syncSource.trigger([created.id, { auth_token: payload.authToken || null }])
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
  }, [addNotification, createSource, isTauri, refreshAll, syncSource, t])

  const handleImportConfig = useCallback(async (payload: {
    config: Record<string, unknown>
  }) => {
    if (!isTauri) {
      const rawServers = payload.config?.mcpServers
      if (!rawServers || typeof rawServers !== "object") {
        addNotification({
          type: "warning",
          title: t("toast.invalidConfig"),
          description: t("addServer.errors.invalidConfig"),
          timestamp: Date.now(),
        })
        return
      }
      const entries = Object.entries(rawServers as Record<string, Record<string, unknown>>)
      if (entries.length === 0) {
        addNotification({
          type: "warning",
          title: t("toast.invalidConfig"),
          description: t("addServer.errors.invalidConfig"),
          timestamp: Date.now(),
        })
        return
      }
      const requests = entries
        .map(([name, config]) => {
          if (!config || typeof config !== "object") return null
          const command = typeof config.command === "string" ? config.command : undefined
          const args = Array.isArray(config.args)
            ? config.args.filter((item) => typeof item === "string") as string[]
            : []
          const envRaw = (config.env && typeof config.env === "object") ? config.env as Record<string, unknown> : {}
          const envKeys = Object.keys(envRaw)
          const env = envKeys.reduce<Record<string, string>>((acc, key) => {
            acc[key] = ""
            return acc
          }, {})
          const sseUrl =
            typeof config.sse_url === "string"
              ? config.sse_url
              : typeof config.url === "string"
                ? config.url
                : undefined
          const displayName = typeof config.name === "string" ? config.name : name
          if (sseUrl) {
            return {
              name: displayName,
              server_type: "sse" as const,
              sse_url: sseUrl,
              auth_type: "none" as const,
              is_enabled: true,
            }
          }
          if (command) {
            return {
              name: displayName,
              server_type: "stdio" as const,
              is_enabled: false,
              draft_config: {
                command,
                args,
                env,
              },
            }
          }
          return null
        })
        .filter(Boolean)

      if (requests.length === 0) {
        addNotification({
          type: "warning",
          title: t("toast.invalidConfig"),
          description: t("addServer.errors.invalidConfig"),
          timestamp: Date.now(),
        })
        return
      }

      const results = await Promise.allSettled(
        requests.map((req) => createServer.trigger(req!))
      )
      const succeeded = results.filter((item) => item.status === "fulfilled").length
      const failed = results.length - succeeded
      if (succeeded > 0) {
        addNotification({
          type: "success",
          title: t("toast.saveSuccess"),
          description: t("toast.importSummary", { count: succeeded }),
          timestamp: Date.now(),
        })
      }
      if (failed > 0) {
        addNotification({
          type: "warning",
          title: t("toast.saveFailed"),
          description: t("toast.importFailed", { count: failed }),
          timestamp: Date.now(),
        })
      }
      const createdServers = results
        .filter((item): item is PromiseFulfilledResult<McpServer> => item.status === "fulfilled")
        .map((item) => item.value)
      const remoteServers = createdServers.filter((server) => server.server_type === "sse" && server.sse_url)
      if (remoteServers.length > 0) {
        try {
          await syncServer.trigger(remoteServers[0].id)
        } catch (err) {
          addNotification({
            type: "warning",
            title: t("toast.syncFailed"),
            description: String(err),
            timestamp: Date.now(),
          })
        }
      }
      await refreshAll()
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
  }, [addNotification, createServer, isTauri, refreshAll, syncServer, t])

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

  const handleClearLogs = useCallback(async (tool: MCPTool) => {
    if (!isTauri) return
    await invoke("clear_mcp_logs", { tool_id: tool.id })
    setLogsByTool((prev) => ({ ...prev, [tool.id]: [] }))
  }, [isTauri])

  const handleShowLogs = useCallback((tool: MCPTool) => {
    if (!isTauri) return
    setSelectedTool(tool)
    setLogsOpen(true)
  }, [isTauri])

  const handleOpenEditServer = useCallback((tool: MCPTool) => {
    if (isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    const serverId = tool.sourceId || tool.id
    const server = mcpServers.data?.find((item) => item.id === serverId)
    if (!server) {
      addNotification({
        type: "error",
        title: t("toast.missingServer"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    setEditServer(server)
    setEditServerOpen(true)
  }, [addNotification, isTauri, mcpServers.data, t])

  const handleUpdateServer = useCallback(async (serverId: string, payload: McpServerUpdateRequest) => {
    if (isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    try {
      await updateServer.trigger([serverId, payload])
      await refreshAll()
      setEditServerOpen(false)
      setEditServer(null)
      addNotification({
        type: "success",
        title: t("toast.updateSuccess"),
        description: "",
        timestamp: Date.now(),
      })
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.updateFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, refreshAll, t, updateServer])

  const handleToggleServerEnabled = useCallback(async (tool: MCPTool, enabled: boolean) => {
    if (isTauri) return
    const serverId = tool.sourceId || tool.id
    const server = mcpServers.data?.find((item) => item.id === serverId)
    if (!server) {
      addNotification({
        type: "error",
        title: t("toast.missingServer"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    if (server.server_type !== "sse") {
      addNotification({
        type: "warning",
        title: t("toast.toggleUnsupported"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    try {
      await updateServer.trigger([serverId, { is_enabled: enabled }])
      await refreshAll()
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.updateFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, mcpServers.data, refreshAll, t, updateServer])

  const handleDeleteServer = useCallback(async (tool: MCPTool) => {
    if (isTauri) {
      addNotification({
        type: "warning",
        title: t("toast.desktopOnly"),
        description: "",
        timestamp: Date.now(),
      })
      return
    }
    const serverId = tool.sourceId || tool.id
    try {
      await removeServer.trigger(serverId)
      await refreshAll()
      addNotification({
        type: "success",
        title: t("toast.deleteSuccess"),
        description: "",
        timestamp: Date.now(),
      })
    } catch (err) {
      addNotification({
        type: "error",
        title: t("toast.deleteFailed"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }, [addNotification, isTauri, refreshAll, removeServer, t])

  const runtimeTools = useMemo(() => {
    if (isTauri) return tools
    const servers = mcpServers.data ?? []
    return servers.map(mapServerToRuntimeTool)
  }, [isTauri, mapServerToRuntimeTool, mcpServers.data, tools])

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
            onToggleTool={isTauri ? (tool, enabled) => handleToggleTool(tool, enabled) : handleToggleServerEnabled}
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
        server={editServer}
        open={editServerOpen}
        onOpenChange={(nextOpen) => {
          setEditServerOpen(nextOpen)
          if (!nextOpen) {
            setEditServer(null)
          }
        }}
        onSave={handleUpdateServer}
        loading={updateServer.isMutating}
      />
    </div>
  )
}
