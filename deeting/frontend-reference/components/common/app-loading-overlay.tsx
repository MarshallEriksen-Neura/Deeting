"use client"

import { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { StartupShell } from "@/components/common/startup-shell"
import { useThemeStore } from "@/store/theme-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useI18n } from "@/hooks/use-i18n"

export function AppLoadingOverlay() {
  const tCommon = useI18n("common")
  const { isTransitioning } = useThemeStore(
    useShallow((state) => ({
      isTransitioning: state.isTransitioning,
    }))
  )
  const { globalLoading } = useChatRuntimeStore(
    useShallow((state) => ({
      globalLoading: state.globalLoading,
    }))
  )
  const isActive = isTransitioning || globalLoading
  const label = useMemo(() => {
    if (isTransitioning) return tCommon("loading.theme")
    if (globalLoading) return tCommon("loading.workspace")
    return ""
  }, [isTransitioning, globalLoading, tCommon])
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
        transition-opacity duration-300 ease-out
        ${isAnimating ? "opacity-100" : "opacity-0"}
      `}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[var(--background)]/78 backdrop-blur-xl" />
      <div
        className={`
          relative z-10 h-full w-full transition-all duration-300 ease-out
          ${isAnimating ? "scale-100 opacity-100" : "scale-[0.985] opacity-0"}
        `}
      >
        <StartupShell
          tone="overlay"
          badge={label}
          label={label}
          detail={isTransitioning ? "Applying a fresh interface skin" : "Synchronizing the active workspace"}
          steps={[
            {
              label: "Theme",
              hint: isTransitioning ? "Refreshing the current visual palette" : "Theme is stable",
              state: isTransitioning ? "active" : "done",
            },
            {
              label: "Conversation",
              hint: globalLoading ? "Loading session data and message context" : "Session context is ready",
              state: globalLoading ? "active" : "done",
            },
            {
              label: "Surface",
              hint: "Keeping the interface responsive while content settles",
              state: "pending",
            },
          ]}
        />
      </div>
    </div>
  )
}
