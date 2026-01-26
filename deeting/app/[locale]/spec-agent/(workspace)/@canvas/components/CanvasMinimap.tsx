'use client'

import { useMemo } from 'react'
import type { SpecUiNode, SpecUiNodeStage } from '@/store/spec-agent-store'

interface CanvasMinimapProps {
  nodes: SpecUiNode[]
  canvasWidth: number
  canvasHeight: number
  viewport: {
    width: number
    height: number
    scrollLeft: number
    scrollTop: number
  }
  onNavigate: (x: number, y: number) => void
}

const MINIMAP_WIDTH = 180
const MINIMAP_HEIGHT = 120

const stageColorMap: Record<SpecUiNodeStage, string> = {
  search: 'fill-blue-500',
  process: 'fill-violet-500',
  summary: 'fill-emerald-500',
  action: 'fill-amber-500',
  unknown: 'fill-slate-400',
}

export function CanvasMinimap({
  nodes,
  canvasWidth,
  canvasHeight,
  viewport,
  onNavigate,
}: CanvasMinimapProps) {
  const scale = useMemo(() => {
    const safeWidth = Math.max(canvasWidth, 1)
    const safeHeight = Math.max(canvasHeight, 1)
    return {
      x: MINIMAP_WIDTH / safeWidth,
      y: MINIMAP_HEIGHT / safeHeight,
    }
  }, [canvasHeight, canvasWidth])

  const viewRect = useMemo(
    () => ({
      left: viewport.scrollLeft * scale.x,
      top: viewport.scrollTop * scale.y,
      width: viewport.width * scale.x,
      height: viewport.height * scale.y,
    }),
    [scale, viewport]
  )

  return (
    <div className="absolute bottom-4 right-4 z-20 rounded-lg border border-border/60 bg-card/90 backdrop-blur px-2 py-2 shadow-sm">
      <svg
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        className="cursor-pointer"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = (event.clientX - rect.left) / rect.width
          const y = (event.clientY - rect.top) / rect.height
          onNavigate(x * canvasWidth, y * canvasHeight)
        }}
      >
        <rect
          x={0}
          y={0}
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          rx={6}
          fill="var(--muted)"
          opacity={0.4}
        />
        {nodes.map((node) => {
          const cx = node.position.x * scale.x
          const cy = node.position.y * scale.y
          const stage = node.stage ?? 'unknown'
          const fillClass = stageColorMap[stage]
          return (
            <circle
              key={node.id}
              cx={cx}
              cy={cy}
              r={3.5}
              className={fillClass}
              opacity={node.status === 'active' ? 1 : 0.8}
            />
          )
        })}
        <rect
          x={viewRect.left}
          y={viewRect.top}
          width={Math.max(viewRect.width, 8)}
          height={Math.max(viewRect.height, 8)}
          rx={4}
          fill="transparent"
          stroke="var(--primary)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  )
}
