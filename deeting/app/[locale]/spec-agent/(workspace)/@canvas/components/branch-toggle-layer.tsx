'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'

type BranchToggle = {
  id: string
  position: { x: number; y: number }
  hiddenCount: number
  collapsed: boolean
}

export const BranchToggleLayer = memo(function BranchToggleLayer({
  toggles,
  disabled,
  onToggle,
}: {
  toggles: BranchToggle[]
  disabled: boolean
  onToggle: (id: string) => void
}) {
  return (
    <>
      {toggles.map((toggle) => (
        <div
          key={toggle.id}
          className="absolute z-20"
          style={{
            left: toggle.position.x + 80,
            top: toggle.position.y - 8,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-[10px] font-semibold shadow-sm"
            disabled={disabled}
            onClick={() => onToggle(toggle.id)}
          >
            {toggle.collapsed
              ? `+${toggle.hiddenCount}`
              : `-${toggle.hiddenCount}`}
          </Button>
        </div>
      ))}
    </>
  )
})
