"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GlassButton } from "@/components/ui/glass-button"

interface NewFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (name: string) => void
}

export function NewFolderDialog({ open, onOpenChange, onConfirm }: NewFolderDialogProps) {
  const t = useTranslations("knowledge")
  const [name, setName] = useState("")

  const handleConfirm = useCallback(() => {
    if (name.trim()) {
      onConfirm(name.trim())
      setName("")
      onOpenChange(false)
    }
  }, [name, onConfirm, onOpenChange])

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setName("")
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("newFolderDialog.title")}</DialogTitle>
          <DialogDescription>{t("newFolderDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="folder-name">{t("newFolderDialog.nameLabel")}</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("newFolderDialog.namePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm()
            }}
            autoFocus
          />
        </div>

        <DialogFooter>
          <GlassButton variant="secondary" onClick={() => handleClose(false)}>
            {t("newFolderDialog.cancel")}
          </GlassButton>
          <GlassButton onClick={handleConfirm} disabled={!name.trim()}>
            {t("newFolderDialog.confirm")}
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
