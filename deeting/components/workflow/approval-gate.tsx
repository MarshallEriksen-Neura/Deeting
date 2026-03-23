"use client"

import { useState } from "react"
import { ShieldAlert, RefreshCw } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
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
  const borderColor = isApproval ? "border-amber-500/20" : "border-primary/20"
  const bgColor = isApproval ? "bg-amber-500/5" : "bg-primary/5"

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
      <Card className={`${bgColor} ${borderColor} backdrop-blur-xl`}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${isApproval ? "text-amber-500" : "text-primary"}`} />
            <CardTitle className="text-base">
              {t(isApproval ? "approval.title" : "approval.revalidationTitle")}
            </CardTitle>
          </div>
          {checkpoint.reason && (
            <CardDescription className="mt-1">{checkpoint.reason}</CardDescription>
          )}
        </CardHeader>

        {checkpoint.reason && (
          <CardContent className="pt-0 pb-3">
            <div className={`border-l-2 ${isApproval ? "border-amber-500/50" : "border-primary/50"} pl-3`}>
              <p className="text-sm text-muted-foreground">{checkpoint.reason}</p>
            </div>
          </CardContent>
        )}

        <CardFooter className="gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleApprove}
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {approving ? t("approval.approving") : t("approval.approve")}
          </Button>
          <Button variant="outline" size="sm" onClick={onModify} disabled={busy}>
            {t("approval.modify")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowRejectConfirm(true)}
            disabled={busy}
          >
            {t("approval.reject")}
          </Button>
        </CardFooter>
      </Card>

      {/* Reject confirmation */}
      <AlertDialog open={showRejectConfirm} onOpenChange={setShowRejectConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approval.rejectConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("approval.rejectConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rejecting}>{t("approval.cancelEdit")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={rejecting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {rejecting ? t("approval.rejecting") : t("approval.reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
