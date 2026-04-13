import type { McpServer, McpServerTool } from "@/lib/api/mcp"
import type { MCPEnvConfigItem, MCPSource, MCPTool, MCPToolConflict, MCPToolStatus, McpSourceRecord, McpToolRecord } from "@/types/mcp"

type McpServerToolRecordLike = McpServerTool & {
  server_id: string
}

type RemoteServerForTool = Pick<McpServer, "id" | "server_type" | "is_enabled" | "created_at" | "updated_at">

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

const getRemoteStatus = (runtimeReady: boolean): MCPToolStatus => (runtimeReady ? "healthy" : "stopped")

export const mapMcpSourceRecordToSource = (source: McpSourceRecord): MCPSource => ({
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
})

export const mapDesktopToolRecordToTool = (tool: McpToolRecord, conflictWarning?: string): MCPTool => {
  const envConfig = parseEnvConfig(tool.config_json)
  const pendingArgs = parseArgsFromConfig(tool.pending_config_json ?? undefined)
  const currentArgs = parseArgsFromConfig(tool.config_json)
  const conflict: MCPToolConflict | undefined =
    tool.conflict_status !== "none" && tool.pending_config_json
      ? {
          currentArgs: currentArgs.length ? currentArgs : tool.args || [],
          incomingArgs: pendingArgs,
          warning: tool.conflict_status === "conflict" ? conflictWarning : undefined,
        }
      : undefined

  return {
    id: tool.id,
    identifier: tool.identifier ?? undefined,
    name: tool.name,
    serviceKey: tool.service_key ?? undefined,
    serviceDisplayName: tool.service_display_name ?? undefined,
    serviceDescription: tool.service_description ?? undefined,
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
    desiredEnabled: tool.desired_enabled,
    runtimeReady: tool.runtime_ready,
    runtimeStatusReason: tool.runtime_status_reason,
    availabilityClass: tool.availability_class,
    recommendedAction: tool.recommended_action,
    activationRequired: tool.activation_required,
    installRequired: tool.install_required,
    indexStatus: tool.index_status,
    indexStatusReason: tool.index_status_reason,
    envConfig,
    conflict,
  }
}

export const mapRemoteServerToolRecordToTool = (tool: McpServerToolRecordLike, server?: RemoteServerForTool): MCPTool => {
  const desiredEnabled = tool.desired_enabled ?? tool.enabled
  const runtimeReady = tool.runtime_ready ?? (desiredEnabled && server?.is_enabled === true)

  return {
    id: `${tool.server_id}:${tool.name}`,
    identifier: undefined,
    name: tool.name,
    source: server?.server_type === "stdio" ? "local" : "url",
    sourceId: tool.server_id,
    status: getRemoteStatus(runtimeReady),
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
    desiredEnabled,
    runtimeReady,
    runtimeStatusReason: tool.runtime_status_reason ?? undefined,
    availabilityClass: tool.availability_class,
    recommendedAction: tool.recommended_action ?? undefined,
    activationRequired: tool.activation_required,
    installRequired: tool.install_required,
    indexStatus: tool.index_status,
    indexStatusReason: tool.index_status_reason ?? undefined,
    envConfig: [],
  }
}

export const mapRemoteServerToRuntimeTool = (server: McpServer): MCPTool => {
  const isRemote = server.server_type === "sse" || server.server_type === "streamable-http"
  const desiredEnabled = server.desired_enabled ?? server.is_enabled
  const runtimeReady = server.runtime_ready ?? (server.status === "active" || server.is_enabled)

  return {
    id: server.id,
    identifier: undefined,
    name: server.name,
    source: isRemote ? "url" : "local",
    sourceId: server.id,
    status: getRemoteStatus(runtimeReady),
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
    desiredEnabled,
    runtimeReady,
    runtimeStatusReason: server.runtime_status_reason ?? undefined,
    availabilityClass: server.availability_class,
    recommendedAction: server.recommended_action ?? undefined,
    activationRequired: server.activation_required,
    installRequired: server.install_required,
    indexStatus: server.index_status,
    indexStatusReason: server.index_status_reason ?? undefined,
    envConfig: [],
  }
}
