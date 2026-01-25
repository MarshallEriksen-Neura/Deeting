export type MCPSourceType = "local" | "cloud" | "modelscope" | "github" | "url"

export type MCPSourceTrustLevel = "official" | "community" | "private"

export type MCPSourceStatus = "active" | "inactive" | "syncing" | "error" | "draft"

export interface McpSourceRecord {
  id: string
  name: string
  source_type: MCPSourceType
  path_or_url: string
  trust_level: MCPSourceTrustLevel
  status: MCPSourceStatus
  last_synced_at?: string | null
  is_read_only: boolean
  created_at: string
  updated_at: string
}

export interface MCPSource {
  id: string
  name: string
  type: MCPSourceType
  pathOrUrl: string
  lastSynced?: string
  status: MCPSourceStatus
  isReadOnly: boolean
  trustLevel: MCPSourceTrustLevel
  serverType?: "sse" | "stdio"
  createdAt?: string
  updatedAt?: string
}

export type MCPToolStatus =
  | "pending"
  | "stopped"
  | "starting"
  | "healthy"
  | "degraded"
  | "crashed"
  | "updating"
  | "error"
  | "orphaned"

export type MCPConflictStatus = "none" | "update_available" | "conflict"

export interface McpToolRecord {
  id: string
  identifier?: string | null
  name: string
  source_type: MCPSourceType
  source_id?: string | null
  status: MCPToolStatus
  ping_ms?: number | null
  capabilities: string[]
  description: string
  error?: string | null
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
  config_json: string
  pending_config_json?: string | null
  config_hash: string
  pending_config_hash?: string | null
  conflict_status: MCPConflictStatus
  is_read_only: boolean
  is_new: boolean
  created_at: string
  updated_at: string
}

export interface MCPEnvConfigItem {
  key: string
  label?: string
  description?: string
  required?: boolean
  secret?: boolean
  default?: string
}

export interface MCPToolConflict {
  currentArgs: string[]
  incomingArgs: string[]
  warning?: string
}

export interface MCPTool {
  id: string
  identifier?: string
  name: string
  source: MCPSourceType
  sourceId?: string
  status: MCPToolStatus
  ping: string
  pingMs?: number
  capabilities: string[]
  description: string
  error?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  configJson: string
  pendingConfigJson?: string
  configHash: string
  pendingConfigHash?: string
  conflictStatus: MCPConflictStatus
  isReadOnly: boolean
  isNew: boolean
  createdAt?: string
  updatedAt?: string
  envConfig?: MCPEnvConfigItem[]
  conflict?: MCPToolConflict
}

export type MCPLogStream = "stdout" | "stderr" | "event"

export interface MCPLogEntry {
  timestamp: string
  stream: MCPLogStream
  message: string
}
