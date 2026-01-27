'use client'

import { memo, useEffect, useState } from 'react'
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
  const [displayProgress, setDisplayProgress] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDisplayProgress(progress)
    })
    return () => cancelAnimationFrame(frame)
  }, [progress])

  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Clock className="w-4 h-4" />
        <span className="font-medium text-foreground/80">{statusLabel}</span>
      </div>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <DollarSign className="w-4 h-4" />
        <span className="font-medium text-foreground/80">{costLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={displayProgress} className="w-36 transition-all" />
        <span className="text-xs font-semibold text-foreground/80">
          {progress}%
        </span>
      </div>
      <div className="text-sm text-muted-foreground font-medium">
        {nodesLabel}
      </div>
    </div>
  )
})
