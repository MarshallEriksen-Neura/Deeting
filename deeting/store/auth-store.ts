"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { setAuthToken, clearAuthToken } from "@/lib/http"

export interface AuthState {
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 当前 access token（仅内存/会话存储，不保存 refresh_token） */
  accessToken: string | null
  /** token 类型，默认 bearer */
  tokenType: "bearer" | null
}

interface AuthActions {
  /** 写入登录态（登录/续期成功后调用） */
  setSession: (payload: {
    accessToken: string | null
    tokenType?: "bearer" | null
  }) => void
  /** 清空登录态（退出/失效） */
  clearSession: () => void
}

type AuthStore = AuthState & AuthActions

const DEFAULT_AUTH_STATE: AuthState = {
  isAuthenticated: false,
  accessToken: null,
  tokenType: null,
}

/**
 * 登录状态 Store
 * - 只持久化 access_token 与登录标记，refresh_token 依赖服务端 HttpOnly Cookie
 * - 使用 sessionStorage，刷新标签页后仍可保持一次会话
 */
export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      ...DEFAULT_AUTH_STATE,

      setSession: ({ accessToken, tokenType = "bearer" }) =>
        set(() => {
          if (accessToken) {
            setAuthToken(accessToken)
          } else {
            clearAuthToken()
          }
          return {
            accessToken,
            tokenType,
            isAuthenticated: Boolean(accessToken),
          }
        }),

      clearSession: () => {
        clearAuthToken()
        set({ ...DEFAULT_AUTH_STATE })
      },
    }),
    {
      name: "deeting-auth-store",
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      partialize: (state) => ({
        accessToken: state.accessToken,
        tokenType: state.tokenType,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) {
          setAuthToken(state.accessToken)
        }
      },
    }
  )
)
