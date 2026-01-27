import { useMemo } from 'react'
import type { SpecUiNode } from '@/store/spec-agent-store'
import type { CanvasViewport } from './use-canvas-viewport'

export const useCanvasBounds = (
  nodes: SpecUiNode[],
  viewport: CanvasViewport
) => {
  const bounds = useMemo(() => {
    if (!nodes.length) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    }
    return nodes.reduce(
      (acc, node) => ({
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x),
        maxY: Math.max(acc.maxY, node.position.y),
      }),
      {
        minX: nodes[0]?.position.x ?? 0,
        minY: nodes[0]?.position.y ?? 0,
        maxX: nodes[0]?.position.x ?? 0,
        maxY: nodes[0]?.position.y ?? 0,
      }
    )
  }, [nodes])

  const canvasPadding = 240
  const canvasWidth = Math.max(bounds.maxX + canvasPadding, viewport.width || 1200)
  const canvasHeight = Math.max(
    bounds.maxY + canvasPadding,
    viewport.height || 800
  )

  return { bounds, canvasWidth, canvasHeight }
}
