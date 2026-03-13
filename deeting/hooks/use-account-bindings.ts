"use client"

import { useCallback } from "react"
import useSWR from "swr"

import {
  ACCOUNT_BINDINGS_KEY,
  confirmEmailBinding,
  fetchAccountBindings,
  openDesktopOAuthBinding,
  sendEmailBindingCode,
  type AccountBindings,
} from "@/lib/api/account-bindings"
import { ApiError } from "@/lib/http"

export function useAccountBindings() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<
    AccountBindings,
    ApiError
  >(ACCOUNT_BINDINGS_KEY, fetchAccountBindings)

  const refresh = useCallback(() => mutate(), [mutate])

  const startOauthBinding = useCallback(
    async (provider: "google" | "github") => {
      await openDesktopOAuthBinding(provider)
    },
    []
  )

  const sendEmailCode = useCallback(
    async (email: string) => {
      await sendEmailBindingCode(email)
    },
    []
  )

  const confirmEmailCode = useCallback(
    async (email: string, code: string) => {
      await confirmEmailBinding(email, code)
      await mutate()
    },
    [mutate]
  )

  return {
    bindings: data,
    error,
    isLoading: isLoading || isValidating,
    refresh,
    startOauthBinding,
    sendEmailCode,
    confirmEmailCode,
  }
}
