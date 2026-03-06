"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { useAuthService } from "@/hooks/use-auth"
import {
  parseDesktopOAuthCallbackUrl,
  type DesktopOAuthExchangeRequest,
} from "@/lib/api/auth-oauth-desktop"
import { isTauriRuntime } from "@/lib/api/desktop-config"

function serializePayload(payload: DesktopOAuthExchangeRequest) {
  return `${payload.provider}:${payload.session_id}:${payload.state}:${payload.grant}`
}

export function DesktopOAuthListener() {
  const { completeDesktopOAuth } = useAuthService()
  const handledRef = useRef(new Set<string>())

  useEffect(() => {
    if (!isTauriRuntime()) return

    let disposed = false
    let cleanup: (() => void) | undefined

    const handleUrls = async (urls: string[]) => {
      for (const url of urls) {
        const payload = parseDesktopOAuthCallbackUrl(url)
        if (!payload) continue
        const key = serializePayload(payload)
        if (handledRef.current.has(key)) continue
        handledRef.current.add(key)
        try {
          await completeDesktopOAuth(payload)
          toast.success("登录成功")
        } catch (error) {
          handledRef.current.delete(key)
          const message = error instanceof Error ? error.message : "桌面 OAuth 登录失败"
          toast.error(message)
        }
      }
    }

    ;(async () => {
      const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link")
      if (disposed) return
      cleanup = await onOpenUrl(async (urls) => {
        await handleUrls(urls)
      })
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "桌面 OAuth 监听初始化失败"
      toast.error(message)
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [completeDesktopOAuth])

  return null
}
