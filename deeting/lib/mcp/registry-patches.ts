import type { MCPSource, MCPSourceStatus, MCPTool, MCPToolStatus } from "@/types/mcp"

type IdItem = { id: string }

const patchItemById = <T extends IdItem>(items: T[], id: string, updater: (item: T) => T) =>
  items.map((item) => (item.id === id ? updater(item) : item))

const upsertItemById = <T extends IdItem>(items: T[], nextItem: T) => {
  const existing = items.some((item) => item.id === nextItem.id)
  if (existing) {
    return patchItemById(items, nextItem.id, () => nextItem)
  }
  return [...items, nextItem]
}

export const upsertMcpTool = (tools: MCPTool[], nextTool: MCPTool) => upsertItemById(tools, nextTool)

export const patchMcpToolStatus = (
  tools: MCPTool[],
  toolId: string,
  status: MCPToolStatus,
  runtimeReady?: boolean
) => patchItemById(tools, toolId, (tool) => ({
  ...tool,
  status,
  runtimeReady: runtimeReady ?? tool.runtimeReady,
}))

export const patchMcpRemoteToolToggle = (tools: MCPTool[], toolId: string, enabled: boolean) =>
  patchItemById(tools, toolId, (tool) => ({
    ...tool,
    desiredEnabled: enabled,
    status: "updating",
    runtimeReady: enabled ? tool.runtimeReady : false,
    recommendedAction: undefined,
  }))

export const upsertMcpSource = (sources: MCPSource[], nextSource: MCPSource) => upsertItemById(sources, nextSource)

export const patchMcpSourceStatus = (
  sources: MCPSource[],
  sourceId: string,
  status: MCPSourceStatus
) => patchItemById(sources, sourceId, (source) => ({
  ...source,
  status,
}))