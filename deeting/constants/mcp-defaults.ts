import { MCPSource, MCPTool } from "@/types/mcp"

export const INITIAL_TOOLS: MCPTool[] = [
  {
    id: "filesystem",
    name: "Local Filesystem",
    source: "local",
    status: "running",
    ping: "2ms",
    capabilities: ["read_file", "write_file", "list_dir"],
    description: "Allows AI to read and write files in the specified local directory.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Desktop"]
  },
  {
    id: "modelscope-search",
    name: "ModelScope Search",
    source: "modelscope",
    status: "running",
    ping: "45ms",
    capabilities: ["web_search", "news_retrieval"],
    description: "Synced from ModelScope: Web search enhancement capabilities.",
    sourceId: "ms-official"
  },
  {
    id: "postgres-db",
    name: "Production DB",
    source: "local",
    status: "error",
    ping: "-",
    capabilities: ["query_sql"],
    description: "Local PostgreSQL database connector.",
    error: "Connection refused on port 5432",
    command: "docker",
    args: ["run", "--rm", "-i", "postgres-mcp"]
  }
]

export const INITIAL_SOURCES: MCPSource[] = [
  {
    id: "local-config",
    name: "Local Config",
    type: "local",
    pathOrUrl: "~/.config/deeting/mcp.json",
    status: "active",
    isReadOnly: false
  },
  {
    id: "ms-official",
    name: "ModelScope Hub",
    type: "modelscope",
    pathOrUrl: "modelscope.cn/my-collection",
    status: "active",
    lastSynced: "2m ago",
    isReadOnly: true
  }
]
