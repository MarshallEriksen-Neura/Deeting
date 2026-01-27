'use client'

import { memo } from 'react'

export const CanvasEmptyState = memo(function CanvasEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-4">🎯</div>
        <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  )
})
