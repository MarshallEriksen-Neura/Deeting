export type MCPSourceType = 'local' | 'modelscope' | 'github' | 'url';

export interface MCPSource {
  id: string;
  name: string;
  type: MCPSourceType;
  pathOrUrl: string;
  lastSynced?: string;
  status: 'active' | 'inactive' | 'syncing' | 'error';
  isReadOnly?: boolean;
}

export interface MCPTool {
  id: string;
  name: string;
  source: MCPSourceType; // 'local' means manually added, others are synced
  sourceId?: string; // ID of the source collection if synced
  status: 'running' | 'stopped' | 'error' | 'starting';
  ping: string; // e.g., "12ms" or "-"
  capabilities: string[];
  description: string;
  error?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}
