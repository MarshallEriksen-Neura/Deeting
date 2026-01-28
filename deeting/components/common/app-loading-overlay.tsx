"use client"

import { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useThemeStore } from "@/store/theme-store"
import { useChatSessionStore } from "@/store/chat-session-store"
import { useI18n } from "@/hooks/use-i18n"

export function AppLoadingOverlay() {
  const tCommon = useI18n("common")
  const tChat = useI18n("chat")
  const { isTransitioning } = useThemeStore(
    useShallow((state) => ({
      isTransitioning: state.isTransitioning,
    }))
  )
  const { globalLoading } = useChatSessionStore(
    useShallow((state) => ({
      globalLoading: state.globalLoading,
    }))
  )
  const isActive = isTransitioning || globalLoading
  const label = useMemo(() => {
    if (isTransitioning) return tCommon("loading.theme")
    if (globalLoading) return tChat("loading.global")
    return ""
  }, [isTransitioning, globalLoading, tCommon, tChat])
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    if (isActive) {
      setIsVisible(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true)
        })
      })
    } else {
      setIsAnimating(false)
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isActive])

  if (!isVisible) return null

  return (
    <div
      className={`
        fixed inset-0 z-[9999] pointer-events-none
        flex items-center justify-center
        transition-opacity duration-300 ease-out
        ${isAnimating ? "opacity-100" : "opacity-0"}
      `}
      aria-hidden="true"
    >
      <div
        className={`
          absolute inset-0
          bg-[var(--background)]/80
          backdrop-blur-md
          transition-all duration-300 ease-out
          ${isAnimating ? "backdrop-blur-md" : "backdrop-blur-none"}
        `}
      />

      <div
        className={`
          relative z-10
          flex flex-col items-center gap-4
          transition-all duration-300 ease-out
          ${isAnimating ? "scale-100 opacity-100" : "scale-95 opacity-0"}
        `}
      >
        <div className="relative w-12 h-12">
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--primary)]/60 border-r-[var(--primary)]/30 animate-spin"
            style={{ animationDuration: "0.8s" }}
          />
          <div className="absolute inset-1 rounded-full bg-gradient-to-br from-[var(--primary)]/20 to-transparent animate-pulse" />
          <div className="absolute inset-0 m-auto w-2 h-2 rounded-full bg-[var(--primary)]/80 shadow-[0_0_12px_rgba(124,109,255,0.6)]" />
        </div>

        <span className="text-sm font-medium text-[var(--muted)] animate-pulse">
          {label}
        </span>
      </div>

      <div
        className={`
          absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-64 h-64
          bg-[radial-gradient(circle,var(--primary)/0.1,transparent)]
          rounded-full
          blur-3xl
          transition-opacity duration-500
          ${isAnimating ? "opacity-100" : "opacity-0"}
        `}
      />
    </div>
  )
}
