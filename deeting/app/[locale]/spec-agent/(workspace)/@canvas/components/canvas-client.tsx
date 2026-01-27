'use client'

import { memo, useCallback } from 'react'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useI18n } from '@/hooks/use-i18n'
import { useRouter } from '@/i18n/routing'
import { CanvasView } from './canvas-view'
import { useCanvasViewport } from '../hooks/use-canvas-viewport'
import { useCriticalPath } from '../hooks/use-critical-path'
import { useBranchState } from '../hooks/use-branch-state'
import { useStageLanes } from '../hooks/use-stage-lanes'
import { useCanvasBounds } from '../hooks/use-canvas-bounds'
import { useCanvasFocus } from '../hooks/use-canvas-focus'

function CanvasClient() {
  const t = useI18n('spec-agent')
  const nodes = useSpecAgentStore((state) => state.nodes)
  const connections = useSpecAgentStore((state) => state.connections)
  const planId = useSpecAgentStore((state) => state.planId)
  const selectedNodeId = useSpecAgentStore((state) => state.selectedNodeId)
  const setSelectedNodeId = useSpecAgentStore((state) => state.setSelectedNodeId)
  const router = useRouter()
  const { scrollRef, viewport } = useCanvasViewport()
  const criticalPath = useCriticalPath(nodes, connections)
  const branchState = useBranchState({
    nodes,
    connections,
    criticalPath,
    planId,
    selectedNodeId,
    setSelectedNodeId,
  })
  const focusSet = useCanvasFocus(selectedNodeId, branchState.visibleConnections)
  const stageLanes = useStageLanes(branchState.visibleNodes, t)
  const { canvasWidth, canvasHeight } = useCanvasBounds(
    branchState.visibleNodes,
    viewport
  )

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId)
      router.push(`/spec-agent/node/${nodeId}`)
    },
    [router, setSelectedNodeId]
  )

  const handleMinimapNavigate = useCallback(
    (x: number, y: number) => {
      const element = scrollRef.current
      if (!element) return
      const targetLeft = Math.max(
        0,
        Math.min(x - element.clientWidth / 2, canvasWidth - element.clientWidth)
      )
      const targetTop = Math.max(
        0,
        Math.min(y - element.clientHeight / 2, canvasHeight - element.clientHeight)
      )
      element.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' })
    },
    [canvasHeight, canvasWidth, scrollRef]
  )

  return (
    <CanvasView
      t={t}
      scrollRef={scrollRef}
      viewport={viewport}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
      nodes={branchState.visibleNodes}
      connections={branchState.visibleConnections}
      stageLanes={stageLanes}
      focusSet={focusSet}
      selectedNodeId={selectedNodeId}
      criticalPath={criticalPath}
      branchToggles={branchState.branchToggles}
      branchBadges={branchState.branchBadges}
      criticalLocked={branchState.criticalLocked}
      onToggleBranch={branchState.toggleBranch}
      onNodeClick={handleNodeClick}
      onMinimapNavigate={handleMinimapNavigate}
    />
  )
}

export default memo(CanvasClient)
