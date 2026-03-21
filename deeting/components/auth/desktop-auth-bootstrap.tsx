"use client"

import { useEffect } from "react"

import {
  DESKTOP_CONFIG_KEYS,
  getDesktopConfig,
  isTauriRuntime,
} from "@/lib/api/desktop-config"
import { useAuthStore } from "@/store/auth-store"
import { useDesktopAuthBootstrapStore } from "@/store/desktop-auth-bootstrap-store"

type AuthPersistApi = {
  hasHydrated: () => boolean
  onFinishHydration: (listener: () => void) => () => void
}

function getAuthPersistApi(): AuthPersistApi | null {
  const persistApi = (useAuthStore as typeof useAuthStore & { persist?: AuthPersistApi }).persist

  if (
    persistApi &&
    typeof persistApi.hasHydrated === "function" &&
    typeof persistApi.onFinishHydration === "function"
  ) {
    return persistApi
  }

  return null
}

async function waitForAuthHydration() {
  const persistApi = getAuthPersistApi()
  if (!persistApi || persistApi.hasHydrated()) {
    return
  }

  await new Promise<void>((resolve) => {
    const unsubscribe = persistApi.onFinishHydration(() => {
      unsubscribe()
      resolve()
    })
  })
}

export function DesktopAuthBootstrap() {
  const setReady = useDesktopAuthBootstrapStore((state) => state.setReady)

  useEffect(() => {
    if (!isTauriRuntime()) {
      setReady(true)
      return
    }

    let cancelled = false

    const restoreDesktopSession = async () => {
      setReady(false)

      try {
        await waitForAuthHydration()
        if (cancelled) return

        const currentAuthState = useAuthStore.getState()
        if (currentAuthState.isAuthenticated && currentAuthState.accessToken?.trim()) {
          return
        }

        const persistedToken = await getDesktopConfig(DESKTOP_CONFIG_KEYS.authToken)
        if (cancelled) return

        const normalizedToken = persistedToken?.trim()
        if (!normalizedToken) {
          return
        }

        currentAuthState.setSession({
          accessToken: normalizedToken,
          tokenType: "bearer",
        })
      } catch (error) {
        console.error("desktop auth bootstrap failed:", error)
      } finally {
        if (!cancelled) {
          setReady(true)
        }
      }
    }

    void restoreDesktopSession()

    return () => {
      cancelled = true
    }
  }, [setReady])

  return null
}
