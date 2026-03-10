import type { McpServer } from "@/lib/api/mcp"

import {
  getFirstRemoteMcpRegistryServerId,
  getMcpRegistryServerEnabledUpdate,
  getMcpRegistryServerToolTogglePayload,
  resolveMcpRegistryEditableServer,
  resolveMcpRegistrySyncServerTarget,
} from "@/components/mcp/registry-server-actions"

const remoteServer: McpServer = {
  id: "server-1",
  user_id: "user-1",
  name: "Remote Server",
  description: null,
  sse_url: "https://example.com/sse",
  is_enabled: true,
  server_type: "sse",
  auth_type: "bearer",
  secret_ref_id: null,
  tools_count: 2,
  status: "active",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
}

describe("registry server actions", () => {
  it("finds editable and syncable remote server targets", () => {
    const serverById = new Map([[remoteServer.id, remoteServer]])
    const tool = { id: "tool-1", source: "url" as const, sourceId: remoteServer.id }

    expect(getFirstRemoteMcpRegistryServerId([remoteServer])).toBe(remoteServer.id)
    expect(resolveMcpRegistryEditableServer(tool, serverById)).toEqual({ kind: "ok", server: remoteServer })
    expect(resolveMcpRegistrySyncServerTarget(tool)).toEqual({ kind: "ok", serverId: remoteServer.id })
  })

  it("returns missing/local guard results and shared payloads", () => {
    expect(resolveMcpRegistryEditableServer({ id: "tool-2" }, new Map())).toEqual({ kind: "missing_server" })
    expect(resolveMcpRegistrySyncServerTarget({ id: "tool-2", source: "local" })).toEqual({ kind: "no_remote_servers" })
    expect(getFirstRemoteMcpRegistryServerId([{ ...remoteServer, server_type: "stdio", sse_url: null }])).toBeNull()

    expect(getMcpRegistryServerEnabledUpdate(false)).toEqual({ is_enabled: false })
    expect(getMcpRegistryServerToolTogglePayload("server-1", "search", true)).toEqual({
      serverId: "server-1",
      toolName: "search",
      enabled: true,
    })
  })
})