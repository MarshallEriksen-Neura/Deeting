'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useChatService } from '@/hooks/use-chat-service'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useSpecPlanNodeUpdate } from '@/lib/swr/use-spec-agent'
import { NodeDetailContent } from '@/app/[locale]/spec-agent/(workspace)/@modal/(.)node/[id]/components/node-detail-content'

export type NodeDetailStandaloneProps = {
  params: { id: string }
}

function NodeDetailStandaloneClient({ params }: NodeDetailStandaloneProps) {
  const router = useRouter()
  const t = useI18n('spec-agent')
  const planId = useSpecAgentStore((state) => state.planId)
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
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">
              {t('node.modal.title', { id: params.id })}
            </h1>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.back()}>
                {t('node.modal.close')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={!node || !isAction || !isDirty || isSaving}
              >
                {isSaving ? t('node.modal.saving') : t('node.modal.save')}
              </Button>
            </div>
          </div>

          <div className="bg-card rounded-lg p-6">
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
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(NodeDetailStandaloneClient)
