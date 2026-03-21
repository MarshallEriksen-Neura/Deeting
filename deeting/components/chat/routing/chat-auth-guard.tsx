"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"
import { useAuthStore } from "@/store/auth-store"
import { ChatRouteFallback } from "./chat-route-fallback"

export function ChatAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const redirectedRef = React.useRef(false)
  const isDesktopRuntime = detectTauriRuntime()

  const [isHydrated, setIsHydrated] = React.useState(() =>
    useAuthStore.persist.hasHydrated()
  )

  React.useEffect(() => {
    const onHydrate = () => setIsHydrated(false)
    const onFinishHydration = () => setIsHydrated(true)

    const unsubscribeHydrate = useAuthStore.persist.onHydrate(onHydrate)
    const unsubscribeFinish = useAuthStore.persist.onFinishHydration(onFinishHydration)

    setIsHydrated(useAuthStore.persist.hasHydrated())

    return () => {
      unsubscribeHydrate()
      unsubscribeFinish()
    }
  }, [])

  const callbackUrl = React.useMemo(() => {
    const currentPath = pathname || "/chat"
    const query = searchParams?.toString()
    return query ? `${currentPath}?${query}` : currentPath
  }, [pathname, searchParams])

  const loginTarget = React.useMemo(
    () => `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    [callbackUrl]
  )

  React.useEffect(() => {
    if (!isHydrated || isAuthenticated) {
      redirectedRef.current = false
      return
    }

    if (redirectedRef.current) return
    redirectedRef.current = true

    router.replace(loginTarget)
  }, [isAuthenticated, isHydrated, loginTarget, router])

  if (!isHydrated || !isAuthenticated) {
    if (!isHydrated) {
      return (
        <ChatRouteFallback
          label="Restoring session"
          detail="Checking desktop authentication and conversation context"
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
            onClick={() => router.replace(loginTarget)}
          >
            Continue login
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
