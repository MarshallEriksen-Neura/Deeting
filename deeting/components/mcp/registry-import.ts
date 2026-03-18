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
        addNotification(getMcpRegistryNotification(t, "invalid_config"))
        return
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
      return
    }

    try {
      await invoke(DESKTOP_MCP_COMMANDS.importConfig, { payload })
      await refreshAll()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "save", err))
    }
  }, [addNotification, createServer, isTauri, refreshAll, syncServer, t])

  return {
    handleImportConfig,
  }
}
