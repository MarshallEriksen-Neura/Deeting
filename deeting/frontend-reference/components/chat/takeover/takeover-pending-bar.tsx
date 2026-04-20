"use client"

import { Clock3, X } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
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
    <div className="pointer-events-auto w-full max-w-[min(26rem,calc(100vw-2.5rem))] rounded-2xl border border-amber-200/80 bg-white/95 p-2.5 text-amber-950 shadow-[0_20px_45px_-26px_rgba(180,83,9,0.55)] ring-1 ring-white/70 backdrop-blur-2xl dark:border-amber-400/20 dark:bg-[#16120c]/95 dark:text-amber-50 dark:ring-white/5">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
          <Clock3 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold leading-none">{t("takeover.title")}</p>
            {isDeferredSendScheduled ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-400/12 dark:text-amber-200">
                {t("takeover.actions.sendAfterStep")}
              </span>
            ) : null}
          </div>
          <p className="line-clamp-1 text-[11px] leading-4 text-amber-900/75 dark:text-amber-100/70">
            {t("takeover.description")}
          </p>
          {preview ? (
            <p className="line-clamp-1 rounded-xl bg-amber-500/8 px-2 py-1 text-[11px] text-amber-900/70 dark:bg-amber-400/8 dark:text-amber-100/65">
              {preview}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {!isDeferredSendScheduled ? (
              <Button
                type="button"
                variant="ghost"
                className="h-7 rounded-full border border-amber-300/60 bg-amber-500/8 px-2.5 text-[11px] font-medium text-amber-900 hover:bg-amber-500/14 hover:text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/8 dark:text-amber-100 dark:hover:bg-amber-400/14 dark:hover:text-amber-50"
                onClick={onSendAfterStep}
              >
                {t("takeover.actions.sendAfterStep")}
              </Button>
            ) : null}
            <Button
              type="button"
              className="h-7 rounded-full bg-amber-700 px-2.5 text-[11px] font-medium text-white hover:bg-amber-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
              onClick={onImmediateStop}
            >
              {t("takeover.actions.immediateStop")}
            </Button>
          </div>
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
    </div>
  )
}
