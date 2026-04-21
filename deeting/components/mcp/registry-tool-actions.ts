import { useCallback, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop";
import { patchMcpToolStatus, upsertMcpTool } from "@/lib/mcp/registry-patches";
import type { MCPTool, McpToolRecord } from "@/types/mcp";
import { getMcpPrimaryActionIntent, getMcpToggleActionIntent } from "./tool-semantics";
import { getMcpRegistryErrorNotification, getMcpRegistryNotification } from "./registry-notifications";

type McpTranslate = (key: string, values?: Record<string, string | number>) => string;
type McpRegistryAddNotification = (
  notification: ReturnType<typeof getMcpRegistryNotification>
) => void;
type McpRegistryConflictAction = "keep" | "update";

type McpRegistryEnableSkillResolution =
  | { kind: "missing_skill_id" }
  | { kind: "ok"; skillId: string };

interface UseMcpRegistryToolActionsOptions {
  t: McpTranslate;
  addNotification: McpRegistryAddNotification;
  conflictTool: MCPTool | null;
  refreshAll: () => Promise<void>;
  mapTool: (tool: McpToolRecord) => MCPTool;
  updateToolList: (updater: (tools: MCPTool[]) => MCPTool[]) => void;
  setSelectedTool: Dispatch<SetStateAction<MCPTool | null>>;
  setLogsOpen: Dispatch<SetStateAction<boolean>>;
  setConflictTool: Dispatch<SetStateAction<MCPTool | null>>;
  setConflictOpen: Dispatch<SetStateAction<boolean>>;
}

export const resolveMcpRegistryEnableSkill = (
  tool: Pick<MCPTool, "backingSkillId">
): McpRegistryEnableSkillResolution =>
  tool.backingSkillId
    ? { kind: "ok", skillId: tool.backingSkillId }
    : { kind: "missing_skill_id" };

export const getMcpRegistryConflictResolutionPayload = (
  toolId: string,
  action: McpRegistryConflictAction
) => ({ tool_id: toolId, payload: { action } });

export function useMcpRegistryToolActions({
  t,
  addNotification,
  conflictTool,
  refreshAll,
  mapTool,
  updateToolList,
  setSelectedTool,
  setLogsOpen,
  setConflictTool,
  setConflictOpen,
}: UseMcpRegistryToolActionsOptions) {
  const handleShowLogs = useCallback(
    (tool: MCPTool) => {
      setSelectedTool(tool);
      setLogsOpen(true);
    },
    [setLogsOpen, setSelectedTool]
  );

  const handleConflictOpenChange = useCallback(
    (nextOpen: boolean) => {
      setConflictOpen(nextOpen);
      if (!nextOpen) {
        setConflictTool(null);
      }
    },
    [setConflictOpen, setConflictTool]
  );

  const handleDeleteTool = useCallback(
    async (tool: MCPTool) => {
      try {
        await invoke(DESKTOP_MCP_COMMANDS.deleteLocalTool, { toolId: tool.id });
        await refreshAll();
        addNotification(getMcpRegistryNotification(t, "delete_success"));
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "delete", err));
        await refreshAll();
      }
    },
    [addNotification, refreshAll, t]
  );

  const handleOpenConflict = useCallback(
    (tool: MCPTool) => {
      setConflictTool(tool);
      setConflictOpen(true);
    },
    [setConflictOpen, setConflictTool]
  );

  const handleResolveConflict = useCallback(
    async (action: McpRegistryConflictAction) => {
      if (!conflictTool) {
        return;
      }

      try {
        const updated = await invoke<McpToolRecord>(
          DESKTOP_MCP_COMMANDS.resolveConflict,
          getMcpRegistryConflictResolutionPayload(conflictTool.id, action)
        );
        updateToolList((prev) => upsertMcpTool(prev, mapTool(updated)));
        handleConflictOpenChange(false);
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "save", err));
      }
    },
    [
      addNotification,
      conflictTool,
      handleConflictOpenChange,
      mapTool,
      t,
      updateToolList,
    ]
  );

  const handleToggleTool = useCallback(
    async (tool: MCPTool, enabled: boolean) => {
      const intent = getMcpToggleActionIntent(tool, enabled, "desktop");

      switch (intent) {
        case "stop_tool":
          updateToolList((prev) => patchMcpToolStatus(prev, tool.id, "stopped", false));
          try {
            await invoke(DESKTOP_MCP_COMMANDS.stopTool, { toolId: tool.id });
            await refreshAll();
          } catch (err) {
            addNotification(getMcpRegistryErrorNotification(t, "stop", err));
            await refreshAll();
          }
          return;
        case "blocked_install":
        case "blocked_runtime":
          addNotification(getMcpRegistryNotification(t, intent));
          return;
        case "review":
          addNotification(getMcpRegistryNotification(t, "review"));
          return;
        case "enable_skill": {
          const resolution = resolveMcpRegistryEnableSkill(tool);
          if (resolution.kind === "missing_skill_id") {
            addNotification(getMcpRegistryNotification(t, "enable_skill_missing_id"));
            return;
          }
          try {
            await invoke("enable_local_skill", { skillId: resolution.skillId });
            await refreshAll();
            addNotification(getMcpRegistryNotification(t, "enable_skill_success"));
          } catch (err) {
            addNotification(getMcpRegistryErrorNotification(t, "enable_skill", err));
            await refreshAll();
          }
          return;
        }
        case "start_tool":
          updateToolList((prev) => patchMcpToolStatus(prev, tool.id, "starting"));
          try {
            await invoke(DESKTOP_MCP_COMMANDS.startTool, { toolId: tool.id });
            await refreshAll();
          } catch (err) {
            addNotification(getMcpRegistryErrorNotification(t, "start", err));
            await refreshAll();
          }
          return;
        default:
          return;
      }
    },
    [addNotification, refreshAll, t, updateToolList]
  );

  const handlePrimaryAction = useCallback(
    async (tool: MCPTool) => {
      const intent = getMcpPrimaryActionIntent(tool, "desktop");

      if (intent === "blocked_install" || intent === "blocked_runtime") {
        addNotification(getMcpRegistryNotification(t, intent));
        return;
      }

      switch (intent) {
        case "review":
          handleShowLogs(tool);
          return;
        case "toggle_tool":
          await handleToggleTool(tool, true);
          return;
        default:
          return;
      }
    },
    [addNotification, handleShowLogs, handleToggleTool, t]
  );

  return {
    handleConflictOpenChange,
    handleDeleteTool,
    handleOpenConflict,
    handlePrimaryAction,
    handleResolveConflict,
    handleShowLogs,
    handleToggleTool,
  };
}
