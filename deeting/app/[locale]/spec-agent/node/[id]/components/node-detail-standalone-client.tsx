'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useChatService } from '@/hooks/use-chat-service'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import {
  useSpecPlanNodeDetail,
  useSpecPlanNodeEvent,
  useSpecPlanNodeUpdate,
  useSpecPlanNodeRerun,
} from '@/lib/swr/use-spec-agent'
import { NodeDetailContent } from '@/app/[locale]/spec-agent/(workspace)/@modal/(.)node/[id]/components/node-detail-content'
import { NodeDetailRerunDialog } from '@/app/[locale]/spec-agent/(workspace)/@modal/(.)node/[id]/components/node-detail-rerun-dialog'

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
  const { data: nodeDetail } = useSpecPlanNodeDetail(planId, params.id, {
    enabled: Boolean(planId),
  })
  const { modelGroups, isLoadingModels } = useChatService({
    modelCapability: 'chat',
  })
  const { update, updateState } = useSpecPlanNodeUpdate(planId)
  const { rerun, rerunState } = useSpecPlanNodeRerun(planId)
  const { send: sendNodeEvent } = useSpecPlanNodeEvent(planId)

  const rawNode = nodeDetail?.node ?? node?.raw
  const isAction = rawNode?.type === 'action'
  const currentOverride = isAction ? node?.modelOverride ?? null : null
  const AUTO_VALUE = '__auto__'
  const [selectedModel, setSelectedModel] = useState(
    currentOverride ?? AUTO_VALUE
  )
  const [instruction, setInstruction] = useState(
    rawNode?.type === 'action'
      ? rawNode.pending_instruction ?? rawNode.instruction ?? ''
      : ''
  )

  useEffect(() => {
    setSelectedModel(currentOverride ?? AUTO_VALUE)
  }, [AUTO_VALUE, currentOverride, params.id])

  useEffect(() => {
    if (rawNode?.type === 'action') {
      setInstruction(rawNode.pending_instruction ?? rawNode.instruction ?? '')
    }
  }, [params.id, rawNode])

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
  const instructionStatus = nodeDetail?.execution?.status ?? node?.status
  const instructionMode =
    instructionStatus === 'active'
      ? 'shadow'
      : instructionStatus === 'waiting' || instructionStatus === 'pending'
        ? 'edit'
        : 'locked'
  const currentInstruction =
    rawNode?.type === 'action'
      ? rawNode.pending_instruction ?? rawNode.instruction ?? ''
      : ''
  const nextInstruction = instruction.trim()
  const instructionDirty =
    rawNode?.type === 'action' && nextInstruction !== currentInstruction
  const isDirty = nextOverride !== currentOverride || instructionDirty
  const instructionNote =
    instructionMode === 'shadow' && rawNode?.pending_instruction
      ? t('node.modal.instructionShadowSaved')
      : null
  const pendingInstruction =
    rawNode?.type === 'action' ? rawNode.pending_instruction ?? null : null
  const canRerunPending =
    Boolean(pendingInstruction) &&
    ['completed', 'error', 'waiting'].includes(
      nodeDetail?.execution?.status ?? node?.status ?? 'pending'
    )
  const [rerunDialogOpen, setRerunDialogOpen] = useState(false)
  const lastPromptRef = useRef<string | null>(null)
  const executionStatus = nodeDetail?.execution?.status ?? node?.status ?? 'pending'
  const isSaving = updateState.isMutating

  const handleSave = async () => {
    if (!planId || !isAction || !node) return
    if (!isDirty) return
    await update(node.id, {
      ...(nextOverride !== currentOverride && { modelOverride: nextOverride }),
      ...(instructionDirty && instructionMode !== 'locked' && {
        instruction: nextInstruction,
      }),
    })
  }

  const handleRerun = async () => {
    if (!planId || !node || !pendingInstruction) return
    await rerun(node.id)
  }

  useEffect(() => {
    if (!pendingInstruction) return
    if (!['completed', 'error'].includes(executionStatus)) return
    const key = `${params.id}-${pendingInstruction}`
    if (lastPromptRef.current === key) return
    lastPromptRef.current = key
    setRerunDialogOpen(true)
    if (planId) {
      void sendNodeEvent(params.id, 'rerun_prompt', 'auto_drawer')
    }
  }, [executionStatus, params.id, pendingInstruction, planId, sendNodeEvent])

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
              nodeDetail={nodeDetail ?? null}
              isAction={isAction}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              instruction={instruction}
              setInstruction={setInstruction}
              instructionMode={instructionMode}
              instructionNote={instructionNote}
              pendingInstruction={pendingInstruction}
              canRerunPending={canRerunPending}
              isRerunning={rerunState.isMutating}
              onRerunPending={handleRerun}
              isSaving={isSaving}
              isLoadingModels={isLoadingModels}
              isUnknownModel={isUnknownModel}
              modelGroups={modelGroups}
              updateError={Boolean(updateState.error)}
            />
          </div>
        </div>
      </div>

      <NodeDetailRerunDialog
        t={t}
        open={rerunDialogOpen}
        pendingInstruction={pendingInstruction ?? ''}
        isRerunning={rerunState.isMutating}
        onOpenChange={setRerunDialogOpen}
        onConfirm={handleRerun}
      />
    </div>
  )
}

export default memo(NodeDetailStandaloneClient)
