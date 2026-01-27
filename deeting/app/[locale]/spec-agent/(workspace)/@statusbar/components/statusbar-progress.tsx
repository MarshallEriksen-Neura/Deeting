'use client'

import { memo } from 'react'
import { Clock, DollarSign } from 'lucide-react'
import { Progress } from '@/components/ui/progress'

export const StatusProgress = memo(function StatusProgress({
  statusLabel,
  costLabel,
  progress,
  nodesLabel,
}: {
  statusLabel: string
  costLabel: string
  progress: number
  nodesLabel: string
}) {
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Clock className="w-4 h-4" />
        <span>{statusLabel}</span>
      </div>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <DollarSign className="w-4 h-4" />
        <span>{costLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={progress} className="w-32" />
        <span className="text-xs text-muted-foreground">{progress}%</span>
      </div>
      <div className="text-sm text-muted-foreground">{nodesLabel}</div>
    </div>
  )
})
