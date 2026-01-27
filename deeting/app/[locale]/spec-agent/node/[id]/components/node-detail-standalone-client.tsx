'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useChatService } from '@/hooks/use-chat-service'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import {
  useSpecPlanDetail,
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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryPlanId = useMemo(
    () => searchParams?.get('plan')?.trim() || null,
    [searchParams]
  )
  const [restoredPlanId, setRestoredPlanId] = useState<string | null>(null)
  const activePlanId = queryPlanId ?? planId ?? restoredPlanId
  const fallbackNodeId = useMemo(() => {
    if (!pathname) return null
    const parts = pathname.split('/')
    return parts[parts.length - 1] || null
  }, [pathname])
  const nodeId = params.id || fallbackNodeId
  const node = useSpecAgentStore((state) =>
    state.nodes.find((item) => item.id === nodeId)
  )
  useSpecPlanDetail(activePlanId, { enabled: Boolean(activePlanId) })
  const { data: nodeDetail } = useSpecPlanNodeDetail(activePlanId, nodeId, {
    enabled: Boolean(activePlanId && nodeId),
  })
  const { modelGroups, isLoadingModels } = useChatService({
    modelCapability: 'chat',
  })
  const { update, updateState } = useSpecPlanNodeUpdate(activePlanId)
  const { rerun, rerunState } = useSpecPlanNodeRerun(activePlanId)
  const { send: sendNodeEvent } = useSpecPlanNodeEvent(activePlanId)

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
  }, [AUTO_VALUE, currentOverride, nodeId])

  useEffect(() => {
    if (rawNode?.type === 'action') {
      setInstruction(rawNode.pending_instruction ?? rawNode.instruction ?? '')
    }
  }, [nodeId, rawNode])

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
    if (!activePlanId || !isAction || !node) return
    if (!isDirty) return
    await update(node.id, {
      ...(nextOverride !== currentOverride && { modelOverride: nextOverride }),
      ...(instructionDirty && instructionMode !== 'locked' && {
        instruction: nextInstruction,
      }),
    })
  }

  const handleRerun = async () => {
    if (!activePlanId || !node || !pendingInstruction) return
    await rerun(node.id)
  }

  useEffect(() => {
    if (planId || queryPlanId || typeof window === 'undefined') return
    const stored = localStorage.getItem('deeting-spec-agent:last-plan')
    if (!stored || stored === restoredPlanId) return
    setRestoredPlanId(stored)
  }, [planId, queryPlanId, restoredPlanId])

  useEffect(() => {
    if (!pendingInstruction) return
    if (!['completed', 'error'].includes(executionStatus)) return
    const key = `${nodeId ?? 'unknown'}-${pendingInstruction}`
    if (lastPromptRef.current === key) return
    lastPromptRef.current = key
    setRerunDialogOpen(true)
    if (activePlanId && nodeId) {
      void sendNodeEvent(nodeId, 'rerun_prompt', 'auto_drawer')
    }
  }, [
    activePlanId,
    executionStatus,
    nodeId,
    pendingInstruction,
    sendNodeEvent,
  ])

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">
              {t('node.modal.title', { id: nodeId ?? '' })}
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
