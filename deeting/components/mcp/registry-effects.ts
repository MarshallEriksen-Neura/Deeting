import { useCallback, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { Dispatch, SetStateAction } from "react"
import type { MCPLogEntry } from "@/types/mcp"

export const appendMcpRegistryLogEntry = (
  existing: MCPLogEntry[],
  entry: MCPLogEntry,
  maxLogLines: number
): MCPLogEntry[] => {
  return existing.length >= maxLogLines
    ? [...existing.slice(existing.length - maxLogLines + 1), entry]
    : [...existing, entry]
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
        const entries = await invoke<MCPLogEntry[]>("get_mcp_logs", { toolId: selectedToolId })
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