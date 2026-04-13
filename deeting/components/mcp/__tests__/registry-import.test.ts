import {
  getFirstImportedRemoteMcpRegistryServerId,
  getMcpRegistryImportResultCounts,
  parseMcpRegistryImportConfig,
} from "@/components/mcp/registry-import"

describe("registry import", () => {
  it("returns invalid when mcpServers is missing or empty", () => {
    expect(parseMcpRegistryImportConfig({})).toEqual({
      kind: "invalid",
      reasonKey: "addServer.errors.missingMcpServers",
    })
    expect(parseMcpRegistryImportConfig({ mcpServers: {} })).toEqual({
      kind: "invalid",
      reasonKey: "addServer.errors.emptyMcpServers",
    })
  })

  it("builds sse and stdio server create requests", () => {
    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        remoteA: { url: "https://example.com/sse", name: "Remote A" },
        remoteB: { type: "http", url: "https://example.com/mcp", name: "Remote B" },
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
          name: "Remote B",
          server_type: "streamable-http",
          sse_url: "https://example.com/mcp",
          auth_type: "none",
          is_enabled: true,
        },
        {
          name: "localB",
          server_type: "stdio",
          is_enabled: false,
          draft_config: {
            service_key: "localB",
            service_display_name: undefined,
            service_description: undefined,
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

  it("preserves explicit MCP service metadata during import parsing", () => {
    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        firecrawl: {
          command: "npx",
          args: ["-y", "@mendable/firecrawl-mcp"],
          env: { FIRECRAWL_API_KEY: "secret" },
          service_key: "firecrawl",
          service_display_name: "Firecrawl",
          service_description: "Scrape and search the web",
        },
      },
    })).toEqual({
      kind: "ok",
      requests: [
        {
          name: "Firecrawl",
          description: "Scrape and search the web",
          server_type: "stdio",
          is_enabled: false,
          draft_config: {
            service_key: "firecrawl",
            service_display_name: "Firecrawl",
            service_description: "Scrape and search the web",
            command: "npx",
            args: ["-y", "@mendable/firecrawl-mcp"],
            env: { FIRECRAWL_API_KEY: "" },
          },
        },
      ],
    })
  })

  it("returns the first detailed validation reason when no importable servers exist", () => {
    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        tavily: { type: "http" },
      },
    })).toEqual({
      kind: "invalid",
      reasonKey: "addServer.errors.missingRemoteUrl",
      values: { name: "tavily" },
    })

    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        broken: "nope",
      },
    })).toEqual({
      kind: "invalid",
      reasonKey: "addServer.errors.serverConfigNotObject",
      values: { name: "broken" },
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
