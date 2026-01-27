'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChatService } from '@/hooks/use-chat-service'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import {
  useSpecPlanNodeDetail,
  useSpecPlanNodeEvent,
  useSpecPlanNodeUpdate,
  useSpecPlanNodeRerun,
} from '@/lib/swr/use-spec-agent'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { NodeDetailContent } from './node-detail-content'
import { NodeDetailFooter } from './node-detail-footer'
import { NodeDetailRerunDialog } from './node-detail-rerun-dialog'

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

  const handleClose = () => {
    setSelectedNodeId(null)
    router.back()
  }

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
    <Sheet open={true} onOpenChange={handleClose}>
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('node.modal.title', { id: params.id })}</SheetTitle>
        </SheetHeader>

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

      <NodeDetailRerunDialog
        t={t}
        open={rerunDialogOpen}
        pendingInstruction={pendingInstruction ?? ''}
        isRerunning={rerunState.isMutating}
        onOpenChange={setRerunDialogOpen}
        onConfirm={handleRerun}
      />
    </Sheet>
  )
}

export default memo(NodeDetailDrawerClient)
