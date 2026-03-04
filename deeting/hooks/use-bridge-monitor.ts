"use client"

import { useEffect, useRef } from "react"
import { useAuthStore } from "@/store/auth-store"
import { subscribeBridgeEvents, bridgeCallTool } from "@/lib/api/bridge"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"

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
          const payload = typeof data === "string" ? JSON.parse(data) : data
          
          if (payload.type === "TOOL_CALL_REQUEST") {
            const { call_id, tool_name, arguments: toolArgs, execution_token } = payload
            
            console.log(`[BridgeMonitor] Received tool call: ${tool_name}`, toolArgs)
            
            let result: any
            let ok = true

            try {
              if (tool_name === "search_local_memories") {
                const query = toolArgs.query || ""
                const limit = toolArgs.limit || 5
                const memories: any[] = await invoke("list_local_memories", { query, limit })
                result = memories.map(m => ({ content: m.content, score: m.score, metadata: m.metadata }))
              } else {
                // 1. Initial attempt to execute
                const executionResult: any = await invoke("execute_mcp_tool_raw", {
                  toolName: tool_name,
                  arguments: toolArgs
                })

                // 2. SECURITY INTERCEPT: If high-risk, wait for user
                if (executionResult?.status === "REQUIRES_APPROVAL") {
                  console.log("[BridgeMonitor] High-risk tool intercepted, awaiting approval")
                  
                  useBridgeApprovalStore.getState().setPending({
                    approval_token: executionResult.approval_token,
                    tool_name: executionResult.tool_name,
                    arguments: executionResult.arguments,
                    description: executionResult.description,
                    // Pass these through so the Dialog component can finish the Bridge call
                    meta: { call_id, execution_token } as any 
                  })
                  return // Stop here, Dialog will resume
                }

                result = executionResult
              }
            } catch (err: any) {
              console.error(`[BridgeMonitor] Execution failed:`, err)
              result = { error: err.toString() }
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
