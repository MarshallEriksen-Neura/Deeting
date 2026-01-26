'use client'

import { useMemo, useRef, useState } from 'react'
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
  criticalNodes?: Set<string>
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
  criticalNodes,
  onNavigate,
}: CanvasMinimapProps) {
  const draggingRef = useRef(false)
  const [dragPosition, setDragPosition] = useState<{
    x: number
    y: number
  } | null>(null)

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

  const dragRect = useMemo(() => {
    if (!dragPosition) return null
    const rawLeft = dragPosition.x * MINIMAP_WIDTH - viewRect.width / 2
    const rawTop = dragPosition.y * MINIMAP_HEIGHT - viewRect.height / 2
    const left = Math.max(0, Math.min(rawLeft, MINIMAP_WIDTH - viewRect.width))
    const top = Math.max(0, Math.min(rawTop, MINIMAP_HEIGHT - viewRect.height))
    return { left, top, width: viewRect.width, height: viewRect.height }
  }, [dragPosition, viewRect])

  return (
    <div className="absolute bottom-4 right-4 z-20 rounded-lg border border-border/60 bg-card/90 backdrop-blur px-2 py-2 shadow-sm">
      <svg
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        className="cursor-pointer touch-none"
        onPointerDown={(event) => {
          draggingRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          const rect = event.currentTarget.getBoundingClientRect()
          const x = Math.min(
            Math.max((event.clientX - rect.left) / rect.width, 0),
            1
          )
          const y = Math.min(
            Math.max((event.clientY - rect.top) / rect.height, 0),
            1
          )
          setDragPosition({ x, y })
          onNavigate(x * canvasWidth, y * canvasHeight)
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return
          const rect = event.currentTarget.getBoundingClientRect()
          const x = Math.min(
            Math.max((event.clientX - rect.left) / rect.width, 0),
            1
          )
          const y = Math.min(
            Math.max((event.clientY - rect.top) / rect.height, 0),
            1
          )
          setDragPosition({ x, y })
          onNavigate(x * canvasWidth, y * canvasHeight)
        }}
        onPointerUp={(event) => {
          draggingRef.current = false
          event.currentTarget.releasePointerCapture(event.pointerId)
          setDragPosition(null)
        }}
        onPointerLeave={() => {
          draggingRef.current = false
          setDragPosition(null)
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
          const isCritical = criticalNodes?.has(node.id)
          return (
            <circle
              key={node.id}
              cx={cx}
              cy={cy}
              r={isCritical ? 4.5 : 3.5}
              className={fillClass}
              opacity={node.status === 'active' ? 1 : 0.8}
              stroke={isCritical ? 'var(--primary)' : 'transparent'}
              strokeWidth={isCritical ? 1.2 : 0}
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
        {dragRect && (
          <rect
            x={dragRect.left}
            y={dragRect.top}
            width={Math.max(dragRect.width, 8)}
            height={Math.max(dragRect.height, 8)}
            rx={4}
            fill="var(--primary)"
            fillOpacity={0.08}
            stroke="var(--primary)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
      </svg>
    </div>
  )
}
