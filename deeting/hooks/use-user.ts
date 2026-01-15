"use client"

import { useCallback, useEffect } from "react"
import useSWR from "swr"

import { fetchCurrentUser, type UserProfile } from "@/lib/api/user"
import { ApiError } from "@/lib/http"
import { useShallow } from "zustand/react/shallow"
import { useAuthStore } from "@/store/auth-store"
import { useUserStore } from "@/store/user-store"

const USER_PROFILE_KEY = "/api/v1/users/me"

/**
 * 用户 Profile Hook
 * - 登录后自动调用 /users/me 拉取用户信息并写入 store
 * - 未登录时清空本地缓存
 */
export function useUserProfile() {
  const isAuthenticated = useAuthStore(useShallow((state) => state.isAuthenticated))
  
  const { profile, setProfile, clearProfile } = useUserStore(
    useShallow((state) => ({
      profile: state.profile,
      setProfile: state.setProfile,
      clearProfile: state.clearProfile,
    }))
  )

  const shouldFetch = isAuthenticated ? USER_PROFILE_KEY : null

  const { data, error, isLoading, isValidating, mutate } = useSWR<UserProfile, ApiError>(
    shouldFetch,
    () => fetchCurrentUser(),
    {
      revalidateOnFocus: true,
      onSuccess: (user) => setProfile(user),
      onError: (err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearProfile()
        }
      },
    }
  )

  useEffect(() => {
    if (!isAuthenticated) {
      clearProfile()
      void mutate(undefined, false)
    }
  }, [isAuthenticated, clearProfile, mutate])

  const refreshProfile = useCallback(() => mutate(), [mutate])

  return {
    profile: data ?? profile,
    isLoading: Boolean(isAuthenticated && (isLoading || isValidating)),
    error,
    refreshProfile,
    setProfile,
    clearProfile,
    isAuthenticated,
  }
}
