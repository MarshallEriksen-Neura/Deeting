import {
  getFirstImportedRemoteMcpRegistryServerId,
  getMcpRegistryImportResultCounts,
  parseMcpRegistryImportConfig,
} from "@/components/mcp/registry-import"

describe("registry import", () => {
  it("returns invalid when mcpServers is missing or empty", () => {
    expect(parseMcpRegistryImportConfig({})).toEqual({ kind: "invalid" })
    expect(parseMcpRegistryImportConfig({ mcpServers: {} })).toEqual({ kind: "invalid" })
  })

  it("builds sse and stdio server create requests", () => {
    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        remoteA: { url: "https://example.com/sse", name: "Remote A" },
        localB: {
          command: "node",
          args: ["server.js", 42, "--watch"],
          env: { API_KEY: "secret", DEBUG: true },
        },
      },
    })).toEqual({
      kind: "ok",
      requests: [
        {
          name: "Remote A",
          server_type: "sse",
          sse_url: "https://example.com/sse",
          auth_type: "none",
          is_enabled: true,
        },
        {
          name: "localB",
          server_type: "stdio",
          is_enabled: false,
          draft_config: {
            command: "node",
            args: ["server.js", "--watch"],
            env: { API_KEY: "", DEBUG: "" },
          },
        },
      ],
    })
  })

  it("ignores invalid entries but still returns valid requests", () => {
    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        broken: { foo: "bar" },
        remoteA: { sse_url: "https://example.com/stream" },
      },
    })).toEqual({
      kind: "ok",
      requests: [
        {
          name: "remoteA",
          server_type: "sse",
          sse_url: "https://example.com/stream",
          auth_type: "none",
          is_enabled: true,
        },
      ],
    })
  })

  it("summarizes import results and resolves the first remote server id", () => {
    const local = { id: "local-1", server_type: "stdio", sse_url: null }
    const remote = { id: "remote-1", server_type: "sse", sse_url: "https://example.com/sse" }
    const streamableHttpRemote = {
      id: "remote-2",
      server_type: "streamable-http",
      sse_url: "https://example.com/mcp",
    }
    const summary = getMcpRegistryImportResultCounts([
      { status: "fulfilled", value: local as never },
      { status: "rejected", reason: new Error("boom") },
      { status: "fulfilled", value: remote as never },
      { status: "fulfilled", value: streamableHttpRemote as never },
    ])

    expect(summary.succeeded).toBe(3)
    expect(summary.failed).toBe(1)
    expect(summary.createdServers).toEqual([local, remote, streamableHttpRemote])
    expect(getFirstImportedRemoteMcpRegistryServerId(summary.createdServers as never)).toBe("remote-1")
    expect(getFirstImportedRemoteMcpRegistryServerId([{ id: "local-2", server_type: "stdio", sse_url: null }, streamableHttpRemote] as never)).toBe("remote-2")
  })
})