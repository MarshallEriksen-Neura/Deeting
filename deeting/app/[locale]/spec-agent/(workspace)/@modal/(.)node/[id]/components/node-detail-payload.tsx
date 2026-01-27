'use client'

import { memo, useMemo } from 'react'
import { Label } from '@/components/ui/label'
import type { SpecPlanNodeDetail } from '@/lib/api/spec-agent'

type NodeDetailPayloadProps = {
  t: (key: string, params?: Record<string, string>) => string
  nodeDetail: SpecPlanNodeDetail | null
}

const formatJson = (value: unknown) => {
  if (!value) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const NodeDetailPayload = memo(function NodeDetailPayload({
  t,
  nodeDetail,
}: NodeDetailPayloadProps) {
  const execution = nodeDetail?.execution
  const inputText = useMemo(
    () => formatJson(execution?.input_snapshot),
    [execution?.input_snapshot]
  )
  const rawText = useMemo(() => {
    if (execution?.raw_response) return formatJson(execution.raw_response)
    if (execution?.output_data) return formatJson(execution.output_data)
    return ''
  }, [execution?.output_data, execution?.raw_response])

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground">
        {t('node.modal.payload.title')}
      </Label>
      <div className="space-y-3">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">
            {t('node.modal.payload.input')}
          </span>
          <pre className="text-xs bg-background/80 border border-border/60 p-3 rounded-md overflow-x-auto font-mono">
            {inputText || t('node.modal.payload.empty')}
          </pre>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">
            {t('node.modal.payload.raw')}
          </span>
          <pre className="text-xs bg-background/80 border border-border/60 p-3 rounded-md overflow-x-auto font-mono">
            {rawText || t('node.modal.payload.empty')}
          </pre>
        </div>
      </div>
    </div>
  )
})
