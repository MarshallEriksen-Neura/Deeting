import { useMemo } from "react"
import useSWR from "swr"

import { fetchMcpServerTools, type McpServer, type McpServerTool } from "@/lib/api/mcp"
import { type ApiError } from "@/lib/http"
import { type SWRResult } from "@/lib/swr/fetcher"

export interface McpServerToolRecord extends McpServerTool {
  server_id: string
}

async function fetchAllServerTools(servers: McpServer[]): Promise<McpServerToolRecord[]> {
  const results = await Promise.all(
    servers.map(async (server) => {
      const tools = await fetchMcpServerTools(server.id)
      return tools.map((tool) => ({ ...tool, server_id: server.id }))
    })
  )
  return results.flat()
}

export function useMcpTools(servers: McpServer[] | undefined): SWRResult<McpServerToolRecord[]> {
  const key = useMemo(() => {
    if (!servers || servers.length === 0) return null
    const ids = servers.map((s) => s.id).sort().join(",")
    return [`/api/v1/mcp/servers/tools`, ids]
  }, [servers])

  return useSWR<McpServerToolRecord[], ApiError>(
    key,
    async () => fetchAllServerTools(servers ?? []),
    { revalidateOnFocus: false }
  )
}
