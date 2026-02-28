"use client"

import { useEffect } from "react"
import { useAuthStore } from "@/store/auth-store"
import { AUTH_INVALIDATED_EVENT, setAuthToken } from "@/lib/http"

/**
 * 认证状态同步组件
 * 
 * 负责将 Zustand store 中的 token 同步到 axios client 的静态变量中。
 * 处理页面刷新后的 token 恢复。
 */
export function AuthSync() {
  const accessToken = useAuthStore((state) => state.accessToken)
  const clearSession = useAuthStore((state) => state.clearSession)

  useEffect(() => {
    // 无论是登录动作导致 store 更新，还是页面刷新导致 hydration 完成
    // 只要 accessToken 变化，就同步到 http client
    setAuthToken(accessToken)
  }, [accessToken])

  useEffect(() => {
    const handleInvalidated = () => {
      clearSession()
    }
    window.addEventListener(AUTH_INVALIDATED_EVENT, handleInvalidated)
    return () => {
      window.removeEventListener(AUTH_INVALIDATED_EVENT, handleInvalidated)
    }
  }, [clearSession])

  return null
}
