'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
  const setSelectedNodeId = useSpecAgentStore((state) => state.setSelectedNodeId)
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

  const handleClose = () => {
    setSelectedNodeId(null)
    router.back()
  }

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
    <Sheet open={true} onOpenChange={handleClose}>
      <SheetContent side="right" className="sm:max-w-xl w-full p-0 h-full max-h-screen">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/60 bg-background/90 backdrop-blur px-6 py-4">
            <SheetTitle className="text-base font-semibold text-foreground">
              {t('node.modal.title', { id: nodeId ?? '' })}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
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

          <div className="border-t border-border/60 bg-background/95 px-6 py-3">
            <NodeDetailFooter
              t={t}
              isSaving={isSaving}
              isDirty={isDirty}
              isAction={isAction}
              hasNode={Boolean(node)}
              onClose={handleClose}
              onSave={handleSave}
            />
          </div>
        </div>
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
