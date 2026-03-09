import {
  patchMcpRemoteToolToggle,
  patchMcpSourceStatus,
  patchMcpToolStatus,
  upsertMcpSource,
  upsertMcpTool,
} from "@/lib/mcp/registry-patches"
import type { MCPSource, MCPTool } from "@/types/mcp"

const makeTool = (overrides: Partial<MCPTool> = {}): MCPTool => ({
  id: "tool-1",
  name: "Tool One",
  source: "cloud",
  sourceId: "server-1",
  status: "healthy",
  ping: "12ms",
  capabilities: [],
  description: "test tool",
  configJson: "{}",
  configHash: "hash-1",
  conflictStatus: "none",
  isReadOnly: false,
  isNew: false,
  desiredEnabled: true,
  runtimeReady: true,
  recommendedAction: "sync_server",
  ...overrides,
})

const makeSource = (overrides: Partial<MCPSource> = {}): MCPSource => ({
  id: "source-1",
  name: "Source One",
  type: "cloud",
  pathOrUrl: "https://example.com/mcp",
  status: "active",
  isReadOnly: false,
  trustLevel: "official",
  ...overrides,
})

describe("registry patch helpers", () => {
  it("optimistically patches remote tool desired state", () => {
    const tools = [makeTool(), makeTool({ id: "tool-2", name: "Tool Two" })]

    const updated = patchMcpRemoteToolToggle(tools, "tool-1", false)

    expect(updated[0]).toMatchObject({
      id: "tool-1",
      desiredEnabled: false,
      status: "updating",
      runtimeReady: false,
      recommendedAction: undefined,
    })
    expect(updated[1]).toEqual(tools[1])
  })

  it("patches tool runtime status without disturbing other fields", () => {
    const tools = [makeTool({ runtimeReady: true, recommendedAction: "start_tool" })]

    const updated = patchMcpToolStatus(tools, "tool-1", "starting")

    expect(updated[0]).toMatchObject({
      id: "tool-1",
      status: "starting",
      runtimeReady: true,
      recommendedAction: "start_tool",
    })
  })

  it("upserts tools and sources by id", () => {
    const nextTool = makeTool({ id: "tool-2", name: "Tool Two" })
    const replacedTool = makeTool({ name: "Renamed Tool" })
    const nextSource = makeSource({ id: "source-2", name: "Source Two" })

    expect(upsertMcpTool([makeTool()], nextTool)).toHaveLength(2)
    expect(upsertMcpTool([makeTool()], replacedTool)[0].name).toBe("Renamed Tool")
    expect(upsertMcpSource([makeSource()], nextSource)).toHaveLength(2)
  })

  it("patches source status by id", () => {
    const sources = [makeSource(), makeSource({ id: "source-2", name: "Source Two" })]

    const updated = patchMcpSourceStatus(sources, "source-1", "syncing")

    expect(updated[0].status).toBe("syncing")
    expect(updated[1]).toEqual(sources[1])
  })
})