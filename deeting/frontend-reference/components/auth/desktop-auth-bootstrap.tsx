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

const AUTH_HYDRATION_TIMEOUT_MS = 3000
const DESKTOP_CONFIG_TIMEOUT_MS = 3000
const DESKTOP_CONFIG_TIMEOUT = Symbol("desktop-config-timeout")

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
    return "hydrated" as const
  }

  return Promise.race([
    new Promise<"hydrated">((resolve) => {
      const unsubscribe = persistApi.onFinishHydration(() => {
        unsubscribe()
        resolve("hydrated")
      })
    }),
    new Promise<"timeout">((resolve) => {
      window.setTimeout(() => resolve("timeout"), AUTH_HYDRATION_TIMEOUT_MS)
    }),
  ])
}

async function getDesktopConfigWithTimeout(key: string) {
  return Promise.race([
    getDesktopConfig(key),
    new Promise<typeof DESKTOP_CONFIG_TIMEOUT>((resolve) => {
      window.setTimeout(() => resolve(DESKTOP_CONFIG_TIMEOUT), DESKTOP_CONFIG_TIMEOUT_MS)
    }),
  ])
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
        const hydrationState = await waitForAuthHydration()
        if (cancelled) return

        if (hydrationState === "timeout") {
          console.warn("desktop auth bootstrap hydration timed out; continuing with desktop config recovery")
        }

        const currentAuthState = useAuthStore.getState()
        if (currentAuthState.isAuthenticated && currentAuthState.accessToken?.trim()) {
          return
        }

        const persistedToken = await getDesktopConfigWithTimeout(DESKTOP_CONFIG_KEYS.authToken)
        if (cancelled) return

        if (persistedToken === DESKTOP_CONFIG_TIMEOUT) {
          console.warn("desktop auth bootstrap desktop config lookup timed out")
          return
        }

        const normalizedToken =
          typeof persistedToken === "string" ? persistedToken.trim() : ""
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
