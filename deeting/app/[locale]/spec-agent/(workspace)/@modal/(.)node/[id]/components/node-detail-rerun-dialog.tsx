'use client'

import { memo } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type NodeDetailRerunDialogProps = {
  t: (key: string) => string
  open: boolean
  pendingInstruction: string
  isRerunning: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export const NodeDetailRerunDialog = memo(function NodeDetailRerunDialog({
  t,
  open,
  pendingInstruction,
  isRerunning,
  onOpenChange,
  onConfirm,
}: NodeDetailRerunDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('node.modal.rerunDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('node.modal.rerunDialog.desc')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
          {pendingInstruction}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('node.modal.rerunDialog.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isRerunning}>
            {isRerunning
              ? t('node.modal.rerunRunning')
              : t('node.modal.rerunDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
})
