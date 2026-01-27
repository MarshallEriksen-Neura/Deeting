'use client'

import { memo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { SpecUiNode } from '@/store/spec-agent-store'
import type { SpecNode, SpecPlanNodeDetail } from '@/lib/api/spec-agent'
import { NodeDetailLineage } from './node-detail-lineage'
import { NodeDetailTimeline } from './node-detail-timeline'
import { NodeDetailPayload } from './node-detail-payload'
import { NodeDetailModel } from './node-detail-model'
import { NodeDetailPendingAction } from './node-detail-pending-action'
import { NodeDetailInstructionDiff } from './node-detail-instruction-diff'

type NodeDetailContentProps = {
  t: (key: string, params?: Record<string, string>) => string
  node: SpecUiNode | undefined
  rawNode: SpecNode | undefined
  nodeDetail: SpecPlanNodeDetail | null
  isAction: boolean
  selectedModel: string
  setSelectedModel: (value: string) => void
  instruction: string
  setInstruction: (value: string) => void
  instructionMode: 'edit' | 'shadow' | 'locked'
  instructionNote?: string | null
  pendingInstruction: string | null
  canRerunPending: boolean
  isRerunning: boolean
  onRerunPending: () => void
  isSaving: boolean
  isLoadingModels: boolean
  isUnknownModel: boolean
  modelGroups: Array<{
    instance_id: string
    instance_name: string
    provider?: string
    models: Array<{ id: string; owned_by?: string }>
  }>
  updateError: boolean
}

export const NodeDetailContent = memo(function NodeDetailContent({
  t,
  node,
  rawNode,
  nodeDetail,
  isAction,
  selectedModel,
  setSelectedModel,
  instruction,
  setInstruction,
  instructionMode,
  instructionNote,
  pendingInstruction,
  canRerunPending,
  isRerunning,
  onRerunPending,
  isSaving,
  isLoadingModels,
  isUnknownModel,
  modelGroups,
  updateError,
}: NodeDetailContentProps) {
  if (!node) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t('node.modal.notFound')}
      </div>
    )
  }

  const detailNode = nodeDetail?.node ?? rawNode
  const detailStatus = nodeDetail?.execution?.status ?? node.status

  return (
    <ScrollArea className="h-[calc(100vh-14rem)] pr-1">
      <div className="space-y-4 pr-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.type')}
            </Label>
            <p className="text-sm text-foreground">
              {rawNode?.type === 'logic_gate'
                ? t('canvas.node.type.logic')
                : rawNode?.type === 'replan_trigger'
                  ? t('canvas.node.type.replan')
                  : t('canvas.node.type.action')}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.status')}
            </Label>
            <Badge variant="outline">
              {t(`node.modal.status.${detailStatus}`)}
            </Badge>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.duration')}
            </Label>
            <p className="text-sm text-foreground">
              {node.duration ?? t('node.modal.durationPlaceholder')}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.title')}
            </Label>
            <p className="text-sm text-foreground">{node.title}</p>
          </div>
        </div>

        <NodeDetailModel
          t={t}
          isAction={isAction}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          isSaving={isSaving}
          isLoadingModels={isLoadingModels}
          isUnknownModel={isUnknownModel}
          modelGroups={modelGroups}
          updateError={updateError}
        />

        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground">
            {t('node.modal.fields.instruction')}
          </Label>
          <Textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={
              instructionMode === 'shadow'
                ? t('node.modal.instructionShadowPlaceholder')
                : t('node.modal.instructionPlaceholder')
            }
            disabled={!isAction || instructionMode === 'locked'}
            className="min-h-[96px]"
          />
          <p className="text-xs text-muted-foreground">
            {instructionMode === 'shadow'
              ? t('node.modal.instructionShadowHint')
              : instructionMode === 'edit'
                ? t('node.modal.instructionHint')
                : t('node.modal.instructionDisabled')}
          </p>
          {instructionNote && (
            <p className="text-xs text-sky-500/80">{instructionNote}</p>
          )}
        </div>

        <NodeDetailLineage t={t} rawNode={detailNode} nodeDetail={nodeDetail} />

        <NodeDetailTimeline t={t} nodeDetail={nodeDetail} />

        <NodeDetailPayload t={t} nodeDetail={nodeDetail} />

        <NodeDetailPendingAction
          t={t}
          pendingInstruction={pendingInstruction ?? ''}
          canRerun={canRerunPending}
          isRerunning={isRerunning}
          onRerun={onRerunPending}
        />

        {pendingInstruction && rawNode?.type === 'action' && (
          <>
            <Separator />
            <NodeDetailInstructionDiff
              t={t}
              original={rawNode.instruction ?? ''}
              updated={pendingInstruction}
            />
          </>
        )}

        {detailStatus === 'waiting' && (
          <>
            <Separator />
            <div className="text-xs text-amber-600">
              {t('node.modal.waitingHint')}
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  )
})
