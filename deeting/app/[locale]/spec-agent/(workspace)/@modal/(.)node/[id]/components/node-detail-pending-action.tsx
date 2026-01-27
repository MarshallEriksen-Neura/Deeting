'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

type NodeDetailPendingActionProps = {
  t: (key: string, params?: Record<string, string>) => string
  pendingInstruction: string
  canRerun: boolean
  isRerunning: boolean
  onRerun: () => void
}

export const NodeDetailPendingAction = memo(function NodeDetailPendingAction({
  t,
  pendingInstruction,
  canRerun,
  isRerunning,
  onRerun,
}: NodeDetailPendingActionProps) {
  if (!pendingInstruction) return null

  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
      <Label className="text-xs text-sky-500/80">
        {t('node.modal.pendingInstruction')}
      </Label>
      <div className="text-sm text-foreground line-clamp-2">
        {pendingInstruction}
      </div>
      <Button
        size="sm"
        onClick={onRerun}
        disabled={!canRerun || isRerunning}
      >
        {isRerunning ? t('node.modal.rerunRunning') : t('node.modal.rerun')}
      </Button>
    </div>
  )
})
