"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { PluginMarketReviewItem } from "@/lib/api/admin-dashboard"

interface RejectReviewDialogProps {
  review: PluginMarketReviewItem | null
  submitting: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}

export function RejectReviewDialog({
  review,
  submitting,
  onClose,
  onConfirm,
}: RejectReviewDialogProps) {
  const t = useTranslations("admin.pluginReviewsPage")
  const [draftReasons, setDraftReasons] = useState<Record<string, string>>({})
  const reason = review
    ? draftReasons[review.id] ?? review.review_reason ?? ""
    : ""
  const trimmedReason = reason.trim()

  return (
    <Dialog open={Boolean(review)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialog.title", { name: review?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="plugin-reject-reason">{t("dialog.reasonLabel")}</Label>
          <Textarea
            id="plugin-reject-reason"
            value={reason}
            onChange={(event) => {
              if (!review) return
              setDraftReasons((current) => ({
                ...current,
                [review.id]: event.target.value,
              }))
            }}
            placeholder={t("dialog.reasonPlaceholder")}
            rows={5}
          />
          <p className="text-xs text-[var(--muted)]">{t("dialog.reasonHint")}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t("dialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!review) return
              await onConfirm(trimmedReason)
              setDraftReasons((current) => {
                const next = { ...current }
                delete next[review.id]
                return next
              })
            }}
            disabled={!trimmedReason || submitting}
          >
            {t("dialog.confirmReject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

