import { z } from "zod"

import { request } from "@/lib/http"

export const McpServerSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sse_url: z.string().nullable().optional(),
  is_enabled: z.boolean(),
  server_type: z.enum(["sse", "stdio"]),
  auth_type: z.string(),
  secret_ref_id: z.string().nullable().optional(),
  tools_count: z.number(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type McpServer = z.infer<typeof McpServerSchema>

export const McpServerToolSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  input_schema: z.record(z.any()).default({}),
  enabled: z.boolean(),
})

export type McpServerTool = z.infer<typeof McpServerToolSchema>

export const McpSourceSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  source_type: z.enum(["local", "cloud", "modelscope", "github", "url"]),
  path_or_url: z.string(),
  trust_level: z.enum(["official", "community", "private"]),
  status: z.enum(["active", "inactive", "syncing", "error", "draft"]),
  last_synced_at: z.string().nullable().optional(),
  is_read_only: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type McpSource = z.infer<typeof McpSourceSchema>

export const McpSourceSyncResponseSchema = z.object({
  source: McpSourceSchema,
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
})

export type McpSourceSyncResponse = z.infer<typeof McpSourceSyncResponseSchema>

export const McpToolTestResponseSchema = z.object({
  status: z.enum(["success", "error"]),
  result: z.unknown().optional().nullable(),
  error: z.string().optional().nullable(),
  logs: z.array(z.string()).default([]),
  trace_id: z.string(),
})

export type McpToolTestResponse = z.infer<typeof McpToolTestResponseSchema>

export interface McpServerCreateRequest {
  name: string
  description?: string | null
  server_type?: "sse" | "stdio"
  sse_url?: string | null
  auth_type?: "bearer" | "api_key" | "none"
  secret_value?: string | null
  is_enabled?: boolean
  draft_config?: Record<string, unknown> | null
}

export interface McpServerUpdateRequest {
  name?: string
  description?: string | null
  server_type?: "sse" | "stdio"
  sse_url?: string | null
  auth_type?: "bearer" | "api_key" | "none"
  secret_value?: string | null
  is_enabled?: boolean | null
  draft_config?: Record<string, unknown> | null
}

export interface McpSourceCreateRequest {
  name: string
  source_type: "local" | "cloud" | "modelscope" | "github" | "url"
  path_or_url: string
  trust_level: "official" | "community" | "private"
}

export interface McpSourceSyncRequest {
  auth_token?: string | null
}

export interface McpToolTestRequest {
  server_id: string
  tool_name: string
  arguments?: Record<string, unknown>
}

const MCP_BASE = "/api/v1/mcp"

export async function fetchMcpServers(): Promise<McpServer[]> {
  const data = await request<McpServer[]>({
    url: `${MCP_BASE}/servers`,
    method: "GET",
  })
  return z.array(McpServerSchema).parse(data)
}

export async function fetchMcpSources(): Promise<McpSource[]> {
  const data = await request<McpSource[]>({
    url: `${MCP_BASE}/sources`,
    method: "GET",
  })
  return z.array(McpSourceSchema).parse(data)
}

export async function createMcpServer(payload: McpServerCreateRequest): Promise<McpServer> {
  const data = await request<McpServer>({
    url: `${MCP_BASE}/servers`,
    method: "POST",
    data: payload,
  })
  return McpServerSchema.parse(data)
}

export async function createMcpSource(payload: McpSourceCreateRequest): Promise<McpSource> {
  const data = await request<McpSource>({
    url: `${MCP_BASE}/sources`,
    method: "POST",
    data: payload,
  })
  return McpSourceSchema.parse(data)
}

export async function updateMcpServer(
  serverId: string,
  payload: McpServerUpdateRequest
): Promise<McpServer> {
  const data = await request<McpServer>({
    url: `${MCP_BASE}/servers/${serverId}`,
    method: "PUT",
    data: payload,
  })
  return McpServerSchema.parse(data)
}

export async function deleteMcpServer(serverId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({
    url: `${MCP_BASE}/servers/${serverId}`,
    method: "DELETE",
  })
}

export async function deleteMcpSource(sourceId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({
    url: `${MCP_BASE}/sources/${sourceId}`,
    method: "DELETE",
  })
}

export async function syncMcpServer(serverId: string): Promise<McpServer> {
  const data = await request<McpServer>({
    url: `${MCP_BASE}/servers/${serverId}/sync`,
    method: "POST",
  })
  return McpServerSchema.parse(data)
}

export async function syncMcpSource(
  sourceId: string,
  payload: McpSourceSyncRequest
): Promise<McpSourceSyncResponse> {
  const data = await request<McpSourceSyncResponse>({
    url: `${MCP_BASE}/sources/${sourceId}/sync`,
    method: "POST",
    data: payload,
  })
  return McpSourceSyncResponseSchema.parse(data)
}

export async function fetchMcpServerTools(serverId: string): Promise<McpServerTool[]> {
  const data = await request<McpServerTool[]>({
    url: `${MCP_BASE}/servers/${serverId}/tools`,
    method: "GET",
  })
  return z.array(McpServerToolSchema).parse(data)
}

export async function toggleMcpServerTool(
  serverId: string,
  toolName: string,
  enabled: boolean
): Promise<McpServerTool> {
  const data = await request<McpServerTool>({
    url: `${MCP_BASE}/servers/${serverId}/tools/${encodeURIComponent(toolName)}`,
    method: "PATCH",
    data: { enabled },
  })
  return McpServerToolSchema.parse(data)
}

export async function testMcpTool(payload: McpToolTestRequest): Promise<McpToolTestResponse> {
  const data = await request<McpToolTestResponse>({
    url: `${MCP_BASE}/tools/test`,
    method: "POST",
    data: payload,
  })
  return McpToolTestResponseSchema.parse(data)
}
