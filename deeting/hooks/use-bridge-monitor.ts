"use client"

import { useEffect, useRef } from "react"
import { useAuthStore } from "@/store/auth-store"
import { subscribeBridgeEvents, bridgeCallTool } from "@/lib/api/bridge"
import { invoke } from "@tauri-apps/api/core"
import {
  createBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"

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
                const executionResult = await invoke<Record<string, unknown>>("execute_mcp_tool_raw", {
                  toolId: tool_id,
                  toolName: tool_name,
                  arguments: toolArgs,
                  callId: call_id,
                  executionToken: execution_token,
                })

                // 2. SECURITY INTERCEPT: If high-risk, wait for user
                if (executionResult.status === "REQUIRES_APPROVAL") {
                  console.log("[BridgeMonitor] High-risk tool intercepted, awaiting approval")
                  const approvalToken =
                    typeof executionResult.approval_token === "string"
                      ? executionResult.approval_token
                      : ""
                  if (!approvalToken) {
                    throw new Error("missing approval token in approval-required response")
                  }
                  useBridgeApprovalStore.getState().setPending(createBridgeToolApproval({
                    approval_token: approvalToken,
                    tool_id:
                      typeof executionResult.tool_id === "string"
                        ? executionResult.tool_id
                        : tool_id,
                    tool_name:
                      typeof executionResult.tool_name === "string"
                        ? executionResult.tool_name
                        : tool_name,
                    arguments:
                      (executionResult.arguments as Record<string, unknown> | undefined) ??
                      toolArgs,
                    description:
                      typeof executionResult.description === "string"
                        ? executionResult.description
                        : undefined,
                    risk_level:
                      typeof executionResult.risk_level === "string"
                        ? executionResult.risk_level
                        : undefined,
                    risk_reasons: Array.isArray(executionResult.risk_reasons)
                      ? executionResult.risk_reasons.filter(
                          (v): v is string => typeof v === "string"
                        )
                      : undefined,
                    expires_in_ms:
                      typeof executionResult.expires_in_ms === "number"
                        ? executionResult.expires_in_ms
                        : undefined,
                    // Pass these through so the Dialog component can finish the Bridge call
                    meta: { call_id, execution_token },
                  }))
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
