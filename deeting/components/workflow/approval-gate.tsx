"use client"

import { useState } from "react"
import { ShieldAlert, RefreshCw } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { GlassCard } from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { WorkflowCheckpoint } from "@/lib/workflow/types"

interface ApprovalGateProps {
  checkpoint: WorkflowCheckpoint
  variant?: "approval" | "revalidation"
  onApprove: () => Promise<void>
  onReject: () => Promise<void>
  onModify: () => void
}

export function ApprovalGate({
  checkpoint,
  variant = "approval",
  onApprove,
  onReject,
  onModify,
}: ApprovalGateProps) {
  const t = useI18n("workflow")
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)

  const isApproval = variant === "approval"
  const Icon = isApproval ? ShieldAlert : RefreshCw

  async function handleApprove() {
    setApproving(true)
    try {
      await onApprove()
    } finally {
      setApproving(false)
    }
  }

  async function handleReject() {
    setRejecting(true)
    try {
      await onReject()
    } finally {
      setRejecting(false)
      setShowRejectConfirm(false)
    }
  }

  const busy = approving || rejecting

  return (
    <>
      <GlassCard
        blur="lg"
        theme="default"
        hover="none"
        padding="none"
        className={[
          isApproval
            ? "border-amber-500/15 [--glass-border:rgba(245,158,11,0.12)] [--glass-shine:rgba(245,158,11,0.15)]"
            : "border-[var(--primary)]/15 [--glass-border:rgba(124,109,255,0.12)] [--glass-shine:rgba(124,109,255,0.15)]",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-2">
          <div
            className={[
              "flex size-9 items-center justify-center rounded-xl",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
              isApproval
                ? "bg-gradient-to-b from-amber-500/20 to-amber-600/10 text-amber-400 ring-1 ring-amber-500/20"
                : "bg-gradient-to-b from-[var(--primary)]/20 to-[var(--primary)]/10 text-[var(--primary)] ring-1 ring-[var(--primary)]/20",
            ].join(" ")}
          >
            <Icon className="size-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <h4 className="text-sm font-semibold text-[var(--foreground)]">
              {t(isApproval ? "approval.title" : "approval.revalidationTitle")}
            </h4>
            {checkpoint.reason && (
              <p className="text-xs text-[var(--muted)]">{checkpoint.reason}</p>
            )}
          </div>
        </div>

        {/* Reason detail block */}
        {checkpoint.reason && (
          <div className="px-5 pb-2">
            <div
              className={[
                "rounded-lg p-3",
                "bg-[var(--surface)]/30",
                "border-l-2",
                isApproval ? "border-l-amber-500/40" : "border-l-[var(--primary)]/40",
              ].join(" ")}
            >
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                {checkpoint.reason}
              </p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-5 py-4">
          <GlassButton
            variant="success"
            size="sm"
            onClick={handleApprove}
            disabled={busy}
            loading={approving}
          >
            {approving ? t("approval.approving") : t("approval.approve")}
          </GlassButton>
          <GlassButton
            variant="outline"
            size="sm"
            onClick={onModify}
            disabled={busy}
          >
            {t("approval.modify")}
          </GlassButton>
          <GlassButton
            variant="destructive"
            size="sm"
            onClick={() => setShowRejectConfirm(true)}
            disabled={busy}
          >
            {t("approval.reject")}
          </GlassButton>
        </div>
      </GlassCard>

      {/* Reject confirmation -- glass-styled modal */}
      <AlertDialog open={showRejectConfirm} onOpenChange={setShowRejectConfirm}>
        <AlertDialogContent
          className={[
            "bg-[var(--card)]/60 backdrop-blur-2xl",
            "border border-white/10",
            "rounded-2xl",
            "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.05)_inset]",
          ].join(" ")}
        >
          {/* Top shine */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(239,68,68,0.25) 30%, rgba(255,255,255,0.1) 50%, rgba(239,68,68,0.25) 70%, transparent)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
            }}
          />

          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2.5 text-base font-semibold text-[var(--foreground)]">
              <div className="flex size-7 items-center justify-center rounded-lg bg-red-500/15 text-red-400 ring-1 ring-red-500/20">
                <ShieldAlert className="size-3.5" />
              </div>
              {t("approval.rejectConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-[var(--muted)]">
              {t("approval.rejectConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2.5 border-t border-white/[0.06] pt-4">
            <AlertDialogCancel
              disabled={rejecting}
              className={[
                "h-9 rounded-xl px-4",
                "bg-[var(--surface)]/50 backdrop-blur-sm",
                "border border-white/10",
                "text-sm font-medium text-[var(--foreground)]",
                "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]",
                "hover:bg-[var(--surface)]/70",
                "transition-all duration-200",
                "active:scale-[0.97]",
              ].join(" ")}
            >
              {t("approval.cancelEdit")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={rejecting}
              className={[
                "h-9 rounded-xl px-4",
                "bg-gradient-to-b from-red-500 to-red-600",
                "text-sm font-medium text-white",
                "shadow-[0_2px_8px_-2px_rgba(239,68,68,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]",
                "hover:shadow-[0_4px_16px_-2px_rgba(239,68,68,0.5)]",
                "hover:brightness-110",
                "border border-white/10",
                "transition-all duration-200",
                "active:scale-[0.97]",
                "disabled:opacity-40",
              ].join(" ")}
            >
              {rejecting ? t("approval.rejecting") : t("approval.reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
