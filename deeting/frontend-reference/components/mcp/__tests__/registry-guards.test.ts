import type { McpServer } from "@/lib/api/mcp"
import {
  getMcpRegistryServer,
  getMcpRegistryServerId,
  resolveMcpRegistryRemoteServer,
} from "@/components/mcp/registry-guards"

const baseServer: McpServer = {
  id: "server-1",
  user_id: "user-1",
  name: "Remote server",
  description: null,
  sse_url: "https://example.com/sse",
  is_enabled: true,
  server_type: "sse",
  auth_type: "none",
  secret_ref_id: null,
  tools_count: 1,
  status: "connected",
  desired_enabled: true,
  runtime_ready: true,
  runtime_status_reason: null,
  availability_class: "callable_direct",
  recommended_action: null,
  index_status: "indexed",
  index_status_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

describe("registry guards", () => {
  it("prefers sourceId when resolving registry server id", () => {
    expect(getMcpRegistryServerId({ id: "tool-1", sourceId: "server-1" })).toBe("server-1")
    expect(getMcpRegistryServerId({ id: "server-2" })).toBe("server-2")
  })

  it("finds a server by resolved id", () => {
    const serverById = new Map([[baseServer.id, baseServer]])

    expect(getMcpRegistryServer({ id: "tool-1", sourceId: "server-1" }, serverById)).toEqual(baseServer)
    expect(getMcpRegistryServer({ id: "missing" }, serverById)).toBeNull()
  })

  it("resolves missing, unsupported and remote server cases", () => {
    const stdioServer: McpServer = { ...baseServer, id: "server-2", server_type: "stdio", sse_url: null }
    const streamableHttpServer: McpServer = {
      ...baseServer,
      id: "server-3",
      server_type: "streamable-http",
      sse_url: "https://example.com/mcp",
    }
    const serverById = new Map<string, McpServer>([
      [baseServer.id, baseServer],
      [stdioServer.id, stdioServer],
      [streamableHttpServer.id, streamableHttpServer],
    ])

    expect(resolveMcpRegistryRemoteServer({ id: "tool-1", sourceId: "missing" }, serverById)).toEqual({
      kind: "missing_server",
      serverId: "missing",
    })

    expect(resolveMcpRegistryRemoteServer({ id: "tool-2", sourceId: "server-2" }, serverById)).toEqual({
      kind: "unsupported_server",
      serverId: "server-2",
      server: stdioServer,
    })

    expect(resolveMcpRegistryRemoteServer({ id: "tool-3", sourceId: "server-1" }, serverById)).toEqual({
      kind: "ok",
      serverId: "server-1",
      server: baseServer,
    })

    expect(resolveMcpRegistryRemoteServer({ id: "tool-4", sourceId: "server-3" }, serverById)).toEqual({
      kind: "ok",
      serverId: "server-3",
      server: streamableHttpServer,
    })
  })
})