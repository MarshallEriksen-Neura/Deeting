import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop";
import { mapMcpSourceRecordToSource } from "@/lib/mcp/registry-mappers";
import type { MCPLogEntry, MCPSource, MCPTool, McpSourceRecord, McpToolRecord } from "@/types/mcp";

export const MCP_TOOL_INDEX_PROGRESS_EVENT = "mcp-tool-index-progress";

export interface McpToolIndexProgressEvent {
  phase: string;
  total: number;
  processed: number;
  indexed: number;
  failed: number;
  current?: string | null;
}

export const appendMcpRegistryLogEntry = (
  existing: MCPLogEntry[],
  entry: MCPLogEntry,
  maxLogLines: number
): MCPLogEntry[] =>
  existing.length >= maxLogLines
    ? [...existing.slice(existing.length - maxLogLines + 1), entry]
    : [...existing, entry];

export const clearMcpRegistryToolLogs = (
  logsByTool: Record<string, MCPLogEntry[]>,
  toolId: string
): Record<string, MCPLogEntry[]> => ({
  ...logsByTool,
  [toolId]: [],
});

export const getNextMcpRegistrySelectedTool = (
  tools: MCPTool[],
  selectedTool: MCPTool | null
): MCPTool | null => {
  if (!selectedTool) return null;
  return tools.find((tool) => tool.id === selectedTool.id) ?? selectedTool;
};

export const useMcpRegistryRefreshAll = ({
  setSources,
  setTools,
  mapTool,
  onLoadError,
}: {
  setSources: Dispatch<SetStateAction<MCPSource[]>>;
  setTools: Dispatch<SetStateAction<MCPTool[]>>;
  mapTool: (tool: McpToolRecord) => MCPTool;
  onLoadError: (error: unknown) => void;
}) =>
  useCallback(async () => {
    try {
      const [sourceRecords, toolRecords] = await Promise.all([
        invoke<McpSourceRecord[]>(DESKTOP_MCP_COMMANDS.listSources),
        invoke<McpToolRecord[]>(DESKTOP_MCP_COMMANDS.listTools),
      ]);
      setSources(sourceRecords.map(mapMcpSourceRecordToSource));
      setTools(toolRecords.map(mapTool));
    } catch (error) {
      onLoadError(error);
    }
  }, [mapTool, onLoadError, setSources, setTools]);

export const useMcpRegistryHydration = ({
  tools,
  selectedTool,
  setSelectedTool,
  refreshAll,
}: {
  tools: MCPTool[];
  selectedTool: MCPTool | null;
  setSelectedTool: Dispatch<SetStateAction<MCPTool | null>>;
  refreshAll: () => Promise<void>;
}) => {
  const initialRefreshRef = useRef(false);

  useEffect(() => {
    if (initialRefreshRef.current) return;
    initialRefreshRef.current = true;
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const updatedTool = getNextMcpRegistrySelectedTool(tools, selectedTool);
    if (updatedTool && updatedTool !== selectedTool) {
      setSelectedTool(updatedTool);
    }
  }, [selectedTool, setSelectedTool, tools]);
};

export const useMcpRegistryClearLogsAction = ({
  setLogsByTool,
}: {
  setLogsByTool: Dispatch<SetStateAction<Record<string, MCPLogEntry[]>>>;
}) =>
  useCallback(
    async (tool: Pick<MCPTool, "id">) => {
      await invoke(DESKTOP_MCP_COMMANDS.clearLogs, { toolId: tool.id });
      setLogsByTool((prev) => clearMcpRegistryToolLogs(prev, tool.id));
    },
    [setLogsByTool]
  );

export const useMcpRegistryToolLogs = ({
  logsOpen,
  selectedToolId,
  setLogsByTool,
  onLoadError,
  maxLogLines,
}: {
  logsOpen: boolean;
  selectedToolId: string | null;
  setLogsByTool: Dispatch<SetStateAction<Record<string, MCPLogEntry[]>>>;
  onLoadError: (error: unknown) => void;
  maxLogLines: number;
}) => {
  const logListeners = useRef<Record<string, UnlistenFn>>({});

  const pushLog = useCallback(
    (toolId: string, entry: MCPLogEntry) => {
      setLogsByTool((prev) => {
        const existing = prev[toolId] || [];
        return {
          ...prev,
          [toolId]: appendMcpRegistryLogEntry(existing, entry, maxLogLines),
        };
      });
    },
    [maxLogLines, setLogsByTool]
  );

  useEffect(() => {
    if (!logsOpen || !selectedToolId) {
      return;
    }

    let active = true;
    const listeners = logListeners.current;

    const setup = async () => {
      try {
        const entries = await invoke<MCPLogEntry[]>(DESKTOP_MCP_COMMANDS.getLogs, {
          toolId: selectedToolId,
        });
        if (active) {
          setLogsByTool((prev) => ({ ...prev, [selectedToolId]: entries }));
        }
        if (!listeners[selectedToolId]) {
          const unlisten = await listen<MCPLogEntry>(`mcp-log://${selectedToolId}`, (event) => {
            pushLog(selectedToolId, event.payload);
          });
          listeners[selectedToolId] = unlisten;
        }
      } catch (error) {
        onLoadError(error);
      }
    };

    void setup();

    return () => {
      active = false;
      const unlisten = listeners[selectedToolId];
      if (unlisten) {
        unlisten();
        delete listeners[selectedToolId];
      }
    };
  }, [logsOpen, onLoadError, pushLog, selectedToolId, setLogsByTool]);
};

export const useMcpRegistryIndexProgress = ({
  onProgress,
  onCompleted,
}: {
  onProgress: (payload: McpToolIndexProgressEvent) => void;
  onCompleted?: (payload: McpToolIndexProgressEvent) => void;
}) => {
  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<McpToolIndexProgressEvent>(
        MCP_TOOL_INDEX_PROGRESS_EVENT,
        (event) => {
          if (!active) {
            return;
          }
          onProgress(event.payload);
          if (event.payload.phase === "completed") {
            onCompleted?.(event.payload);
          }
        }
      );
    };

    void setup();

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [onCompleted, onProgress]);
};
