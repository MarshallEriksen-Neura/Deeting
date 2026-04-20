"use client"

import { useEffect, useRef } from "react"
import { useAuthStore } from "@/store/auth-store"
import { subscribeBridgeEvents, bridgeCallTool } from "@/lib/api/bridge"
import { invoke } from "@tauri-apps/api/core"
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop"
import {
  buildBridgeToolApprovalFromResult,
  enqueueBridgeToolApproval,
} from "@/lib/chat/tool-approval"

type BridgeToolCallRequestPayload = {
  type: string
  call_id?: string
  tool_id?: string
  tool_name?: string
  arguments?: Record<string, unknown>
  execution_token?: string
}

/**
 * Bridge Monitor Hook
 * Listens for remote tool execution requests from the cloud and executes them locally.
 * Includes Security Interception for high-risk tools.
 */
export function useBridgeMonitor() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      return
    }

    console.log("[BridgeMonitor] Starting subscription...")

    const disconnect = subscribeBridgeEvents({
      onMessage: async (data) => {
        try {
          const payload: BridgeToolCallRequestPayload =
            typeof data === "string" ? JSON.parse(data) : (data as BridgeToolCallRequestPayload)
          
          if (payload.type === "TOOL_CALL_REQUEST") {
            const call_id = payload.call_id ?? ""
            const tool_id = payload.tool_id
            const tool_name = payload.tool_name ?? ""
            const toolArgs = payload.arguments ?? {}
            const execution_token = payload.execution_token
            
            console.log(`[BridgeMonitor] Received tool call: ${tool_name}`, toolArgs)
            
            let result: unknown
            let ok = true

            try {
              if (tool_name === "search_local_memories") {
                const query = (toolArgs.query as string) || ""
                const limit = Number(toolArgs.limit ?? 5) || 5
                const memories = await invoke<Array<{ content?: string; score?: number; metadata?: unknown }>>(
                  "list_local_memories",
                  { query, limit }
                )
                result = memories.map((m) => ({
                  content: m.content,
                  score: m.score,
                  metadata: m.metadata,
                }))
              } else {
                // 1. Initial attempt to execute
                const executionResult = await invoke<Record<string, unknown>>(
                  DESKTOP_MCP_COMMANDS.executeToolRaw,
                  {
                    toolId: tool_id,
                    toolName: tool_name,
                    arguments: toolArgs,
                    callId: call_id,
                    executionToken: execution_token,
                  }
                )

                // 2. SECURITY INTERCEPT: If high-risk, wait for user
                const pendingApproval = buildBridgeToolApprovalFromResult(executionResult, {
                  tool_id,
                  tool_name,
                  arguments: toolArgs,
                  meta: { call_id, execution_token },
                })
                if (pendingApproval) {
                  console.log("[BridgeMonitor] High-risk tool intercepted, awaiting approval")
                  enqueueBridgeToolApproval(pendingApproval)
                  return // Stop here, Dialog will resume
                }

                result = executionResult
              }
            } catch (err: unknown) {
              console.error(`[BridgeMonitor] Execution failed:`, err)
              result = { error: err instanceof Error ? err.message : String(err) }
              ok = false
            }

            // 3. Normal return for low-risk or search tools
            await bridgeCallTool({
              tool_name,
              arguments: { call_id, result, ok },
              execution_token
            })
          }
          
          if (payload.type === "PING") {
            console.debug("[BridgeMonitor] Pong")
          }

        } catch (err) {
          console.error("[BridgeMonitor] Error parsing message:", err)
        }
      },
      onError: (err) => {
        console.error("[BridgeMonitor] SSE Error:", err)
      }
    })

    unsubscribeRef.current = disconnect

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [isAuthenticated])
}
