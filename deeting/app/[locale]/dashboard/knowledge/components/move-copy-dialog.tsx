"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Folder, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { GlassButton } from "@/components/ui/glass-button"
import { cn } from "@/lib/utils"
import type { KnowledgeFolder } from "@/types/knowledge"

interface MoveCopyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "move" | "copy"
  folders: KnowledgeFolder[]
  currentFolderId: string | null
  onConfirm: (targetFolderId: string | null) => void
}

export function MoveCopyDialog({
  open,
  onOpenChange,
  mode,
  folders,
  currentFolderId,
  onConfirm,
}: MoveCopyDialogProps) {
  const t = useTranslations("knowledge")
  const [selected, setSelected] = useState<string | null>(null)

  const title = mode === "move" ? t("moveCopyDialog.moveTitle") : t("moveCopyDialog.copyTitle")
  const confirmLabel =
    mode === "move" ? t("moveCopyDialog.confirmMove") : t("moveCopyDialog.confirmCopy")

  const handleConfirm = useCallback(() => {
    onConfirm(selected)
    onOpenChange(false)
  }, [selected, onConfirm, onOpenChange])

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setSelected(null)
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("moveCopyDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1 max-h-64 overflow-y-auto">
          {/* Root option */}
          <button
            onClick={() => setSelected(null)}
            disabled={currentFolderId === null}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left",
              selected === null
                ? "bg-[var(--primary)]/10 border border-[var(--primary)]/30"
                : "hover:bg-[var(--surface)]/60",
              currentFolderId === null && "opacity-40 pointer-events-none"
            )}
          >
            <Folder className="h-4 w-4 text-amber-500" />
            <span className="flex-1">{t("moveCopyDialog.root")}</span>
            {selected === null && <Check className="h-4 w-4 text-[var(--primary)]" />}
          </button>

          {/* Folder list */}
          {folders.map((folder) => {
            const isDisabled = folder.id === currentFolderId
            const isSelected = selected === folder.id

            return (
              <button
                key={folder.id}
                onClick={() => setSelected(folder.id)}
                disabled={isDisabled}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left",
                  isSelected
                    ? "bg-[var(--primary)]/10 border border-[var(--primary)]/30"
                    : "hover:bg-[var(--surface)]/60",
                  isDisabled && "opacity-40 pointer-events-none"
                )}
              >
                <Folder className="h-4 w-4 text-amber-500" />
                <span className="flex-1">{folder.name}</span>
                {isSelected && <Check className="h-4 w-4 text-[var(--primary)]" />}
              </button>
            )
          })}
        </div>

        <DialogFooter>
          <GlassButton variant="secondary" onClick={() => handleClose(false)}>
            {t("moveCopyDialog.cancel")}
          </GlassButton>
          <GlassButton onClick={handleConfirm}>{confirmLabel}</GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
