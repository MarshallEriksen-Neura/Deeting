import type { McpServerCreateRequest } from "@/lib/api/mcp"

type McpRegistryImportParseResult =
  | { kind: "invalid" }
  | { kind: "ok"; requests: McpServerCreateRequest[] }

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

const toImportRequest = (name: string, config: unknown): McpServerCreateRequest | null => {
  if (!isRecord(config)) return null

  const command = typeof config.command === "string" ? config.command : undefined
  const args = Array.isArray(config.args)
    ? config.args.filter((item): item is string => typeof item === "string")
    : []
  const envRaw = isRecord(config.env) ? config.env : {}
  const env = Object.keys(envRaw).reduce<Record<string, string>>((acc, key) => {
    acc[key] = ""
    return acc
  }, {})
  const sseUrl =
    typeof config.sse_url === "string"
      ? config.sse_url
      : typeof config.url === "string"
        ? config.url
        : undefined
  const displayName = typeof config.name === "string" ? config.name : name

  if (sseUrl) {
    return {
      name: displayName,
      server_type: "sse",
      sse_url: sseUrl,
      auth_type: "none",
      is_enabled: true,
    }
  }

  if (command) {
    return {
      name: displayName,
      server_type: "stdio",
      is_enabled: false,
      draft_config: {
        command,
        args,
        env,
      },
    }
  }

  return null
}

export const parseMcpRegistryImportConfig = (
  config: Record<string, unknown>
): McpRegistryImportParseResult => {
  const rawServers = config.mcpServers
  if (!isRecord(rawServers)) {
    return { kind: "invalid" }
  }

  const requests = Object.entries(rawServers)
    .map(([name, serverConfig]) => toImportRequest(name, serverConfig))
    .filter((request): request is McpServerCreateRequest => request !== null)

  if (requests.length === 0) {
    return { kind: "invalid" }
  }

  return { kind: "ok", requests }
}