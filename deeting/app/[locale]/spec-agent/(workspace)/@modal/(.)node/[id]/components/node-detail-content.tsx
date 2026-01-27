'use client'

import { memo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  const detailNode = nodeDetail?.node ?? rawNode
  if (!node && !detailNode) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t('node.modal.notFound')}
      </div>
    )
  }

  const resolveTitle = (target?: SpecNode) => {
    if (!target) return null
    if (target.desc) return target.desc
    if (target.type === 'action') return target.instruction
    if (target.type === 'logic_gate') {
      return target.rules?.[0]?.desc ?? target.id
    }
    if (target.type === 'replan_trigger') return target.reason
    return target.id
  }

  const normalizeDuration = (durationMs?: number | null) => {
    if (!durationMs || durationMs <= 0) return null
    const seconds = durationMs / 1000
    if (seconds < 1) return `${seconds.toFixed(2)}s`
    if (seconds < 10) return `${seconds.toFixed(1)}s`
    return `${seconds.toFixed(0)}s`
  }

  const detailStatus = nodeDetail?.execution?.status ?? node?.status ?? 'pending'
  const nodeType = detailNode?.type ?? rawNode?.type
  const title = node?.title ?? resolveTitle(detailNode) ?? detailNode?.id ?? ''
  const duration =
    node?.duration ?? normalizeDuration(nodeDetail?.execution?.duration_ms)

  return (
    <ScrollArea className="h-full max-h-[calc(100vh-16rem)] pr-1">
      <div className="space-y-5 pr-2">
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {t('node.modal.fields.type')}
              </Label>
              <p className="text-sm text-foreground">
                {nodeType === 'logic_gate'
                  ? t('canvas.node.type.logic')
                  : nodeType === 'replan_trigger'
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
                {duration ?? t('node.modal.durationPlaceholder')}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {t('node.modal.fields.title')}
              </Label>
              <p className="text-sm text-foreground">{title}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
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
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
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
            className="min-h-[110px] bg-background/80"
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

        <NodeDetailPendingAction
          t={t}
          pendingInstruction={pendingInstruction ?? ''}
          canRerun={canRerunPending}
          isRerunning={isRerunning}
          onRerun={onRerunPending}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
            <NodeDetailLineage t={t} rawNode={detailNode} nodeDetail={nodeDetail} />
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
            <NodeDetailTimeline t={t} nodeDetail={nodeDetail} />
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
          <NodeDetailPayload t={t} nodeDetail={nodeDetail} />
        </div>

        {pendingInstruction && rawNode?.type === 'action' && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
            <NodeDetailInstructionDiff
              t={t}
              original={rawNode.instruction ?? ''}
              updated={pendingInstruction}
            />
          </div>
        )}

        {detailStatus === 'waiting' && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            {t('node.modal.waitingHint')}
          </div>
        )}
      </div>
    </ScrollArea>
  )
})
