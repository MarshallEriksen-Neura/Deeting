'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { SheetFooter } from '@/components/ui/sheet'

type NodeDetailFooterProps = {
  t: (key: string) => string
  hasNode: boolean
  isAction: boolean
  isDirty: boolean
  isSaving: boolean
  onClose: () => void
  onSave: () => void
}

export const NodeDetailFooter = memo(function NodeDetailFooter({
  t,
  hasNode,
  isAction,
  isDirty,
  isSaving,
  onClose,
  onSave,
}: NodeDetailFooterProps) {
  return (
    <SheetFooter className="gap-2 justify-end p-0 flex-row">
      <Button variant="outline" size="sm" onClick={onClose}>
        {t('node.modal.close')}
      </Button>
      <Button
        size="sm"
        onClick={onSave}
        disabled={!hasNode || !isAction || !isDirty || isSaving}
      >
        {isSaving ? t('node.modal.saving') : t('node.modal.save')}
      </Button>
    </SheetFooter>
  )
})
