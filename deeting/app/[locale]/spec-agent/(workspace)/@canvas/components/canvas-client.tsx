'use client'

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
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
import { useSpecPlanNodeEvent } from '@/lib/swr/use-spec-agent'

function CanvasClient() {
  const t = useI18n('spec-agent')
  const nodes = useSpecAgentStore((state) => state.nodes)
  const connections = useSpecAgentStore((state) => state.connections)
  const planId = useSpecAgentStore((state) => state.planId)
  const selectedNodeId = useSpecAgentStore((state) => state.selectedNodeId)
  const highlightNodeId = useSpecAgentStore((state) => state.highlightNodeId)
  const focusNodeId = useSpecAgentStore((state) => state.focusNodeId)
  const setSelectedNodeId = useSpecAgentStore((state) => state.setSelectedNodeId)
  const setFocusNodeId = useSpecAgentStore((state) => state.setFocusNodeId)
  const setHighlightNodeId = useSpecAgentStore((state) => state.setHighlightNodeId)
  const { send: sendNodeEvent } = useSpecPlanNodeEvent(planId)
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
  const activeRunningNode = useMemo(
    () => branchState.visibleNodes.find((node) => node.status === 'active'),
    [branchState.visibleNodes]
  )
  const focusSet = useCanvasFocus(
    selectedNodeId,
    activeRunningNode?.id ?? null,
    branchState.visibleConnections
  )
  const stageLanes = useStageLanes(branchState.visibleNodes, t)
  const { canvasWidth, canvasHeight } = useCanvasBounds(
    branchState.visibleNodes,
    viewport
  )
  const lastFollowedRef = useRef<string | null>(null)
  const focusHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoPromptRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    return () => {
      if (focusHighlightTimerRef.current) {
        clearTimeout(focusHighlightTimerRef.current)
        focusHighlightTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (selectedNodeId) return
    const candidate = nodes.find(
      (node) =>
        node.status === 'error' &&
        node.pendingInstruction &&
        !autoPromptRef.current.has(`${node.id}-${node.pendingInstruction}`)
    )
    if (!candidate) return
    const key = `${candidate.id}-${candidate.pendingInstruction}`
    autoPromptRef.current.add(key)
    setSelectedNodeId(candidate.id)
    setFocusNodeId(candidate.id)
    setHighlightNodeId(candidate.id)
    router.push(`/spec-agent/node/${candidate.id}`)
    if (planId) {
      void sendNodeEvent(candidate.id, 'rerun_prompt', 'auto_fail')
    }
  }, [
    nodes,
    planId,
    router,
    selectedNodeId,
    sendNodeEvent,
    setFocusNodeId,
    setHighlightNodeId,
    setSelectedNodeId,
  ])

  useEffect(() => {
    if (!focusNodeId) return
    const targetNode = branchState.visibleNodes.find(
      (node) => node.id === focusNodeId
    )
    const element = scrollRef.current
    if (!targetNode || !element) {
      setFocusNodeId(null)
      return
    }
    const targetLeft = Math.max(
      0,
      Math.min(
        targetNode.position.x - viewport.width / 2,
        canvasWidth - viewport.width
      )
    )
    const targetTop = Math.max(
      0,
      Math.min(
        targetNode.position.y - viewport.height / 2,
        canvasHeight - viewport.height
      )
    )
    element.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' })
    setHighlightNodeId(targetNode.id)
    if (focusHighlightTimerRef.current) {
      clearTimeout(focusHighlightTimerRef.current)
    }
    focusHighlightTimerRef.current = setTimeout(() => {
      setHighlightNodeId(null)
      focusHighlightTimerRef.current = null
    }, 1600)
    setFocusNodeId(null)
  }, [
    canvasHeight,
    canvasWidth,
    focusNodeId,
    scrollRef,
    setFocusNodeId,
    setHighlightNodeId,
    viewport.height,
    viewport.width,
    branchState.visibleNodes,
  ])

  useEffect(() => {
    const activeNode = activeRunningNode
    const element = scrollRef.current
    if (!activeNode || !element) return
    if (lastFollowedRef.current === activeNode.id) return

    const margin = 120
    const left = viewport.scrollLeft
    const top = viewport.scrollTop
    const right = left + viewport.width
    const bottom = top + viewport.height
    const inView =
      activeNode.position.x >= left + margin &&
      activeNode.position.x <= right - margin &&
      activeNode.position.y >= top + margin &&
      activeNode.position.y <= bottom - margin

    if (!inView) {
      const targetLeft = Math.max(
        0,
        Math.min(
          activeNode.position.x - viewport.width / 2,
          canvasWidth - viewport.width
        )
      )
      const targetTop = Math.max(
        0,
        Math.min(
          activeNode.position.y - viewport.height / 2,
          canvasHeight - viewport.height
        )
      )
      element.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' })
    }

    lastFollowedRef.current = activeNode.id
  }, [
    activeRunningNode,
    canvasHeight,
    canvasWidth,
    scrollRef,
    viewport.height,
    viewport.scrollLeft,
    viewport.scrollTop,
    viewport.width,
  ])

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
      highlightNodeId={highlightNodeId}
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
