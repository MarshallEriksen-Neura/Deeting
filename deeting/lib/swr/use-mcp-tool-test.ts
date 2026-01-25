import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"

import { testMcpTool, type McpToolTestRequest, type McpToolTestResponse } from "@/lib/api/mcp"
import { type ApiError } from "@/lib/http"

const MCP_TOOL_TEST_KEY = "/api/v1/mcp/tools/test"

export function useMcpToolTest(): SWRMutationResponse<
  McpToolTestResponse,
  ApiError,
  string,
  McpToolTestRequest
> {
  return useSWRMutation(
    MCP_TOOL_TEST_KEY,
    (_key, { arg }: { arg: McpToolTestRequest }) => testMcpTool(arg)
  )
}
