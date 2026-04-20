import {
  getMcpRegistryConflictCount,
  getMcpRegistryEditServerTools,
  getMcpRegistryRuntimeGroups,
  getMcpRegistryRuntimeTools,
  getMcpRegistryServerById,
} from "@/components/mcp/registry-view-model"

describe("registry view model", () => {
  it("builds a server lookup map by id", () => {
    const alpha = { id: "alpha", name: "Alpha" } as never
    const beta = { id: "beta", name: "Beta" } as never

    const map = getMcpRegistryServerById([alpha, beta])

    expect(map.get("alpha")).toBe(alpha)
    expect(map.get("beta")).toBe(beta)
  })

  it("returns edit sheet tools for the selected server", () => {
    const tools = getMcpRegistryEditServerTools(
      { id: "server-a" } as never,
      [
        { server_id: "server-a", name: "one", enabled: true },
        { server_id: "server-b", name: "two", enabled: false },
      ] as never
    )

    expect(tools).toEqual([{ name: "one", enabled: true }])
  })

  it("uses local tools for tauri and remote servers for cloud runtime cards", () => {
    const localTools = [{ id: "local-tool", conflictStatus: "none" }] as never

    expect(getMcpRegistryRuntimeTools({ isTauri: true, tools: localTools, servers: [] })).toBe(localTools)

    const runtimeTools = getMcpRegistryRuntimeTools({
      isTauri: false,
      tools: [],
      servers: [{
        id: "server-1",
        name: "Remote",
        description: "Remote server",
        server_type: "sse",
        is_enabled: true,
        status: "active",
        created_at: "2024-01-01",
        updated_at: "2024-01-02",
      }] as never,
    })

    expect(runtimeTools).toHaveLength(1)
    expect(runtimeTools[0]).toMatchObject({ id: "server-1", sourceId: "server-1", name: "Remote" })
  })

  it("groups desktop runtime tools by shared MCP service family", () => {
    const groups = getMcpRegistryRuntimeGroups({
      isTauri: true,
      tools: [
        { id: "tool-1", name: "firecrawl_scrape", sourceId: "source-a", source: "local", conflictStatus: "none", desiredEnabled: true, runtimeReady: true },
        { id: "tool-2", name: "firecrawl_map", sourceId: "source-b", source: "local", conflictStatus: "conflict", desiredEnabled: false, runtimeReady: false },
        { id: "tool-3", name: "filesystem_list_directory", sourceId: "source-c", source: "local", conflictStatus: "none", desiredEnabled: true, runtimeReady: false, args: ["-y", "@modelcontextprotocol/server-filesystem"] },
      ] as never,
      servers: [],
      sources: [
        { id: "source-a", name: "Local Config", pathOrUrl: "D:/local-a", type: "local" },
        { id: "source-b", name: "Local Config", pathOrUrl: "D:/local-b", type: "local" },
        { id: "source-c", name: "Local Config", pathOrUrl: "D:/workspace", type: "local" },
      ] as never,
    })

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ id: "family:firecrawl", name: "Firecrawl", toolCount: 2, conflictCount: 1, runningCount: 1 })
    expect(groups[1]).toMatchObject({ id: "family:filesystem", name: "Filesystem", toolCount: 1, runningCount: 0 })
  })

  it("prefers explicit non-generic source names for MCP grouping", () => {
    const groups = getMcpRegistryRuntimeGroups({
      isTauri: true,
      tools: [
        { id: "tool-1", name: "scrape", sourceId: "source-firecrawl-a", source: "local", conflictStatus: "none", desiredEnabled: true, runtimeReady: true },
        { id: "tool-2", name: "map", sourceId: "source-firecrawl-b", source: "local", conflictStatus: "none", desiredEnabled: true, runtimeReady: true },
      ] as never,
      servers: [],
      sources: [
        { id: "source-firecrawl-a", name: "Firecrawl", pathOrUrl: "https://api.firecrawl.dev", type: "url" },
        { id: "source-firecrawl-b", name: "Firecrawl", pathOrUrl: "https://api.firecrawl.dev", type: "url" },
      ] as never,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: "source:firecrawl", name: "Firecrawl", toolCount: 2, runningCount: 2 })
  })

  it("prefers persisted service metadata over runtime inference", () => {
    const groups = getMcpRegistryRuntimeGroups({
      isTauri: true,
      tools: [
        {
          id: "tool-1",
          name: "search_tool",
          serviceKey: "firecrawl",
          serviceDisplayName: "Firecrawl",
          serviceDescription: "Scrape and search toolkit",
          sourceId: "source-generic",
          source: "local",
          conflictStatus: "none",
          desiredEnabled: true,
          runtimeReady: true,
        },
      ] as never,
      servers: [],
      sources: [{ id: "source-generic", name: "Local Config", pathOrUrl: "D:/workspace", type: "local" }] as never,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: "service:firecrawl",
      name: "Firecrawl",
      description: "Scrape and search toolkit",
      toolCount: 1,
    })
  })

  it("builds cloud runtime groups from remote servers and attached tools", () => {
    const groups = getMcpRegistryRuntimeGroups({
      isTauri: false,
      tools: [
        { id: "server-1:search", sourceId: "server-1", name: "search", conflictStatus: "none", desiredEnabled: true, runtimeReady: true },
        { id: "server-1:fetch", sourceId: "server-1", name: "fetch", conflictStatus: "none", desiredEnabled: false, runtimeReady: false },
      ] as never,
      servers: [{
        id: "server-1",
        name: "Remote",
        description: "Remote server",
        tools_count: 2,
        server_type: "sse",
        is_enabled: true,
        status: "active",
        created_at: "2024-01-01",
        updated_at: "2024-01-02",
      }] as never,
      sources: [],
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: "server-1", name: "Remote", toolCount: 2, runningCount: 1 })
  })

  it("counts tools with active conflicts", () => {
    expect(getMcpRegistryConflictCount([
      { id: "a", conflictStatus: "none" },
      { id: "b", conflictStatus: "conflict" },
      { id: "c", conflictStatus: "pending" },
    ] as never)).toBe(2)
  })
})
