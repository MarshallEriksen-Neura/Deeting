"use client"

import { useCallback } from "react"
import useSWR from "swr"

import {
  fetchLoginSessions,
  revokeLoginSession,
  type LoginSessionItem,
} from "@/lib/api/login-sessions"
import { useAuthStore } from "@/store/auth-store"
import { useShallow } from "zustand/react/shallow"

const SWR_KEY = "/api/v1/login-sessions"

export function useLoginSessions() {
  const isAuthenticated = useAuthStore(useShallow((state) => state.isAuthenticated))

  const { data, error, isLoading, mutate } = useSWR<LoginSessionItem[]>(
    isAuthenticated ? SWR_KEY : null,
    () => fetchLoginSessions(),
    { revalidateOnFocus: true },
  )

  const revoke = useCallback(
    async (sessionId: string) => {
      await revokeLoginSession(sessionId)
      await mutate()
    },
    [mutate],
  )

  return {
    sessions: data ?? [],
    isLoading,
    error,
    mutate,
    revoke,
  }
}
