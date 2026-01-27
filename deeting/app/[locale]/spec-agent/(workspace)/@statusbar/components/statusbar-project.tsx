'use client'

import { memo } from 'react'

export const StatusProjectInfo = memo(function StatusProjectInfo({
  label,
  projectName,
}: {
  label: string
  projectName: string
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">{projectName}</span>
      </div>
    </div>
  )
})
