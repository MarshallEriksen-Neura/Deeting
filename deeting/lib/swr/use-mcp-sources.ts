import { useCallback } from "react"
import useSWR from "swr"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"

import type { ApiError } from "@/lib/api/request"
import { type SWRResult } from "@/lib/swr/fetcher"
import {
  createMcpSource,
  deleteMcpSource,
  fetchMcpSources,
  syncMcpSource,
  type McpSource,
  type McpSourceCreateRequest,
  type McpSourceSyncRequest,
  type McpSourceSyncResponse,
} from "@/lib/api/mcp"

const MCP_SOURCES_KEY = "/api/v1/mcp/sources"

export interface McpSourcesState extends SWRResult<McpSource[]> {
  create: SWRMutationResponse<McpSource, ApiError, string, McpSourceCreateRequest>
  remove: SWRMutationResponse<{ ok: boolean }, ApiError, string, string>
  sync: SWRMutationResponse<McpSourceSyncResponse, ApiError, string, [string, McpSourceSyncRequest]>
  refresh: () => void
}

export function useMcpSources(options: { enabled?: boolean } = {}): McpSourcesState {
  const key = options.enabled === false ? null : MCP_SOURCES_KEY
  const swr = useSWR<McpSource[], ApiError>(key, fetchMcpSources, {
    revalidateOnFocus: false,
  })

  const create = useSWRMutation(
    MCP_SOURCES_KEY,
    (_key, { arg }: { arg: McpSourceCreateRequest }) => createMcpSource(arg)
  )

  const remove = useSWRMutation(
    MCP_SOURCES_KEY,
    (_key, { arg }: { arg: string }) => deleteMcpSource(arg)
  )

  const sync = useSWRMutation(
    MCP_SOURCES_KEY,
    (_key, { arg }: { arg: [string, McpSourceSyncRequest] }) => syncMcpSource(arg[0], arg[1])
  )

  const { mutate } = swr
  const refresh = useCallback(() => {
    void mutate()
  }, [mutate])

  return {
    ...swr,
    create,
    remove,
    sync,
    refresh,
  }
}
