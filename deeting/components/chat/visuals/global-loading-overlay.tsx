"use client"

import { Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "@/store/chat-store"
import { useI18n } from "@/hooks/use-i18n"

export function GlobalLoadingOverlay() {
  const t = useI18n("chat")
  const { globalLoading } = useChatStore(
    useShallow((state) => ({
      globalLoading: state.globalLoading,
    }))
  )

  if (!globalLoading) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/10 backdrop-blur-[2px]" />
      <div className="relative flex items-center gap-3 rounded-2xl border border-white/30 bg-white/90 px-4 py-3 text-sm text-slate-800 shadow-2xl dark:border-white/10 dark:bg-[#0a0a0a]/90 dark:text-white/80">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>{t("loading.global")}</span>
      </div>
    </div>
  )
}
