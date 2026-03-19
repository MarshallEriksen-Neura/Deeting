"use client"

import { useEffect, useRef } from "react"
import { mutate } from "swr"
import { toast } from "sonner"

import { useAuthService } from "@/hooks/use-auth"
import {
  ACCOUNT_BINDINGS_KEY,
  confirmDesktopOAuthBindingGrant,
} from "@/lib/api/account-bindings"
import {
  parseDesktopOAuthCallbackUrl,
  type DesktopOAuthCallbackPayload,
} from "@/lib/api/auth-oauth-desktop"
import { isTauriRuntime } from "@/lib/api/desktop-config"
import {
  getCurrentDesktopDeepLinks,
  listenForDesktopDeepLinks,
} from "@/lib/api/desktop-deep-link"

function serializePayload(payload: DesktopOAuthCallbackPayload) {
  return `${payload.intent}:${payload.provider}:${payload.session_id}:${payload.state}:${payload.grant}`
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return fallback
}

export function DesktopOAuthListener() {
  const { exchangeDesktopBrowserLoginGrant } = useAuthService()
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
          if (payload.intent === "bind") {
            if (!payload.state) {
              throw new Error("Desktop OAuth bind callback is missing state")
            }
            const requestPayload = {
              provider: payload.provider,
              session_id: payload.session_id,
              state: payload.state,
              grant: payload.grant,
            }
            const result = await confirmDesktopOAuthBindingGrant(requestPayload)
            await mutate(ACCOUNT_BINDINGS_KEY)
            toast.success(`${result.provider} 绑定成功`)
          } else if (payload.provider === "browser") {
            await exchangeDesktopBrowserLoginGrant({
              session_id: payload.session_id,
              grant: payload.grant,
            })
            toast.success("登录成功")
          } else {
            throw new Error("Desktop OAuth login entry has been removed")
          }
        } catch (error) {
          handledRef.current.delete(key)
          const message = getErrorMessage(error, "桌面 OAuth 操作失败")
          toast.error(message)
        }
      }
    }

    ;(async () => {
      const [currentUrls, unlisten] = await Promise.all([
        getCurrentDesktopDeepLinks(),
        listenForDesktopDeepLinks(async (urls) => {
          await handleUrls(urls)
        }),
      ])

      if (disposed) {
        unlisten()
        return
      }

      cleanup = unlisten

      if (currentUrls?.length) {
        await handleUrls(currentUrls)
      }
    })().catch((error) => {
      const message = getErrorMessage(error, "桌面 OAuth 监听初始化失败")
      toast.error(message)
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [exchangeDesktopBrowserLoginGrant])

  return null
}
