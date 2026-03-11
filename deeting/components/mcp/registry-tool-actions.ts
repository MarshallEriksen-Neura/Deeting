import { useCallback, type Dispatch, type SetStateAction } from "react"
import { invoke } from "@tauri-apps/api/core"

import type { McpServerTool } from "@/lib/api/mcp"
import { patchMcpRemoteToolToggle, patchMcpToolStatus, upsertMcpTool } from "@/lib/mcp/registry-patches"
import type { McpServerToolRecord } from "@/lib/swr/use-mcp-tools"
import type { McpToolTogglePayload } from "@/lib/swr/use-mcp-tool-toggle"
import type { MCPTool, McpToolRecord } from "@/types/mcp"

import { getMcpPrimaryActionIntent, getMcpToggleActionIntent } from "./tool-semantics"
import { getMcpRegistryErrorNotification, getMcpRegistryNotification } from "./registry-notifications"

type McpTranslate = (key: string, values?: Record<string, string | number>) => string
type McpRegistryAddNotification = (notification: ReturnType<typeof getMcpRegistryNotification>) => void
type McpRegistryConflictAction = "keep" | "update"

type McpRegistryToolToggleMutation = {
  trigger: (payload: McpToolTogglePayload) => Promise<McpServerTool>
}

type McpRegistryRemoteToolToggleResolution =
  | { kind: "missing_server" }
  | { kind: "ok", payload: McpToolTogglePayload }

type McpRegistryEnableSkillResolution =
  | { kind: "missing_skill_id" }
  | { kind: "ok", skillId: string }

interface UseMcpRegistryToolActionsOptions {
  isTauri: boolean
  t: McpTranslate
  addNotification: McpRegistryAddNotification
  conflictTool: MCPTool | null
  refreshAll: () => Promise<void>
  refreshTools: () => Promise<unknown>
  toolToggleMutation: McpRegistryToolToggleMutation
  mapTool: (tool: McpToolRecord) => MCPTool
  mapServerTool: (tool: McpServerToolRecord) => MCPTool
  updateToolList: (updater: (tools: MCPTool[]) => MCPTool[]) => void
  handleOpenEditServer: (tool: MCPTool) => void
  handleSyncServer: (tool: MCPTool) => Promise<void>
  handleToggleServerEnabled: (tool: MCPTool, enabled: boolean) => Promise<void>
  setSelectedTool: Dispatch<SetStateAction<MCPTool | null>>
  setLogsOpen: Dispatch<SetStateAction<boolean>>
  setConflictTool: Dispatch<SetStateAction<MCPTool | null>>
  setConflictOpen: Dispatch<SetStateAction<boolean>>
}

export const resolveMcpRegistryRemoteToolToggle = (
  tool: Pick<MCPTool, "sourceId" | "name">,
  enabled: boolean
): McpRegistryRemoteToolToggleResolution => {
  if (!tool.sourceId) {
    return { kind: "missing_server" }
  }

  return {
    kind: "ok",
    payload: { serverId: tool.sourceId, toolName: tool.name, enabled },
  }
}

export const resolveMcpRegistryEnableSkill = (
  tool: Pick<MCPTool, "backingSkillId">
): McpRegistryEnableSkillResolution => {
  return tool.backingSkillId ? { kind: "ok", skillId: tool.backingSkillId } : { kind: "missing_skill_id" }
}

export const getMcpRegistryConflictResolutionPayload = (
  toolId: string,
  action: McpRegistryConflictAction
) => ({ tool_id: toolId, payload: { action } })

export function useMcpRegistryToolActions({
  isTauri,
  t,
  addNotification,
  conflictTool,
  refreshAll,
  refreshTools,
  toolToggleMutation,
  mapTool,
  mapServerTool,
  updateToolList,
  handleOpenEditServer,
  handleSyncServer,
  handleToggleServerEnabled,
  setSelectedTool,
  setLogsOpen,
  setConflictTool,
  setConflictOpen,
}: UseMcpRegistryToolActionsOptions) {
  const handleShowLogs = useCallback((tool: MCPTool) => {
    if (!isTauri) return
    setSelectedTool(tool)
    setLogsOpen(true)
  }, [isTauri, setLogsOpen, setSelectedTool])

  const handleConflictOpenChange = useCallback((nextOpen: boolean) => {
    setConflictOpen(nextOpen)
    if (!nextOpen) {
      setConflictTool(null)
    }
  }, [setConflictOpen, setConflictTool])

  const handleDeleteTool = useCallback(async (tool: MCPTool) => {
    if (!isTauri) {
      addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }

    try {
      await invoke("delete_local_mcp_tool", { toolId: tool.id })
      await refreshAll()
      addNotification(getMcpRegistryNotification(t, "delete_success"))
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "delete", err))
      await refreshAll()
    }
  }, [addNotification, isTauri, refreshAll, t])

  const handleOpenConflict = useCallback((tool: MCPTool) => {
    setConflictTool(tool)
    setConflictOpen(true)
  }, [setConflictOpen, setConflictTool])

  const handleResolveConflict = useCallback(async (action: McpRegistryConflictAction) => {
    if (!isTauri || !conflictTool) {
      if (!isTauri) addNotification(getMcpRegistryNotification(t, "desktop_only"))
      return
    }

    try {
      const updated = await invoke<McpToolRecord>("resolve_mcp_conflict", getMcpRegistryConflictResolutionPayload(conflictTool.id, action))
      updateToolList((prev) => upsertMcpTool(prev, mapTool(updated)))
      handleConflictOpenChange(false)
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "save", err))
    }
  }, [addNotification, conflictTool, handleConflictOpenChange, isTauri, mapTool, t, updateToolList])

  const handleToggleTool = useCallback(async (tool: MCPTool, enabled: boolean) => {
    const intent = getMcpToggleActionIntent(tool, enabled, isTauri ? "desktop" : "cloud")

    switch (intent) {
      case "toggle_remote_tool": {
        const resolution = resolveMcpRegistryRemoteToolToggle(tool, enabled)
        if (resolution.kind === "missing_server") {
          addNotification(getMcpRegistryErrorNotification(t, "save", t("toast.missingServer")))
          return
        }
        updateToolList((prev) => patchMcpRemoteToolToggle(prev, tool.id, enabled))
        try {
          const updated = await toolToggleMutation.trigger(resolution.payload)
          updateToolList((prev) => upsertMcpTool(prev, mapServerTool({ ...updated, server_id: resolution.payload.serverId })))
          await refreshTools()
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, enabled ? "start" : "stop", err))
          await refreshAll()
        }
        return
      }
      case "stop_tool":
        updateToolList((prev) => patchMcpToolStatus(prev, tool.id, "stopped", false))
        try {
          await invoke("stop_mcp_tool", { toolId: tool.id })
          await refreshAll()
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "stop", err))
          await refreshAll()
        }
        return
      case "blocked_install":
      case "blocked_runtime":
        addNotification(getMcpRegistryNotification(t, intent))
        return
      case "review":
        // Don't show logs on toggle, only notify the user
        addNotification(getMcpRegistryNotification(t, "review"))
        return
      case "enable_skill": {
        const resolution = resolveMcpRegistryEnableSkill(tool)
        if (resolution.kind === "missing_skill_id") {
          addNotification(getMcpRegistryNotification(t, "enable_skill_missing_id"))
          return
        }
        try {
          await invoke("enable_local_skill", { skillId: resolution.skillId })
          await refreshAll()
          addNotification(getMcpRegistryNotification(t, "enable_skill_success"))
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "enable_skill", err))
          await refreshAll()
        }
        return
      }
      case "start_tool":
        updateToolList((prev) => patchMcpToolStatus(prev, tool.id, "starting"))
        try {
          await invoke("start_mcp_tool", { toolId: tool.id })
          await refreshAll()
        } catch (err) {
          addNotification(getMcpRegistryErrorNotification(t, "start", err))
          await refreshAll()
        }
        return
    }
  }, [addNotification, isTauri, mapServerTool, refreshAll, refreshTools, t, toolToggleMutation, updateToolList])

  const handlePrimaryAction = useCallback(async (tool: MCPTool) => {
    const intent = getMcpPrimaryActionIntent(tool, isTauri ? "desktop" : "cloud")

    if (intent === "blocked_install" || intent === "blocked_runtime") {
      addNotification(getMcpRegistryNotification(t, intent))
      return
    }

    switch (intent) {
      case "review":
        if (isTauri) {
          handleShowLogs(tool)
        } else {
          handleOpenEditServer(tool)
        }
        return
      case "sync_server":
        await handleSyncServer(tool)
        return
      case "enable_server":
        await handleToggleServerEnabled(tool, true)
        return
      case "toggle_tool":
        await handleToggleTool(tool, true)
        return
    }
  }, [addNotification, handleOpenEditServer, handleShowLogs, handleSyncServer, handleToggleServerEnabled, handleToggleTool, isTauri, t])

  return {
    handleConflictOpenChange,
    handleDeleteTool,
    handleOpenConflict,
    handlePrimaryAction,
    handleResolveConflict,
    handleShowLogs,
    handleToggleTool,
  }
}
