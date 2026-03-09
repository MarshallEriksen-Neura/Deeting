import type { McpServer } from "@/lib/api/mcp"
import type { MCPTool } from "@/types/mcp"

type McpRegistryServerRef = Pick<MCPTool, "id" | "sourceId">

type McpRegistrySseServerResolution =
  | { kind: "missing_server", serverId: string }
  | { kind: "unsupported_server", serverId: string, server: McpServer }
  | { kind: "ok", serverId: string, server: McpServer }

export const getMcpRegistryServerId = (tool: McpRegistryServerRef): string => {
  return tool.sourceId || tool.id
}

export const getMcpRegistryServer = (
  tool: McpRegistryServerRef,
  serverById: ReadonlyMap<string, McpServer>
): McpServer | null => {
  return serverById.get(getMcpRegistryServerId(tool)) ?? null
}

export const resolveMcpRegistrySseServer = (
  tool: McpRegistryServerRef,
  serverById: ReadonlyMap<string, McpServer>
): McpRegistrySseServerResolution => {
  const serverId = getMcpRegistryServerId(tool)
  const server = serverById.get(serverId)

  if (!server) {
    return { kind: "missing_server", serverId }
  }

  if (server.server_type !== "sse") {
    return { kind: "unsupported_server", serverId, server }
  }

  return { kind: "ok", serverId, server }
}