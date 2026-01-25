import { useCallback } from "react"
import useSWR from "swr"
import useSWRMutation, { type SWRMutationResponse } from "swr/mutation"

import {
  createMcpServer,
  deleteMcpServer,
  fetchMcpServers,
  syncMcpServer,
  updateMcpServer,
  type McpServer,
  type McpServerCreateRequest,
  type McpServerUpdateRequest,
} from "@/lib/api/mcp"
import { type ApiError } from "@/lib/http"
import { type SWRResult } from "@/lib/swr/fetcher"

const MCP_SERVERS_KEY = "/api/v1/mcp/servers"

export interface McpServersState extends SWRResult<McpServer[]> {
  create: SWRMutationResponse<McpServer, ApiError, string, McpServerCreateRequest>
  update: SWRMutationResponse<McpServer, ApiError, [string, McpServerUpdateRequest], McpServerUpdateRequest>
  remove: SWRMutationResponse<{ ok: boolean }, ApiError, string, string>
  sync: SWRMutationResponse<McpServer, ApiError, string, string>
  refresh: () => void
}

export function useMcpServers(options: { enabled?: boolean } = {}): McpServersState {
  const key = options.enabled === false ? null : MCP_SERVERS_KEY
  const swr = useSWR<McpServer[], ApiError>(key, fetchMcpServers, {
    revalidateOnFocus: false,
  })

  const create = useSWRMutation(
    MCP_SERVERS_KEY,
    (_key, { arg }: { arg: McpServerCreateRequest }) => createMcpServer(arg)
  )

  const update = useSWRMutation(
    MCP_SERVERS_KEY,
    (_key, { arg }: { arg: [string, McpServerUpdateRequest] }) =>
      updateMcpServer(arg[0], arg[1])
  )

  const remove = useSWRMutation(
    MCP_SERVERS_KEY,
    (_key, { arg }: { arg: string }) => deleteMcpServer(arg)
  )

  const sync = useSWRMutation(
    MCP_SERVERS_KEY,
    (_key, { arg }: { arg: string }) => syncMcpServer(arg)
  )

  const { mutate } = swr
  const refresh = useCallback(() => {
    void mutate()
  }, [mutate])

  return {
    ...swr,
    create,
    update,
    remove,
    sync,
    refresh,
  }
}
