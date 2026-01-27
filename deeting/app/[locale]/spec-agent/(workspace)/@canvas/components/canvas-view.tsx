'use client'

import type { RefObject } from 'react'
import { memo } from 'react'
import type { SpecConnection } from '@/lib/api/spec-agent'
import type { SpecUiNode } from '@/store/spec-agent-store'
import { CanvasMinimap } from './CanvasMinimap'
import { CanvasScene } from './canvas-scene'
import { CanvasEmptyState } from './canvas-empty'
import type { CanvasStageLane } from '../hooks/use-stage-lanes'
import type { CanvasViewport } from '../hooks/use-canvas-viewport'

type CanvasViewProps = {
  t: (key: string, params?: Record<string, string | number>) => string
  scrollRef: RefObject<HTMLDivElement>
  viewport: CanvasViewport
  canvasWidth: number
  canvasHeight: number
  nodes: SpecUiNode[]
  connections: SpecConnection[]
  stageLanes: CanvasStageLane[]
  focusSet: Set<string> | null
  selectedNodeId: string | null
  highlightNodeId: string | null
  criticalPath: { nodes: Set<string>; edges: Set<string> }
  branchToggles: Array<{
    id: string
    position: { x: number; y: number }
    hiddenCount: number
    collapsed: boolean
  }>
  branchBadges: Map<string, string>
  criticalLocked: boolean
  onToggleBranch: (id: string) => void
  onNodeClick: (id: string) => void
  onMinimapNavigate: (x: number, y: number) => void
}

export const CanvasView = memo(function CanvasView({
  t,
  scrollRef,
  viewport,
  canvasWidth,
  canvasHeight,
  nodes,
  connections,
  stageLanes,
  focusSet,
  selectedNodeId,
  highlightNodeId,
  criticalPath,
  branchToggles,
  branchBadges,
  criticalLocked,
  onToggleBranch,
  onNodeClick,
  onMinimapNavigate,
}: CanvasViewProps) {
  return (
    <div className="h-full relative overflow-hidden bg-surface">
      <div ref={scrollRef} className="absolute inset-0 overflow-auto">
        <CanvasScene
          nodes={nodes}
          connections={connections}
          stageLanes={stageLanes}
          focusSet={focusSet}
          selectedNodeId={selectedNodeId}
          highlightNodeId={highlightNodeId}
          criticalPath={criticalPath}
          branchToggles={branchToggles}
          branchBadges={branchBadges}
          criticalLocked={criticalLocked}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          onToggleBranch={onToggleBranch}
          onNodeClick={onNodeClick}
        />
      </div>

      {nodes.length === 0 && <CanvasEmptyState title={t('canvas.empty.title')} description={t('canvas.empty.description')} />}

      {nodes.length > 0 && (
        <CanvasMinimap
          nodes={nodes}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          viewport={viewport}
          criticalNodes={criticalPath.nodes}
          onNavigate={onMinimapNavigate}
        />
      )}
    </div>
  )
})
