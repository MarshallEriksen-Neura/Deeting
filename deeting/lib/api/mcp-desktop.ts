"use client"

import { invoke } from "@tauri-apps/api/core"
import { resolveLocalGatewayBaseUrl } from "@/lib/api/chat"
import { openSSE, request } from "@/lib/http"

export const DESKTOP_MCP_COMMANDS = {
  listSources: "list_mcp_sources",
  createSource: "create_mcp_source",
  syncSource: "sync_mcp_source",
  listTools: "list_mcp_tools",
  reindexTool: "reindex_mcp_tool",
  deleteLocalTool: "delete_local_mcp_tool",
  importConfig: "import_mcp_config",
  startTool: "start_mcp_tool",
  stopTool: "stop_mcp_tool",
  executeToolRaw: "execute_mcp_tool_raw",
  listPendingApprovals: "list_pending_mcp_approvals",
  approveTool: "approve_mcp_tool",
  rejectTool: "reject_mcp_tool",
  recoverLocalChatExecution: "recover_local_chat_execution",
  resolveConflict: "resolve_mcp_conflict",
  getLogs: "get_mcp_logs",
  clearLogs: "clear_mcp_logs",
} as const

const LOCAL_GATEWAY_APPROVE_TOOL_PATH = "/v1/mcp/tool-approvals/approve"
const LOCAL_GATEWAY_REJECT_TOOL_PATH = "/v1/mcp/tool-approvals/reject"
const inFlightDesktopApprovalStreams = new Map<string, Promise<unknown>>()

export type DesktopMcpCommandName =
  (typeof DESKTOP_MCP_COMMANDS)[keyof typeof DESKTOP_MCP_COMMANDS]

export type DesktopToolApprovalRequest = {
  approvalToken: string
  approvalMode?: string
  callId?: string
  executionToken?: string
  executionGraphExecutionId?: string
  statusStream?: boolean
}

export type DesktopToolRejectRequest = {
  approvalToken: string
  rejectMode?: string
  executionGraphExecutionId?: string
}

export type DesktopLocalChatRecoveryRequest = {
  executionGraphExecutionId: string
  action: "continue" | "retry" | "abandon"
}

export async function streamDesktopApproveTool(
  payload: DesktopToolApprovalRequest,
  handlers: {
    onMessage?: (data: unknown) => void
  } = {}
): Promise<unknown> {
  const approvalToken = payload.approvalToken.trim()
  if (approvalToken) {
    const existing = inFlightDesktopApprovalStreams.get(approvalToken)
    if (existing) {
      return existing
    }
  }

  if (!approvalToken) {
    const baseUrl = await resolveLocalGatewayBaseUrl()
    const body = JSON.stringify({
      approval_token: approvalToken,
      approval_mode: payload.approvalMode,
      call_id: payload.callId,
      execution_token: payload.executionToken,
      execution_graph_execution_id: payload.executionGraphExecutionId,
      stream: true,
      status_stream: payload.statusStream ?? true,
    })

    let finalPayload: unknown = null
    let settled = false

    return await new Promise<unknown>((resolve, reject) => {
      let close = () => {}
      close = openSSE(`${baseUrl}${LOCAL_GATEWAY_APPROVE_TOOL_PATH}`, {
        method: "POST",
        body,
        credentials: "omit",
        includeAuthHeader: false,
        headers: {
          "Content-Type": "application/json",
        },
        onMessage: ({ data }) => {
          if (data === "[DONE]") {
            if (settled) return
            settled = true
            close()
            resolve(finalPayload)
            return
          }

          handlers.onMessage?.(data)

          if (data && typeof data === "object" && "type" in data) {
            const event = data as { type?: string; message?: string }
            if (event.type === "error") {
              if (settled) return
              settled = true
              close()
              reject(new Error(event.message || "Approval failed"))
            }
            return
          }

          finalPayload = data
        },
        onError: (error) => {
          if (settled) return
          settled = true
          reject(error)
        },
        onClose: () => {
          if (settled) return
          settled = true
          resolve(finalPayload)
        },
      })
    })
  }

  const streamPromise = (async () => {
    const baseUrl = await resolveLocalGatewayBaseUrl()
    const body = JSON.stringify({
      approval_token: approvalToken,
      approval_mode: payload.approvalMode,
      call_id: payload.callId,
      execution_token: payload.executionToken,
      execution_graph_execution_id: payload.executionGraphExecutionId,
      stream: true,
      status_stream: payload.statusStream ?? true,
    })

    let finalPayload: unknown = null
    let settled = false

    return await new Promise<unknown>((resolve, reject) => {
      let close = () => {}
      close = openSSE(`${baseUrl}${LOCAL_GATEWAY_APPROVE_TOOL_PATH}`, {
        method: "POST",
        body,
        credentials: "omit",
        includeAuthHeader: false,
        headers: {
          "Content-Type": "application/json",
        },
        onMessage: ({ data }) => {
          if (data === "[DONE]") {
            if (settled) return
            settled = true
            close()
            resolve(finalPayload)
            return
          }

          handlers.onMessage?.(data)

          if (data && typeof data === "object" && "type" in data) {
            const event = data as { type?: string; message?: string }
            if (event.type === "error") {
              if (settled) return
              settled = true
              close()
              reject(new Error(event.message || "Approval failed"))
            }
            return
          }

          finalPayload = data
        },
        onError: (error) => {
          if (settled) return
          settled = true
          reject(error)
        },
        onClose: () => {
          if (settled) return
          settled = true
          resolve(finalPayload)
        },
      })
    })
  })()

  inFlightDesktopApprovalStreams.set(approvalToken, streamPromise)
  try {
    return await streamPromise
  } finally {
    if (inFlightDesktopApprovalStreams.get(approvalToken) === streamPromise) {
      inFlightDesktopApprovalStreams.delete(approvalToken)
    }
  }
}

export async function rejectDesktopTool(payload: DesktopToolRejectRequest) {
  const baseUrl = await resolveLocalGatewayBaseUrl()
  return request<unknown>({
    url: `${baseUrl}${LOCAL_GATEWAY_REJECT_TOOL_PATH}`,
    method: "POST",
    data: {
      approval_token: payload.approvalToken,
      reject_mode: payload.rejectMode,
      execution_graph_execution_id: payload.executionGraphExecutionId,
    },
    anonymous: true,
  })
}

export async function recoverDesktopLocalChatExecution(
  payload: DesktopLocalChatRecoveryRequest
) {
  return invoke<unknown>(DESKTOP_MCP_COMMANDS.recoverLocalChatExecution, {
    executionGraphExecutionId: payload.executionGraphExecutionId,
    action: payload.action,
  })
}
