import { openApiSSE, request } from "@/lib/http"

const BASE = "/api/v1/internal/bridge"

/**
 * Bridge Agent Token Types
 */
export interface BridgeAgentToken {
  agent_id: string
  version: number
  issued_at: string
  expires_at: string
}

export interface IssueTokenResponse {
  agent_id: string
  token: string
  expires_at: string
  version: number
  reset: boolean
}

/**
 * Code Mode Bridge Types
 */
export interface BridgeCallRequest {
  tool_name: string
  arguments: Record<string, any>
  execution_token?: string
}

export interface BridgeCallResponse {
  ok: boolean
  result: any
  meta: {
    call_index: number
    max_calls: number
    trace_id: string
    session_id: string
  }
}

export interface BridgeFileRef {
  id: string
  name: string
  content_type: string
  size: number
}

/**
 * 1. Agent Token Management
 */
export async function fetchBridgeAgentTokens(): Promise<BridgeAgentToken[]> {
  return request<BridgeAgentToken[]>({ url: `${BASE}/agent-tokens` })
}

export async function issueBridgeAgentToken(payload: {
  agent_id?: string
  reset?: boolean
}): Promise<IssueTokenResponse> {
  return request<IssueTokenResponse>({
    url: `${BASE}/agent-token`,
    method: "POST",
    data: payload,
  })
}

export async function revokeBridgeAgentToken(agentId: string): Promise<void> {
  await request({ url: `${BASE}/agent-tokens/${agentId}`, method: "DELETE" })
}

/**
 * 2. Code Mode Runtime Bridge (for Sandbox -> Host calls)
 */
export async function bridgeCallTool(
  payload: BridgeCallRequest
): Promise<BridgeCallResponse> {
  return request<BridgeCallResponse>({
    url: `${BASE}/call`,
    method: "POST",
    data: payload,
  })
}

export async function bridgeGetContext(payload: {
  execution_token?: string
}): Promise<{ ok: boolean; context: any }> {
  return request<{ ok: boolean; context: any }>({
    url: `${BASE}/context`,
    method: "POST",
    data: payload,
  })
}

export async function bridgeWriteFile(payload: {
  name: string
  content_base64: string
  content_type?: string
  execution_token?: string
}): Promise<{ ok: boolean; file_ref: BridgeFileRef }> {
  return request<{ ok: boolean; file_ref: BridgeFileRef }>({
    url: `${BASE}/file/write`,
    method: "POST",
    data: payload,
  })
}

export async function bridgeReadFile(payload: {
  ref_id: string
  execution_token?: string
}): Promise<{ ok: boolean; file_ref: BridgeFileRef; content_base64: string }> {
  return request<{ ok: boolean; file_ref: BridgeFileRef; content_base64: string }>({
    url: `${BASE}/file/read`,
    method: "POST",
    data: payload,
  })
}

/**
 * 3. Cloud Tunnel Bridge (invoke/cancel/events)
 */
export async function bridgeInvokeTool(payload: {
  agent_id: string
  tool_name: string
  arguments?: Record<string, any>
  req_id?: string
  timeout_ms?: number
  stream?: boolean
}): Promise<any> {
  return request<any>({
    url: `${BASE}/invoke`,
    method: "POST",
    data: payload,
  })
}

export async function bridgeCancelTool(payload: {
  agent_id: string
  req_id: string
  reason?: string
}): Promise<any> {
  return request<any>({
    url: `${BASE}/cancel`,
    method: "POST",
    data: payload,
  })
}

/**
 * SSE Event stream from bridge gateway
 */
export function subscribeBridgeEvents(handlers: {
  onMessage?: (data: any) => void
  onError?: (error: any) => void
}) {
  return openApiSSE(`${BASE}/events`, {
    onMessage: (ev) => handlers.onMessage?.(ev.data),
    onError: handlers.onError,
  })
}
