"use client"

import { useCallback } from "react"
import useSWR from "swr"

import {
  fetchBridgeAgentTokens,
  revokeBridgeAgentToken,
  type BridgeAgentToken,
} from "@/lib/api/bridge-agent-tokens"
import { useAuthStore } from "@/store/auth-store"
import { useShallow } from "zustand/react/shallow"

const SWR_KEY = "/api/v1/internal/bridge/agent-tokens"

export function useBridgeAgentTokens() {
  const isAuthenticated = useAuthStore(useShallow((state) => state.isAuthenticated))

  const { data, error, isLoading, mutate } = useSWR<BridgeAgentToken[]>(
    isAuthenticated ? SWR_KEY : null,
    () => fetchBridgeAgentTokens(),
    { revalidateOnFocus: true },
  )

  const revoke = useCallback(
    async (agentId: string) => {
      await revokeBridgeAgentToken(agentId)
      await mutate()
    },
    [mutate],
  )

  return {
    tokens: data ?? [],
    isLoading,
    error,
    mutate,
    revoke,
  }
}
