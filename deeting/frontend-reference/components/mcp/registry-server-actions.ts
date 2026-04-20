import { useCallback, type Dispatch, type SetStateAction } from "react"

import type { McpServer, McpServerUpdateRequest } from "@/lib/api/mcp"
import type { McpToolTogglePayload } from "@/lib/swr/use-mcp-tool-toggle"
import type { MCPTool } from "@/types/mcp"

import {
  getMcpRegistryServer,
  getMcpRegistryServerId,
  resolveMcpRegistryRemoteServer,
} from "./registry-guards"
import {
  getMcpRegistryErrorNotification,
  getMcpRegistryNotification,
} from "./registry-notifications"

type McpTranslate = (key: string, values?: Record<string, string | number>) => string
type McpRegistryAddNotification = (notification: ReturnType<typeof getMcpRegistryNotification>) => void

type McpRegistryServerSyncMutation = {
  trigger: (serverId: string) => Promise<unknown>
}

type McpRegistryServerUpdateMutation = {
  trigger: (args: [string, McpServerUpdateRequest]) => Promise<unknown>
}

type McpRegistryServerRemoveMutation = {
  trigger: (serverId: string) => Promise<unknown>
}

type McpRegistryServerToolToggleMutation = {
  trigger: (payload: McpToolTogglePayload) => Promise<unknown>
}

type McpRegistryServerRef = Pick<MCPTool, "id" | "source" | "sourceId">

type McpRegistryEditableServerResolution =
  | { kind: "missing_server" }
  | { kind: "ok", server: McpServer }

type McpRegistrySyncServerResolution =
  | { kind: "no_remote_servers" }
  | { kind: "ok", serverId: string }

interface UseMcpRegistryServerActionsOptions {
  isTauri: boolean
  t: McpTranslate
  addNotification: McpRegistryAddNotification
  serverById: ReadonlyMap<string, McpServer>
  servers: readonly McpServer[]
  editServer: McpServer | null
  refreshAll: () => Promise<void>
  refreshTools: () => Promise<unknown>
  syncServer: McpRegistryServerSyncMutation
  updateServer: McpRegistryServerUpdateMutation
  removeServer: McpRegistryServerRemoveMutation
  toolToggleMutation: McpRegistryServerToolToggleMutation
  setSyncingServers: Dispatch<SetStateAction<boolean>>
  setSyncingServerIds: Dispatch<SetStateAction<Record<string, boolean>>>
  setEditServer: Dispatch<SetStateAction<McpServer | null>>
  setEditServerOpen: Dispatch<SetStateAction<boolean>>
}

export const getFirstRemoteMcpRegistryServerId = (servers: readonly McpServer[]): string | null => {
  return servers.find(
    (server) =>
      (server.server_type === "sse" || server.server_type === "streamable-http") &&
      server.sse_url
  )?.id ?? null
}

export const resolveMcpRegistryEditableServer = (
  tool: Pick<MCPTool, "id" | "sourceId">,
  serverById: ReadonlyMap<string, McpServer>
): McpRegistryEditableServerResolution => {
  const server = getMcpRegistryServer(tool, serverById)
  return server ? { kind: "ok", server } : { kind: "missing_server" }
}

export const resolveMcpRegistrySyncServerTarget = (
  tool: McpRegistryServerRef
): McpRegistrySyncServerResolution => {
  if (tool.source === "local") {
    return { kind: "no_remote_servers" }
  }

  return { kind: "ok", serverId: getMcpRegistryServerId(tool) }
}

export const getMcpRegistryServerEnabledUpdate = (
  enabled: boolean
): McpServerUpdateRequest => ({ is_enabled: enabled })

export const getMcpRegistryServerToolTogglePayload = (
  serverId: string,
  toolName: string,
  enabled: boolean
): McpToolTogglePayload => ({ serverId, toolName, enabled })

export function useMcpRegistryServerActions({
  isTauri,
  t,
  addNotification,
  serverById,
  servers,
  editServer,
  refreshAll,
  refreshTools,
  syncServer,
  updateServer,
  removeServer,
  toolToggleMutation,
  setSyncingServers,
  setSyncingServerIds,
  setEditServer,
  setEditServerOpen,
}: UseMcpRegistryServerActionsOptions) {
  const handleEditServerOpenChange = useCallback((nextOpen: boolean) => {
    setEditServerOpen(nextOpen)
    if (!nextOpen) {
      setEditServer(null)
    }
  }, [setEditServer, setEditServerOpen])

  const handleSyncServers = useCallback(async () => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }

    const serverId = getFirstRemoteMcpRegistryServerId(servers)
    if (!serverId) {
      addNotification(getMcpRegistryNotification(t, "no_remote_servers"))
      return
    }

    setSyncingServers(true)
    try {
      await syncServer.trigger(serverId)
      await refreshAll()
      addNotification(getMcpRegistryNotification(t, "sync_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
      await refreshAll()
    } finally {
      setSyncingServers(false)
    }
  }, [addNotification, isTauri, refreshAll, servers, setSyncingServers, syncServer, t])

  const handleSyncServer = useCallback(async (tool: MCPTool) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }

    const resolution = resolveMcpRegistrySyncServerTarget(tool)
    if (resolution.kind === "no_remote_servers") {
      addNotification(getMcpRegistryNotification(t, "no_remote_servers"))
      return
    }

    setSyncingServerIds((prev) => ({ ...prev, [resolution.serverId]: true }))
    try {
      await syncServer.trigger(resolution.serverId)
      await refreshAll()
      addNotification(getMcpRegistryNotification(t, "sync_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
      await refreshAll()
    } finally {
      setSyncingServerIds((prev) => ({ ...prev, [resolution.serverId]: false }))
    }
  }, [addNotification, isTauri, refreshAll, setSyncingServerIds, syncServer, t])

  const handleOpenEditServer = useCallback((tool: MCPTool) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }

    const resolution = resolveMcpRegistryEditableServer(tool, serverById)
    if (resolution.kind === "missing_server") {
      addNotification(getMcpRegistryNotification(t, "missing_server"))
      return
    }

    setEditServer(resolution.server)
    setEditServerOpen(true)
  }, [addNotification, isTauri, serverById, setEditServer, setEditServerOpen, t])

  const handleUpdateServer = useCallback(async (serverId: string, payload: McpServerUpdateRequest) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }

    try {
      await updateServer.trigger([serverId, payload])
      await refreshAll()
      handleEditServerOpenChange(false)
      addNotification(getMcpRegistryNotification(t, "update_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "update", err))
    }
  }, [addNotification, handleEditServerOpenChange, isTauri, refreshAll, t, updateServer])

  const handleToggleServerTool = useCallback(async (toolName: string, enabled: boolean) => {
    if (isTauri || !editServer) return

    try {
      await toolToggleMutation.trigger(
        getMcpRegistryServerToolTogglePayload(editServer.id, toolName, enabled)
      )
      await refreshTools()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "update", err))
      void refreshTools()
    }
  }, [addNotification, editServer, isTauri, refreshTools, t, toolToggleMutation])

  const handleToggleServerEnabled = useCallback(async (tool: MCPTool, enabled: boolean) => {
    if (isTauri) return

    const resolution = resolveMcpRegistryRemoteServer(tool, serverById)
    if (resolution.kind === "missing_server") {
      addNotification(getMcpRegistryNotification(t, "missing_server"))
      return
    }

    if (resolution.kind === "unsupported_server") {
      addNotification(getMcpRegistryNotification(t, "toggle_unsupported"))
      return
    }

    try {
      await updateServer.trigger([
        resolution.serverId,
        getMcpRegistryServerEnabledUpdate(enabled),
      ])
      await refreshAll()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "update", err))
    }
  }, [addNotification, isTauri, refreshAll, serverById, t, updateServer])

  const handleDeleteServer = useCallback(async (tool: MCPTool) => {
    if (isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }

    try {
      await removeServer.trigger(getMcpRegistryServerId(tool))
      await refreshAll()
      addNotification(getMcpRegistryNotification(t, "delete_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "delete", err))
    }
  }, [addNotification, isTauri, refreshAll, removeServer, t])

  return {
    handleDeleteServer,
    handleEditServerOpenChange,
    handleOpenEditServer,
    handleSyncServer,
    handleSyncServers,
    handleToggleServerEnabled,
    handleToggleServerTool,
    handleUpdateServer,
  }
}