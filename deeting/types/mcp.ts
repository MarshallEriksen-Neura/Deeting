export type MCPSourceType = 'local' | 'modelscope' | 'github' | 'url';

export type MCPSourceTrustLevel = 'official' | 'community' | 'private';

export interface MCPSource {
  id: string;
  name: string;
  type: MCPSourceType;
  pathOrUrl: string;
  lastSynced?: string;
  status: 'active' | 'inactive' | 'syncing' | 'error';
  isReadOnly?: boolean;
  trustLevel: MCPSourceTrustLevel;
}

export type MCPToolStatus = 'stopped' | 'starting' | 'running' | 'degraded' | 'crashed' | 'updating' | 'error';

export interface MCPToolConflict {
    currentArgs: string[];
    incomingArgs: string[];
    warning?: string;
}

export interface MCPTool {
  id: string;
  name: string;
  source: MCPSourceType; // 'local' means manually added, others are synced
  sourceId?: string; // ID of the source collection if synced
  status: MCPToolStatus;
  ping: string; // e.g., "12ms" or "-"
  capabilities: string[];
  description: string;
  error?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  conflict?: MCPToolConflict; // If present, indicates a config conflict
}