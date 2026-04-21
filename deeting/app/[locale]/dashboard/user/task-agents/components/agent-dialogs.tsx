"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/shadcn/alert-dialog"

type Translation = (key: string, values?: Record<string, string | number>) => string

type AgentDialogsProps = {
  t: Translation
  deleteDialogOpen: boolean
  discardDialogOpen: boolean
  selectedAgentName: string
  onDeleteOpenChange: (open: boolean) => void
  onDeleteConfirm: () => void
  onDiscardConfirm: () => void
  onDiscardCancel: () => void
}

export function AgentDialogs({
  t,
  deleteDialogOpen,
  discardDialogOpen,
  selectedAgentName,
  onDeleteOpenChange,
  onDeleteConfirm,
  onDiscardConfirm,
  onDiscardCancel,
}: AgentDialogsProps) {
  return (
    <>
      <AlertDialog open={deleteDialogOpen} onOpenChange={onDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialog.description", { name: selectedAgentName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteConfirm}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t("deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={discardDialogOpen}
        onOpenChange={(open) => { if (!open) onDiscardCancel() }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discardDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("discardDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onDiscardCancel}>
              {t("discardDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onDiscardConfirm}>
              {t("discardDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
