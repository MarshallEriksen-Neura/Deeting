'use client'

import { memo, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import type { SpecNode, SpecPlanNodeDetail } from '@/lib/api/spec-agent'

type NodeDetailLineageProps = {
  t: (key: string, params?: Record<string, string>) => string
  rawNode: SpecNode | undefined
  nodeDetail: SpecPlanNodeDetail | null
}

export const NodeDetailLineage = memo(function NodeDetailLineage({
  t,
  rawNode,
  nodeDetail,
}: NodeDetailLineageProps) {
  const node = nodeDetail?.node ?? rawNode
  const execution = nodeDetail?.execution

  const sourceText = useMemo(() => {
    if (!node) return t('node.modal.lineage.root')
    const needs = Array.isArray(node.needs) ? node.needs : []
    if (!needs.length) return t('node.modal.lineage.root')
    return needs.join(' → ')
  }, [node, t])

  const transformText = useMemo(() => {
    if (!node) return t('node.modal.lineage.pending')
    if (node.type === 'logic_gate') {
      return node.input || t('node.modal.lineage.transform.logic')
    }
    if (node.type === 'replan_trigger') {
      return node.reason || t('node.modal.lineage.transform.replan')
    }
    return node.instruction || t('node.modal.lineage.transform.action')
  }, [node, t])

  const resultText = useMemo(() => {
    if (!node) return t('node.modal.lineage.pending')
    const output = (node as { output_as?: string | null }).output_as
    if (output) return output
    if (execution?.output_data) return t('node.modal.lineage.resultJson')
    return t('node.modal.lineage.pending')
  }, [execution?.output_data, node, t])

  if (!node) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">
          {t('node.modal.lineage.title')}
        </Label>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
          {node.type === 'logic_gate'
            ? t('canvas.node.type.logic')
            : node.type === 'replan_trigger'
              ? t('canvas.node.type.replan')
              : t('canvas.node.type.action')}
        </Badge>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t('node.modal.lineage.source')}
          </span>
          <span className="text-foreground">{sourceText}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t('node.modal.lineage.transformLabel')}
          </span>
          <span className="text-foreground">{transformText}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t('node.modal.lineage.result')}
          </span>
          <span className="text-foreground">{resultText}</span>
        </div>
      </div>
    </div>
  )
})
