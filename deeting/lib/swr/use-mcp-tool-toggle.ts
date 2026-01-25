import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"

import { toggleMcpServerTool, type McpServerTool } from "@/lib/api/mcp"
import { type ApiError } from "@/lib/http"

export interface McpToolTogglePayload {
  serverId: string
  toolName: string
  enabled: boolean
}

const MCP_TOOL_TOGGLE_KEY = "/api/v1/mcp/servers/tools"

export function useMcpToolToggle(): SWRMutationResponse<
  McpServerTool,
  ApiError,
  string,
  McpToolTogglePayload
> {
  return useSWRMutation(
    MCP_TOOL_TOGGLE_KEY,
    (_key, { arg }: { arg: McpToolTogglePayload }) =>
      toggleMcpServerTool(arg.serverId, arg.toolName, arg.enabled)
  )
}
