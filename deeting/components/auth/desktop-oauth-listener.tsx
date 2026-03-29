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

const PROCESSED_DEEP_LINK_STORAGE_KEY = "deeting:desktop-oauth:processed-deep-links"
const MAX_PROCESSED_DEEP_LINKS = 32

function serializePayload(payload: DesktopOAuthCallbackPayload) {
  return `${payload.intent}:${payload.provider}:${payload.session_id}:${payload.state ?? ""}:${payload.grant}`
}

function loadProcessedDeepLinkKeys(): Set<string> {
  if (typeof window === "undefined") {
    return new Set()
  }

  try {
    const raw = window.sessionStorage.getItem(PROCESSED_DEEP_LINK_STORAGE_KEY)
    if (!raw) return new Set()
    const values = JSON.parse(raw)
    if (!Array.isArray(values)) return new Set()
    return new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))
  } catch {
    return new Set()
  }
}

function persistProcessedDeepLinkKey(processedKeys: Set<string>, key: string) {
  if (typeof window === "undefined") {
    return
  }

  try {
    const nextValues = [...processedKeys, key].slice(-MAX_PROCESSED_DEEP_LINKS)
    processedKeys.clear()
    for (const value of nextValues) {
      processedKeys.add(value)
    }
    window.sessionStorage.setItem(
      PROCESSED_DEEP_LINK_STORAGE_KEY,
      JSON.stringify(nextValues)
    )
  } catch {
    // Ignore storage errors so login completion still succeeds.
  }
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

function isTerminalReplayError(message: string) {
  const normalized = message.trim().toLowerCase()
  return (
    normalized.includes("session is not active") ||
    normalized.includes("grant already consumed") ||
    normalized.includes("session expired") ||
    normalized.includes("grant expired")
  )
}

export function DesktopOAuthListener() {
  const { exchangeDesktopBrowserLoginGrant, exchangeDesktopOAuthLoginGrant } = useAuthService()
  const handledRef = useRef(new Set<string>())
  const processedRef = useRef<Set<string>>(loadProcessedDeepLinkKeys())

  useEffect(() => {
    if (!isTauriRuntime()) return

    let disposed = false
    let cleanup: (() => void) | undefined

    const handleUrls = async (urls: string[]) => {
      for (const url of urls) {
        const payload = parseDesktopOAuthCallbackUrl(url)
        if (!payload) continue
        const key = serializePayload(payload)
        if (processedRef.current.has(key)) continue
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
            persistProcessedDeepLinkKey(processedRef.current, key)
            toast.success(`${result.provider} 绑定成功`)
          } else if (payload.provider === "browser") {
            await exchangeDesktopBrowserLoginGrant({
              session_id: payload.session_id,
              grant: payload.grant,
            })
            persistProcessedDeepLinkKey(processedRef.current, key)
            toast.success("登录成功")
          } else {
            if (!payload.state) {
              throw new Error("Desktop OAuth login callback is missing state")
            }
            await exchangeDesktopOAuthLoginGrant({
              provider: payload.provider,
              session_id: payload.session_id,
              state: payload.state,
              grant: payload.grant,
            })
            persistProcessedDeepLinkKey(processedRef.current, key)
            toast.success("登录成功")
          }
        } catch (error) {
          handledRef.current.delete(key)
          const message = getErrorMessage(error, "桌面 OAuth 操作失败")
          if (isTerminalReplayError(message)) {
            persistProcessedDeepLinkKey(processedRef.current, key)
          }
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
  }, [exchangeDesktopBrowserLoginGrant, exchangeDesktopOAuthLoginGrant])

  return null
}
