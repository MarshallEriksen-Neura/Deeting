import { useCallback, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { Dispatch, SetStateAction } from "react"
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop"
import { mapMcpSourceRecordToSource } from "@/lib/mcp/registry-mappers"
import type { McpServerToolRecord } from "@/lib/swr/use-mcp-tools"
import type { MCPLogEntry, MCPSource, MCPTool, McpSourceRecord, McpToolRecord } from "@/types/mcp"

export const MCP_TOOL_INDEX_PROGRESS_EVENT = "mcp-tool-index-progress"

export interface McpToolIndexProgressEvent {
  phase: string
  total: number
  processed: number
  indexed: number
  failed: number
  current?: string | null
}

export const appendMcpRegistryLogEntry = (
  existing: MCPLogEntry[],
  entry: MCPLogEntry,
  maxLogLines: number
): MCPLogEntry[] => {
  return existing.length >= maxLogLines
    ? [...existing.slice(existing.length - maxLogLines + 1), entry]
    : [...existing, entry]
}

export const clearMcpRegistryToolLogs = (
  logsByTool: Record<string, MCPLogEntry[]>,
  toolId: string
): Record<string, MCPLogEntry[]> => ({
  ...logsByTool,
  [toolId]: [],
})

export const getNextMcpRegistrySelectedTool = (
  tools: MCPTool[],
  selectedTool: MCPTool | null
): MCPTool | null => {
  if (!selectedTool) return null
  return tools.find((tool) => tool.id === selectedTool.id) ?? selectedTool
}

export const useMcpRegistryLoadErrorEffect = ({
  isTauri,
  error,
  onError,
}: {
  isTauri: boolean
  error: unknown
  onError: (error: unknown) => void
}) => {
  useEffect(() => {
    if (isTauri || !error) return
    onError(error)
  }, [error, isTauri, onError])
}

export const useMcpRegistryRefreshAll = ({
  isTauri,
  refreshSources,
  refreshServers,
  refreshTools,
  setSources,
  setTools,
  mapTool,
  onLoadError,
}: {
  isTauri: boolean
  refreshSources: () => void
  refreshServers: () => void
  refreshTools: () => Promise<unknown>
  setSources: Dispatch<SetStateAction<MCPSource[]>>
  setTools: Dispatch<SetStateAction<MCPTool[]>>
  mapTool: (tool: McpToolRecord) => MCPTool
  onLoadError: (error: unknown) => void
}) => {
  return useCallback(async () => {
    if (!isTauri) {
      refreshSources()
      refreshServers()
      await refreshTools()
      return
    }

    try {
      const [sourceRecords, toolRecords] = await Promise.all([
        invoke<McpSourceRecord[]>(DESKTOP_MCP_COMMANDS.listSources),
        invoke<McpToolRecord[]>(DESKTOP_MCP_COMMANDS.listTools),
      ])
      setSources(sourceRecords.map(mapMcpSourceRecordToSource))
      setTools(toolRecords.map(mapTool))
    } catch (error) {
      onLoadError(error)
    }
  }, [isTauri, mapTool, onLoadError, refreshServers, refreshSources, refreshTools, setSources, setTools])
}

export const useMcpRegistryHydration = ({
  isTauri,
  sourceRecords,
  toolRecords,
  mapServerTool,
  tools,
  selectedTool,
  setSources,
  setTools,
  setSelectedTool,
  refreshAll,
}: {
  isTauri: boolean
  sourceRecords: McpSourceRecord[] | undefined
  toolRecords: McpServerToolRecord[] | undefined
  mapServerTool: (tool: McpServerToolRecord) => MCPTool
  tools: MCPTool[]
  selectedTool: MCPTool | null
  setSources: Dispatch<SetStateAction<MCPSource[]>>
  setTools: Dispatch<SetStateAction<MCPTool[]>>
  setSelectedTool: Dispatch<SetStateAction<MCPTool | null>>
  refreshAll: () => Promise<void>
}) => {
  const initialRefreshRef = useRef(false)

  useEffect(() => {
    if (initialRefreshRef.current) return
    initialRefreshRef.current = true
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (isTauri || !sourceRecords) return
    setSources(sourceRecords.map(mapMcpSourceRecordToSource))
  }, [isTauri, setSources, sourceRecords])

  useEffect(() => {
    if (isTauri || !toolRecords) return
    setTools(toolRecords.map(mapServerTool))
  }, [isTauri, mapServerTool, setTools, toolRecords])

  useEffect(() => {
    const updatedTool = getNextMcpRegistrySelectedTool(tools, selectedTool)
    if (updatedTool && updatedTool !== selectedTool) {
      setSelectedTool(updatedTool)
    }
  }, [selectedTool, setSelectedTool, tools])
}

export const useMcpRegistryClearLogsAction = ({
  isTauri,
  setLogsByTool,
}: {
  isTauri: boolean
  setLogsByTool: Dispatch<SetStateAction<Record<string, MCPLogEntry[]>>>
}) => {
  return useCallback(async (tool: Pick<MCPTool, "id">) => {
    if (!isTauri) return
    await invoke(DESKTOP_MCP_COMMANDS.clearLogs, { toolId: tool.id })
    setLogsByTool((prev) => clearMcpRegistryToolLogs(prev, tool.id))
  }, [isTauri, setLogsByTool])
}

export const useMcpRegistryToolLogs = ({
  isTauri,
  logsOpen,
  selectedToolId,
  setLogsByTool,
  onLoadError,
  maxLogLines,
}: {
  isTauri: boolean
  logsOpen: boolean
  selectedToolId: string | null
  setLogsByTool: Dispatch<SetStateAction<Record<string, MCPLogEntry[]>>>
  onLoadError: (error: unknown) => void
  maxLogLines: number
}) => {
  const logListeners = useRef<Record<string, UnlistenFn>>({})

  const pushLog = useCallback((toolId: string, entry: MCPLogEntry) => {
    setLogsByTool((prev) => {
      const existing = prev[toolId] || []
      return {
        ...prev,
        [toolId]: appendMcpRegistryLogEntry(existing, entry, maxLogLines),
      }
    })
  }, [maxLogLines, setLogsByTool])

  useEffect(() => {
    if (!isTauri || !logsOpen || !selectedToolId) {
      return
    }

    let active = true
    const listeners = logListeners.current

    const setup = async () => {
      try {
        const entries = await invoke<MCPLogEntry[]>(DESKTOP_MCP_COMMANDS.getLogs, {
          toolId: selectedToolId,
        })
        if (active) {
          setLogsByTool((prev) => ({ ...prev, [selectedToolId]: entries }))
        }
        if (!listeners[selectedToolId]) {
          const unlisten = await listen<MCPLogEntry>(`mcp-log://${selectedToolId}`, (event) => {
            pushLog(selectedToolId, event.payload)
          })
          listeners[selectedToolId] = unlisten
        }
      } catch (error) {
        onLoadError(error)
      }
    }

    void setup()

    return () => {
      active = false
      const unlisten = listeners[selectedToolId]
      if (unlisten) {
        unlisten()
        delete listeners[selectedToolId]
      }
    }
  }, [isTauri, logsOpen, onLoadError, pushLog, selectedToolId, setLogsByTool])
}

export const useMcpRegistryIndexProgress = ({
  isTauri,
  onProgress,
  onCompleted,
}: {
  isTauri: boolean
  onProgress: (payload: McpToolIndexProgressEvent) => void
  onCompleted?: (payload: McpToolIndexProgressEvent) => void
}) => {
  useEffect(() => {
    if (!isTauri) {
      return
    }

    let active = true
    let unlisten: UnlistenFn | null = null

    const setup = async () => {
      unlisten = await listen<McpToolIndexProgressEvent>(MCP_TOOL_INDEX_PROGRESS_EVENT, (event) => {
        if (!active) {
          return
        }
        onProgress(event.payload)
        if (event.payload.phase === "completed") {
          onCompleted?.(event.payload)
        }
      })
    }

    void setup()

    return () => {
      active = false
      if (unlisten) {
        unlisten()
      }
    }
  }, [isTauri, onCompleted, onProgress])
}
