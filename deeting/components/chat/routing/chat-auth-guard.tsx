"use client"

import * as React from "react"

import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"
import { useAuthStore } from "@/store/auth-store"
import { useDesktopAuthBootstrapStore } from "@/store/desktop-auth-bootstrap-store"
import { ChatRouteFallback } from "./chat-route-fallback"

type AuthPersistApi = {
  hasHydrated: () => boolean
  onHydrate: (listener: () => void) => () => void
  onFinishHydration: (listener: () => void) => () => void
}

const CHAT_AUTH_DIAGNOSTIC_TIMEOUT_MS = 4000

export function buildChatLoginTarget(pathname?: string, search?: string) {
  const safePathname = pathname?.trim() || "/chat"
  const normalizedSearch =
    typeof search === "string" && search.trim() && search !== "?"
      ? search
      : ""
  return `/login?callbackUrl=${encodeURIComponent(`${safePathname}${normalizedSearch}`)}`
}

function getCurrentChatLoginTarget() {
  if (typeof window === "undefined") {
    return buildChatLoginTarget("/chat")
  }
  return buildChatLoginTarget(window.location.pathname, window.location.search)
}

function getAuthPersistApi(): AuthPersistApi | null {
  const persistApi = (useAuthStore as typeof useAuthStore & { persist?: AuthPersistApi })
    .persist

  if (
    persistApi &&
    typeof persistApi.hasHydrated === "function" &&
    typeof persistApi.onHydrate === "function" &&
    typeof persistApi.onFinishHydration === "function"
  ) {
    return persistApi
  }

  return null
}

export function ChatAuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isDesktopAuthBootstrapReady = useDesktopAuthBootstrapStore((state) => state.isReady)
  const redirectedRef = React.useRef(false)
  const isDesktopRuntime = detectTauriRuntime()
  const [isHydrated, setIsHydrated] = React.useState(false)
  const isRestoringDesktopSession = isDesktopRuntime && !isDesktopAuthBootstrapReady
  const hasUsableSession = isAuthenticated
  const isAuthStateReady = isHydrated || hasUsableSession
  const pendingReason = !isAuthStateReady
    ? "auth_store_hydration"
    : isRestoringDesktopSession
      ? "desktop_auth_bootstrap"
      : null

  React.useEffect(() => {
    const persistApi = getAuthPersistApi()
    if (!persistApi) {
      setIsHydrated(true)
      return
    }

    const onHydrate = () => setIsHydrated(false)
    const onFinishHydration = () => setIsHydrated(true)

    const unsubscribeHydrate = persistApi.onHydrate(onHydrate)
    const unsubscribeFinish = persistApi.onFinishHydration(onFinishHydration)

    setIsHydrated(persistApi.hasHydrated())

    return () => {
      unsubscribeHydrate()
      unsubscribeFinish()
    }
  }, [])

  const loginTarget = getCurrentChatLoginTarget()

  React.useEffect(() => {
    if (!pendingReason) {
      return
    }

    const timer = window.setTimeout(() => {
      console.warn("chat auth guard still blocked", {
        pendingReason,
        isHydrated,
        isDesktopAuthBootstrapReady,
        isAuthenticated,
        isDesktopRuntime,
      })
    }, CHAT_AUTH_DIAGNOSTIC_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    isAuthenticated,
    isDesktopAuthBootstrapReady,
    isDesktopRuntime,
    isHydrated,
    pendingReason,
  ])

  React.useEffect(() => {
    if (!isAuthStateReady || isRestoringDesktopSession || isAuthenticated) {
      redirectedRef.current = false
      return
    }

    if (redirectedRef.current) return
    redirectedRef.current = true

    window.location.replace(loginTarget)
  }, [isAuthenticated, isAuthStateReady, isRestoringDesktopSession, loginTarget])

  if (!isAuthStateReady || !isAuthenticated) {
    if (!isAuthStateReady || isRestoringDesktopSession) {
      const fallbackBadge =
        pendingReason === "auth_store_hydration"
          ? "Auth Store"
          : "Desktop Bootstrap"
      const fallbackDetail =
        pendingReason === "auth_store_hydration"
          ? "Waiting for the persisted auth store to finish hydration before restoring the chat session"
          : "Waiting for desktop authentication bootstrap to complete before entering the chat workspace"

      return (
        <ChatRouteFallback
          label="Restoring session"
          detail={fallbackDetail}
          badge={fallbackBadge}
        />
      )
    }

    if (!isDesktopRuntime) {
      return (
        <ChatRouteFallback
          label="Redirecting to sign in"
          detail="Preparing the authentication handoff for this chat route"
        />
      )
    }

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/90 p-8 text-center shadow-[0_20px_60px_-20px_rgba(15,23,42,0.25)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-xl font-semibold text-slate-700">
            D
          </div>
          <h2 className="mt-5 text-xl font-semibold text-slate-900">
            Sign in to continue
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The desktop app opens your browser for authentication. If you closed it, you can start the login flow again here.
          </p>
          <button
            type="button"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            onClick={() => window.location.replace(loginTarget)}
          >
            Continue login
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
