import {
  getMcpRegistryConflictCount,
  getMcpRegistryEditServerTools,
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

  it("counts tools with active conflicts", () => {
    expect(getMcpRegistryConflictCount([
      { id: "a", conflictStatus: "none" },
      { id: "b", conflictStatus: "conflict" },
      { id: "c", conflictStatus: "pending" },
    ] as never)).toBe(2)
  })
})