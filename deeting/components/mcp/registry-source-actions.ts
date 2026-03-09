import type { McpSourceCreateRequest } from "@/lib/api/mcp"
import type { MCPSource } from "@/types/mcp"

export interface McpRegistrySourceActionInput {
  name: string
  sourceType: MCPSource["type"]
  pathOrUrl: string
  trustLevel: MCPSource["trustLevel"]
  authToken?: string
}

export const getMcpRegistrySourceSyncPayload = (authToken?: string): { auth_token: string | null } => ({
  auth_token: authToken || null,
})

export const getMcpRegistrySourceCreateRequest = (
  input: McpRegistrySourceActionInput
): McpSourceCreateRequest => ({
  name: input.name,
  source_type: input.sourceType,
  path_or_url: input.pathOrUrl,
  trust_level: input.trustLevel,
})

export const getDesktopMcpRegistrySourceCreatePayload = (
  input: McpRegistrySourceActionInput
): McpSourceCreateRequest & { is_read_only: boolean } => ({
  ...getMcpRegistrySourceCreateRequest(input),
  is_read_only: input.sourceType !== "local",
})

export const shouldSyncCreatedMcpSource = (input: McpRegistrySourceActionInput): boolean => {
  return Boolean(input.authToken)
}