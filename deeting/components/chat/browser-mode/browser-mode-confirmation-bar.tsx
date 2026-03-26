"use client"

import { MonitorSmartphone, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useWorkspaceStore } from "@/store/workspace-store"

export function BrowserModeConfirmationBar() {
  const t = useI18n("chat")
  const { status, request, confirm, decline } = useBrowserModeStore(
    useShallow((state) => ({
      status: state.status,
      request: state.request,
      confirm: state.confirm,
      decline: state.decline,
    }))
  )
  const openView = useWorkspaceStore((state) => state.openView)

  const handleConfirm = () => {
    confirm()
    openView({
      id: "browser-mode",
      type: "browser-mode",
      title: t("browserMode.panel.title"),
      content: { source: "chat-browser-mode" },
    })
  }

  if (status !== "pending_confirmation" || !request) {
    return null
  }

  return (
    <div className="rounded-2xl border border-sky-200/70 bg-sky-50/90 p-3 text-sky-950 shadow-[0_10px_30px_-18px_rgba(14,116,144,0.45)] backdrop-blur-xl dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300">
          <MonitorSmartphone className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold">
            {t("browserMode.confirmation.title")}
          </p>
          <p className="text-xs leading-5 text-sky-900/80 dark:text-sky-100/75">
            {t("browserMode.confirmation.description")}
          </p>
          <p className="truncate text-[11px] text-sky-800/70 dark:text-sky-100/60">
            {request.prompt}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sky-800/60 transition-colors hover:bg-sky-500/10 hover:text-sky-900 dark:text-sky-100/60 dark:hover:bg-sky-400/10 dark:hover:text-sky-50"
          onClick={decline}
          aria-label={t("browserMode.confirmation.dismiss")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-9 rounded-full px-4 text-sky-900 hover:bg-sky-500/10 hover:text-sky-950 dark:text-sky-100 dark:hover:bg-sky-400/10 dark:hover:text-sky-50"
          onClick={decline}
        >
          {t("browserMode.confirmation.reject")}
        </Button>
        <Button
          type="button"
          className="h-9 rounded-full bg-sky-700 px-4 text-white hover:bg-sky-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
          onClick={handleConfirm}
        >
          {t("browserMode.confirmation.confirm")}
        </Button>
      </div>
    </div>
  )
}
