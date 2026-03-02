import { request } from "@/lib/http"

const BASE = "/api/v1/internal/bridge/agent-tokens"

export interface BridgeAgentToken {
  agent_id: string
  version: number
  issued_at: string
  expires_at: string
}

export async function fetchBridgeAgentTokens(): Promise<BridgeAgentToken[]> {
  return request<BridgeAgentToken[]>({ url: BASE })
}

export async function revokeBridgeAgentToken(agentId: string): Promise<void> {
  await request({ url: `${BASE}/${agentId}`, method: "DELETE" })
}
