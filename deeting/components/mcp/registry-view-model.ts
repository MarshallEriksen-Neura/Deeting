import { useMemo } from "react"

import type { McpServer, McpServerTool } from "@/lib/api/mcp"
import { mapRemoteServerToRuntimeTool } from "@/lib/mcp/registry-mappers"
import type { McpServerToolRecord } from "@/lib/swr/use-mcp-tools"
import type { MCPTool } from "@/types/mcp"

export const getMcpRegistryServerById = (servers: McpServer[] | undefined): Map<string, McpServer> => {
  const map = new Map<string, McpServer>()
  servers?.forEach((server) => map.set(server.id, server))
  return map
}

export const getMcpRegistryEditServerTools = (
  editServer: Pick<McpServer, "id"> | null,
  toolRecords: McpServerToolRecord[] | undefined
): McpServerTool[] => {
  if (!editServer) return []

  return (toolRecords ?? [])
    .filter((tool) => tool.server_id === editServer.id)
    .map((tool) => {
      const { server_id: serverId, ...rest } = tool
      void serverId
      return rest
    })
}

export const getMcpRegistryRuntimeTools = ({
  isTauri,
  tools,
  servers,
}: {
  isTauri: boolean
  tools: MCPTool[]
  servers: McpServer[] | undefined
}): MCPTool[] => {
  if (isTauri) return tools
  return (servers ?? []).map(mapRemoteServerToRuntimeTool)
}

export const getMcpRegistryConflictCount = (tools: MCPTool[]): number => {
  return tools.filter((tool) => tool.conflictStatus !== "none").length
}

export function useMcpRegistryViewModel({
  isTauri,
  servers,
  toolRecords,
  editServer,
  tools,
}: {
  isTauri: boolean
  servers: McpServer[] | undefined
  toolRecords: McpServerToolRecord[] | undefined
  editServer: McpServer | null
  tools: MCPTool[]
}) {
  const serverById = useMemo(() => getMcpRegistryServerById(servers), [servers])
  const editServerTools = useMemo(() => getMcpRegistryEditServerTools(editServer, toolRecords), [editServer, toolRecords])
  const runtimeTools = useMemo(() => getMcpRegistryRuntimeTools({ isTauri, tools, servers }), [isTauri, servers, tools])
  const conflictCount = useMemo(() => getMcpRegistryConflictCount(tools), [tools])

  return {
    conflictCount,
    editServerTools,
    runtimeTools,
    serverById,
  }
}