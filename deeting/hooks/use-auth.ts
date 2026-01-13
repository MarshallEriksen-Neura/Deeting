"use client"

import { useCallback } from "react"
import { create } from "zustand"
import useSWRMutation from "swr/mutation"
import { useAuthStore } from "@/store/auth-store"
import {
  type LoginWithCodeRequest,
  type SendLoginCodeRequest,
  type TokenPair,
} from "@/lib/api/auth"
import { authService } from "@/lib/api/auth.service"
import { ApiError, clearAuthToken } from "@/lib/http"

type SendCodeVariables = SendLoginCodeRequest
type VerifyVariables = LoginWithCodeRequest

interface AuthServiceState {
  /** 最近一次认证成功的 token 对 */
  lastTokenPair: TokenPair | null
}

interface AuthServiceActions {
  setTokenPair: (tokens: TokenPair | null) => void
}

type AuthServiceStore = AuthServiceState & AuthServiceActions

const useAuthServiceStore = create<AuthServiceStore>((set) => ({
  lastTokenPair: null,
  setTokenPair: (tokens) => set({ lastTokenPair: tokens }),
}))

export function useAuthService() {
  const { setSession, clearSession } = useAuthStore()
  const { lastTokenPair, setTokenPair } = useAuthServiceStore()

  const applySession = useCallback(
    (tokens: TokenPair) => {
      setTokenPair(tokens)
      setSession({ accessToken: tokens.access_token, tokenType: tokens.token_type })
    },
    [setSession, setTokenPair]
  )

  const sendCodeMutation = useSWRMutation(
    ["auth/send-code"],
    (_key, { arg }: { arg: SendCodeVariables }) => authService.sendCode(arg)
  )

  const verifyCodeMutation = useSWRMutation(
    ["auth/verify"],
    async (_key, { arg }: { arg: VerifyVariables }) => {
      const tokens = await authService.verifyCode(arg)
      applySession(tokens)
      return tokens
    }
  )

  const refreshMutation = useSWRMutation(["auth/refresh"], async () => {
    const tokens = await authService.refresh()
    applySession(tokens)
    return tokens
  })

  const logout = useCallback(async () => {
    clearSession()
    setTokenPair(null)
    clearAuthToken()
  }, [clearSession, setTokenPair])

  return {
    sendCodeMutation,
    verifyCodeMutation,
    refreshMutation,
    lastTokenPair,
    logout,
  }
}

export type AuthError = ApiError
