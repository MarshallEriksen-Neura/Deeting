'use client'

import { memo, useMemo } from 'react'
import { Label } from '@/components/ui/label'
import type { SpecPlanNodeDetail } from '@/lib/api/spec-agent'

type NodeDetailTimelineProps = {
  t: (key: string, params?: Record<string, string>) => string
  nodeDetail: SpecPlanNodeDetail | null
}

const formatTimestamp = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export const NodeDetailTimeline = memo(function NodeDetailTimeline({
  t,
  nodeDetail,
}: NodeDetailTimelineProps) {
  const execution = nodeDetail?.execution
  const timeline = useMemo(
    () => [
      { key: 'created', value: formatTimestamp(execution?.created_at) },
      { key: 'started', value: formatTimestamp(execution?.started_at) },
      { key: 'completed', value: formatTimestamp(execution?.completed_at) },
    ],
    [execution?.completed_at, execution?.created_at, execution?.started_at]
  )

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground">
        {t('node.modal.timeline.title')}
      </Label>
      <div className="grid gap-2 text-sm">
        {timeline.map((item) => (
          <div key={item.key} className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t(`node.modal.timeline.${item.key}`)}
            </span>
            <span className="text-foreground">
              {item.value || t('node.modal.timeline.pending')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
})
