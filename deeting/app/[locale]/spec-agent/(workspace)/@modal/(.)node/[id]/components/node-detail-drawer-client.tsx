'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChatService } from '@/hooks/use-chat-service'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useSpecPlanNodeUpdate } from '@/lib/swr/use-spec-agent'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { NodeDetailContent } from './node-detail-content'
import { NodeDetailFooter } from './node-detail-footer'

interface NodeDetailDrawerClientProps {
  params: {
    id: string
  }
}

function NodeDetailDrawerClient({ params }: NodeDetailDrawerClientProps) {
  const router = useRouter()
  const t = useI18n('spec-agent')
  const planId = useSpecAgentStore((state) => state.planId)
  const setSelectedNodeId = useSpecAgentStore((state) => state.setSelectedNodeId)
  const node = useSpecAgentStore((state) =>
    state.nodes.find((item) => item.id === params.id)
  )
  const { modelGroups, isLoadingModels } = useChatService({
    modelCapability: 'chat',
  })
  const { update, updateState } = useSpecPlanNodeUpdate(planId)

  const rawNode = node?.raw
  const isAction = rawNode?.type === 'action'
  const currentOverride = isAction ? node?.modelOverride ?? null : null
  const AUTO_VALUE = '__auto__'
  const [selectedModel, setSelectedModel] = useState(
    currentOverride ?? AUTO_VALUE
  )

  const handleClose = () => {
    setSelectedNodeId(null)
    router.back()
  }

  useEffect(() => {
    setSelectedModel(currentOverride ?? AUTO_VALUE)
  }, [AUTO_VALUE, currentOverride, params.id])

  const knownModelValues = useMemo(() => {
    const values = new Set<string>()
    modelGroups.forEach((group) => {
      group.models.forEach((model) => {
        values.add(model.id)
      })
    })
    return values
  }, [modelGroups])

  const isUnknownModel =
    selectedModel !== AUTO_VALUE && !knownModelValues.has(selectedModel)
  const nextOverride = selectedModel === AUTO_VALUE ? null : selectedModel
  const isDirty = nextOverride !== currentOverride
  const isSaving = updateState.isMutating

  const handleSave = async () => {
    if (!planId || !isAction || !node) return
    await update(node.id, nextOverride)
  }

  return (
    <Sheet open={true} onOpenChange={handleClose}>
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('node.modal.title', { id: params.id })}</SheetTitle>
        </SheetHeader>

        <NodeDetailContent
          t={t}
          node={node}
          rawNode={rawNode}
          isAction={isAction}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          isSaving={isSaving}
          isLoadingModels={isLoadingModels}
          isUnknownModel={isUnknownModel}
          modelGroups={modelGroups}
          updateError={Boolean(updateState.error)}
        />

        <NodeDetailFooter
          t={t}
          isSaving={isSaving}
          isDirty={isDirty}
          isAction={isAction}
          hasNode={Boolean(node)}
          onClose={handleClose}
          onSave={handleSave}
        />
      </SheetContent>
    </Sheet>
  )
}

export default memo(NodeDetailDrawerClient)
