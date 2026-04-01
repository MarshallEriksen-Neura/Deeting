"use client"

import { Clock3, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import type {
  PendingChatTakeover,
  PendingTakeoverRequestedAction,
} from "@/store/chat-store"

export function TakeoverPendingBar({
  pendingTakeover,
  requestedAction,
  onImmediateStop,
  onSendAfterStep,
  onCancel,
}: {
  pendingTakeover: PendingChatTakeover | null
  requestedAction?: PendingTakeoverRequestedAction | null
  onImmediateStop: () => void
  onSendAfterStep: () => void
  onCancel: () => void
}) {
  const t = useI18n("chat")

  if (!pendingTakeover) {
    return null
  }

  const preview = pendingTakeover.input.trim()
  const isDeferredSendScheduled = requestedAction === "send_after_step"

  return (
    <div className="rounded-2xl border border-amber-200/70 bg-amber-50/90 p-3 text-amber-950 shadow-[0_10px_30px_-18px_rgba(180,83,9,0.35)] backdrop-blur-xl dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
          <Clock3 className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold">{t("takeover.title")}</p>
          <p className="text-xs leading-5 text-amber-900/80 dark:text-amber-100/75">
            {t("takeover.description")}
          </p>
          {preview ? (
            <p className="truncate text-[11px] text-amber-800/70 dark:text-amber-100/60">
              {preview}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-amber-800/60 transition-colors hover:bg-amber-500/10 hover:text-amber-900 dark:text-amber-100/60 dark:hover:bg-amber-400/10 dark:hover:text-amber-50"
          onClick={onCancel}
          aria-label={t("takeover.actions.cancel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-9 rounded-full px-4 text-amber-900 hover:bg-amber-500/10 hover:text-amber-950 dark:text-amber-100 dark:hover:bg-amber-400/10 dark:hover:text-amber-50"
          onClick={onCancel}
        >
          {t("takeover.actions.cancel")}
        </Button>
        {!isDeferredSendScheduled ? (
          <Button
            type="button"
            variant="ghost"
            className="h-9 rounded-full px-4 text-amber-900 hover:bg-amber-500/10 hover:text-amber-950 dark:text-amber-100 dark:hover:bg-amber-400/10 dark:hover:text-amber-50"
            onClick={onSendAfterStep}
          >
            {t("takeover.actions.sendAfterStep")}
          </Button>
        ) : null}
        <Button
          type="button"
          className="h-9 rounded-full bg-amber-700 px-4 text-white hover:bg-amber-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
          onClick={onImmediateStop}
        >
          {t("takeover.actions.immediateStop")}
        </Button>
      </div>
    </div>
  )
}
