import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"

import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop"
import type { McpServer, McpServerCreateRequest } from "@/lib/api/mcp"

import {
  getMcpRegistryCountNotification,
  getMcpRegistryErrorNotification,
  getMcpRegistryNotification,
} from "./registry-notifications"

type McpTranslate = (key: string, values?: Record<string, string | number>) => string
type McpRegistryAddNotification = (notification: ReturnType<typeof getMcpRegistryNotification>) => void

type McpRegistryServerCreateMutation = {
  trigger: (payload: McpServerCreateRequest) => Promise<McpServer>
}

type McpRegistryServerSyncMutation = {
  trigger: (serverId: string) => Promise<unknown>
}

interface UseMcpRegistryImportActionOptions {
  isTauri: boolean
  t: McpTranslate
  addNotification: McpRegistryAddNotification
  createServer: McpRegistryServerCreateMutation
  syncServer: McpRegistryServerSyncMutation
  refreshAll: () => Promise<void>
}

type McpRegistryImportParseResult =
  | {
      kind: "invalid"
      reasonKey:
        | "addServer.errors.missingMcpServers"
        | "addServer.errors.emptyMcpServers"
        | "addServer.errors.serverConfigNotObject"
        | "addServer.errors.missingRemoteUrl"
        | "addServer.errors.missingCommandOrUrl"
      values?: Record<string, string | number>
    }
  | { kind: "ok"; requests: McpServerCreateRequest[] }

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

const buildInvalidImportConfigResult = (
  reasonKey: McpRegistryImportParseResult extends infer T
    ? T extends { kind: "invalid"; reasonKey: infer K }
      ? K
      : never
    : never,
  values?: Record<string, string | number>
): Extract<McpRegistryImportParseResult, { kind: "invalid" }> => ({
  kind: "invalid",
  reasonKey,
  values,
})

const normalizeRemoteServerType = (
  type: unknown
): "sse" | "streamable-http" | null => {
  if (typeof type !== "string") return null

  const normalized = type.trim().toLowerCase()
  if (normalized === "sse") return "sse"
  if (
    normalized === "streamable-http" ||
    normalized === "streamable_http" ||
    normalized === "http"
  ) {
    return "streamable-http"
  }

  return null
}

const toImportRequest = (name: string, config: unknown): McpServerCreateRequest | null => {
  if (!isRecord(config)) return null

  const command = typeof config.command === "string" ? config.command : undefined
  const serviceKey =
    typeof config.service_key === "string" && config.service_key.trim().length > 0
      ? config.service_key.trim()
      : name
  const serviceDisplayName =
    typeof config.service_display_name === "string" && config.service_display_name.trim().length > 0
      ? config.service_display_name.trim()
      : undefined
  const serviceDescription =
    typeof config.service_description === "string" && config.service_description.trim().length > 0
      ? config.service_description.trim()
      : undefined
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
  const remoteServerType = normalizeRemoteServerType(config.type)

  if (sseUrl) {
    return {
      name: serviceDisplayName || displayName,
      description: serviceDescription ?? undefined,
      server_type: remoteServerType ?? "sse",
      sse_url: sseUrl,
      auth_type: "none",
      is_enabled: true,
    }
  }

  if (command) {
    return {
      name: serviceDisplayName || displayName,
      description: serviceDescription ?? undefined,
      server_type: "stdio",
      is_enabled: false,
      draft_config: {
        service_key: serviceKey,
        service_display_name: serviceDisplayName,
        service_description: serviceDescription,
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
    return buildInvalidImportConfigResult("addServer.errors.missingMcpServers")
  }

  const serverEntries = Object.entries(rawServers)
  if (serverEntries.length === 0) {
    return buildInvalidImportConfigResult("addServer.errors.emptyMcpServers")
  }

  let firstInvalid: Extract<McpRegistryImportParseResult, { kind: "invalid" }> | null = null

  const requests = serverEntries.reduce<McpServerCreateRequest[]>((acc, [name, serverConfig]) => {
    const request = toImportRequest(name, serverConfig)
    if (request) {
      acc.push(request)
      return acc
    }

    if (!firstInvalid) {
      if (!isRecord(serverConfig)) {
        firstInvalid = buildInvalidImportConfigResult("addServer.errors.serverConfigNotObject", {
          name,
        })
        return acc
      }

      if (normalizeRemoteServerType(serverConfig.type)) {
        firstInvalid = buildInvalidImportConfigResult("addServer.errors.missingRemoteUrl", {
          name,
        })
        return acc
      }

      firstInvalid = buildInvalidImportConfigResult("addServer.errors.missingCommandOrUrl", {
        name,
      })
    }

    return acc
  }, [])

  if (requests.length === 0) {
    return firstInvalid ?? buildInvalidImportConfigResult("addServer.errors.emptyMcpServers")
  }

  return { kind: "ok", requests }
}

export const getMcpRegistryImportResultCounts = (
  results: readonly PromiseSettledResult<McpServer>[]
): { succeeded: number; failed: number; createdServers: McpServer[] } => {
  const createdServers = results
    .filter((item): item is PromiseFulfilledResult<McpServer> => item.status === "fulfilled")
    .map((item) => item.value)

  return {
    succeeded: createdServers.length,
    failed: results.length - createdServers.length,
    createdServers,
  }
}

export const getFirstImportedRemoteMcpRegistryServerId = (
  servers: readonly Pick<McpServer, "id" | "server_type" | "sse_url">[]
): string | null => {
  return servers.find(
    (server) =>
      (server.server_type === "sse" || server.server_type === "streamable-http") &&
      server.sse_url
  )?.id ?? null
}

export function useMcpRegistryImportAction({
  isTauri,
  t,
  addNotification,
  createServer,
  syncServer,
  refreshAll,
}: UseMcpRegistryImportActionOptions) {
  const handleImportConfig = useCallback(async (payload: { config: Record<string, unknown> }) => {
    if (!isTauri) {
      const parsed = parseMcpRegistryImportConfig(payload.config)
      if (parsed.kind !== "ok") {
        addNotification({
          ...getMcpRegistryNotification(t, "invalid_config"),
          description: t(parsed.reasonKey, parsed.values),
        })
        return false
      }

      const results = await Promise.allSettled(
        parsed.requests.map((request) => createServer.trigger(request))
      )
      const { succeeded, failed, createdServers } = getMcpRegistryImportResultCounts(results)

      if (succeeded > 0) {
        addNotification(getMcpRegistryCountNotification(t, "import_success", succeeded))
      }
      if (failed > 0) {
        addNotification(getMcpRegistryCountNotification(t, "import_failed", failed))
      }

      const remoteServerId = getFirstImportedRemoteMcpRegistryServerId(createdServers)
      if (remoteServerId) {
        try {
          await syncServer.trigger(remoteServerId)
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "sync", err, "warning"))
        }
      }

      await refreshAll()
      return succeeded > 0
    }

    try {
      await invoke(DESKTOP_MCP_COMMANDS.importConfig, { payload })
      await refreshAll()
      return true
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "save", err))
      return false
    }
  }, [addNotification, createServer, isTauri, refreshAll, syncServer, t])

  return {
    handleImportConfig,
  }
}
