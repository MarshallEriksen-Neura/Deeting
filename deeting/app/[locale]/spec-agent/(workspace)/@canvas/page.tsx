'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeCard } from './components/NodeCard'
import { ConnectionLine } from './components/ConnectionLine'
import { CanvasMinimap } from './components/CanvasMinimap'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useI18n } from '@/hooks/use-i18n'
import { useRouter } from '@/i18n/routing'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

export default function Canvas() {
  const t = useI18n('spec-agent')
  const nodes = useSpecAgentStore((state) => state.nodes)
  const connections = useSpecAgentStore((state) => state.connections)
  const planId = useSpecAgentStore((state) => state.planId)
  const selectedNodeId = useSpecAgentStore((state) => state.selectedNodeId)
  const setSelectedNodeId = useSpecAgentStore((state) => state.setSelectedNodeId)
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({
    width: 0,
    height: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(
    () => new Set()
  )
  const [collapseHydrated, setCollapseHydrated] = useState(false)
  const [criticalLocked, setCriticalLocked] = useState(false)
  const [lockedSnapshot, setLockedSnapshot] = useState<Set<string> | null>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handle = () => {
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
      })
    }

    handle()
    element.addEventListener('scroll', handle, { passive: true })
    window.addEventListener('resize', handle)

    return () => {
      element.removeEventListener('scroll', handle)
      window.removeEventListener('resize', handle)
    }
  }, [])

  const criticalPath = useMemo(() => {
    if (!nodes.length || !connections.length) {
      return { nodes: new Set<string>(), edges: new Set<string>() }
    }

    const nodeIds = new Set(nodes.map((node) => node.id))
    const outgoing = new Map<string, string[]>()
    const indegree = new Map<string, number>()
    nodeIds.forEach((id) => {
      outgoing.set(id, [])
      indegree.set(id, 0)
    })
    connections.forEach((conn) => {
      if (!nodeIds.has(conn.source) || !nodeIds.has(conn.target)) return
      outgoing.get(conn.source)?.push(conn.target)
      indegree.set(conn.target, (indegree.get(conn.target) ?? 0) + 1)
    })

    const queue: string[] = []
    indegree.forEach((count, id) => {
      if (count === 0) queue.push(id)
    })

    const dist = new Map<string, number>()
    const prev = new Map<string, string | null>()
    nodeIds.forEach((id) => {
      dist.set(id, 0)
      prev.set(id, null)
    })

    while (queue.length) {
      const current = queue.shift() as string
      const currentDist = dist.get(current) ?? 0
      const neighbors = outgoing.get(current) ?? []
      neighbors.forEach((next) => {
        if (currentDist + 1 > (dist.get(next) ?? 0)) {
          dist.set(next, currentDist + 1)
          prev.set(next, current)
        }
        indegree.set(next, (indegree.get(next) ?? 1) - 1)
        if (indegree.get(next) === 0) queue.push(next)
      })
    }

    let endNode = nodes[0]?.id ?? ''
    let maxDist = -1
    dist.forEach((value, id) => {
      if (value > maxDist) {
        maxDist = value
        endNode = id
      }
    })

    const pathNodes = new Set<string>()
    const pathEdges = new Set<string>()
    let cursor: string | null = endNode
    while (cursor) {
      pathNodes.add(cursor)
      const parent = prev.get(cursor) ?? null
      if (parent) pathEdges.add(`${parent}=>${cursor}`)
      cursor = parent
    }

    return { nodes: pathNodes, edges: pathEdges }
  }, [connections, nodes])

  const branchData = useMemo(() => {
    if (!criticalPath.nodes.size || !connections.length) {
      return [] as Array<{
        rootId: string
        originId: string
        nodes: Set<string>
      }>
    }

    const outgoing = new Map<string, string[]>()
    nodes.forEach((node) => outgoing.set(node.id, []))
    connections.forEach((conn) => {
      if (!outgoing.has(conn.source)) return
      outgoing.get(conn.source)?.push(conn.target)
    })

    const roots = new Map<
      string,
      { originId: string; nodes: Set<string> }
    >()

    connections.forEach((conn) => {
      if (!criticalPath.nodes.has(conn.source)) return
      if (criticalPath.nodes.has(conn.target)) return
      if (roots.has(conn.target)) return

      const visited = new Set<string>()
      const stack = [conn.target]
      while (stack.length) {
        const current = stack.pop() as string
        if (visited.has(current)) continue
        if (criticalPath.nodes.has(current)) continue
        visited.add(current)
        const nextNodes = outgoing.get(current) ?? []
        nextNodes.forEach((next) => {
          if (!criticalPath.nodes.has(next)) stack.push(next)
        })
      }

      roots.set(conn.target, { originId: conn.source, nodes: visited })
    })

    return Array.from(roots.entries()).map(([rootId, data]) => ({
      rootId,
      originId: data.originId,
      nodes: data.nodes,
    }))
  }, [connections, criticalPath.nodes, nodes])

  const branchRootKey = useMemo(
    () => branchData.map((item) => item.rootId).sort().join("|"),
    [branchData]
  )

  useEffect(() => {
    if (!planId) {
      setCollapsedBranches(new Set())
      setCollapseHydrated(false)
      setCriticalLocked(false)
      setLockedSnapshot(null)
      return
    }
    const storageKey = `deeting-spec-agent:branch-collapse:${planId}`
    const stored = localStorage.getItem(storageKey)
    if (!stored) {
      setCollapsedBranches(new Set())
      setCollapseHydrated(false)
      setCriticalLocked(false)
      setLockedSnapshot(null)
      return
    }
    try {
      const parsed = JSON.parse(stored)
      const ids = Array.isArray(parsed) ? parsed.filter(Boolean) : []
      setCollapsedBranches(new Set(ids))
      setCollapseHydrated(true)
      setCriticalLocked(false)
      setLockedSnapshot(null)
    } catch {
      setCollapsedBranches(new Set())
      setCollapseHydrated(false)
      setCriticalLocked(false)
      setLockedSnapshot(null)
    }
  }, [planId])

  useEffect(() => {
    if (!branchData.length) {
      setCollapsedBranches(new Set())
      return
    }
    setCollapsedBranches((prev) => {
      const next = new Set(prev)
      const nextRoots = new Set(branchData.map((item) => item.rootId))
      if (!collapseHydrated) {
        nextRoots.forEach((id) => {
          if (!next.has(id)) next.add(id)
        })
        setCollapseHydrated(true)
      }
      Array.from(next).forEach((id) => {
        if (!nextRoots.has(id)) next.delete(id)
      })
      return next
    })
  }, [branchData, branchRootKey, collapseHydrated])

  useEffect(() => {
    if (!planId || !collapseHydrated) return
    const storageKey = `deeting-spec-agent:branch-collapse:${planId}`
    localStorage.setItem(
      storageKey,
      JSON.stringify(Array.from(collapsedBranches))
    )
  }, [collapsedBranches, collapseHydrated, planId])

  const hiddenNodes = useMemo(() => {
    if (!branchData.length) return new Set<string>()
    const hidden = new Set<string>()
    branchData.forEach((branch) => {
      if (!collapsedBranches.has(branch.rootId)) return
      branch.nodes.forEach((nodeId) => {
        if (nodeId !== branch.rootId) hidden.add(nodeId)
      })
    })
    return hidden
  }, [branchData, collapsedBranches])

  const visibleNodes = useMemo(
    () => nodes.filter((node) => !hiddenNodes.has(node.id)),
    [hiddenNodes, nodes]
  )

  useEffect(() => {
    if (!selectedNodeId) return
    if (hiddenNodes.has(selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }, [hiddenNodes, selectedNodeId, setSelectedNodeId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "l") return
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName?.toLowerCase()
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target.isContentEditable
        ) {
          return
        }
      }
      event.preventDefault()
      if (!criticalLocked) {
        setLockedSnapshot(new Set(collapsedBranches))
        const next = new Set(branchData.map((item) => item.rootId))
        setCollapsedBranches(next)
        setCriticalLocked(true)
        return
      }
      setCollapsedBranches(lockedSnapshot ?? new Set())
      setLockedSnapshot(null)
      setCriticalLocked(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [branchData, collapsedBranches, criticalLocked, lockedSnapshot])

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes]
  )

  const visibleNodeMap = useMemo(
    () => new Map(visibleNodes.map((node) => [node.id, node])),
    [visibleNodes]
  )

  const visibleConnections = useMemo(
    () =>
      connections.filter(
        (conn) =>
          visibleNodeIds.has(conn.source) && visibleNodeIds.has(conn.target)
      ),
    [connections, visibleNodeIds]
  )

  const bounds = useMemo(() => {
    if (!visibleNodes.length) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    }
    return visibleNodes.reduce(
      (acc, node) => ({
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x),
        maxY: Math.max(acc.maxY, node.position.y),
      }),
      {
        minX: visibleNodes[0]?.position.x ?? 0,
        minY: visibleNodes[0]?.position.y ?? 0,
        maxX: visibleNodes[0]?.position.x ?? 0,
        maxY: visibleNodes[0]?.position.y ?? 0,
      }
    )
  }, [visibleNodes])

  const canvasPadding = 240
  const canvasWidth = Math.max(
    bounds.maxX + canvasPadding,
    viewport.width || 1200
  )
  const canvasHeight = Math.max(
    bounds.maxY + canvasPadding,
    viewport.height || 800
  )

  const focusSet = useMemo(() => {
    if (!selectedNodeId) return null
    const next = new Set([selectedNodeId])
    visibleConnections.forEach((conn) => {
      if (conn.source === selectedNodeId) next.add(conn.target)
      if (conn.target === selectedNodeId) next.add(conn.source)
    })
    return next
  }, [selectedNodeId, visibleConnections])

  const stageLanes = useMemo(() => {
    const lanePadding = 80
    const stages = [
      { key: 'search', label: t('canvas.stage.search'), tone: 'bg-blue-500/5 border-blue-500/20 text-blue-500/70' },
      { key: 'process', label: t('canvas.stage.process'), tone: 'bg-violet-500/5 border-violet-500/20 text-violet-500/70' },
      { key: 'summary', label: t('canvas.stage.summary'), tone: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-500/70' },
      { key: 'action', label: t('canvas.stage.action'), tone: 'bg-amber-500/5 border-amber-500/20 text-amber-500/70' },
    ]

    return stages
      .map((stage) => {
        const stageNodes = visibleNodes.filter((node) => node.stage === stage.key)
        if (!stageNodes.length) return null
        const minY = Math.min(...stageNodes.map((node) => node.position.y))
        const maxY = Math.max(...stageNodes.map((node) => node.position.y))
        const top = Math.max(minY - lanePadding, 0)
        const height = Math.max(maxY - minY + lanePadding * 2, 180)
        return { ...stage, top, height }
      })
      .filter(
        (
          lane
        ): lane is {
          key: string
          label: string
          tone: string
          top: number
          height: number
        } => Boolean(lane)
      )
  }, [t, visibleNodes])

  const branchToggles = useMemo(() => {
    return branchData
      .map((branch) => {
        const rootNode = visibleNodeMap.get(branch.rootId)
        if (!rootNode) return null
        const hiddenCount = Math.max(branch.nodes.size - 1, 0)
        if (hiddenCount === 0) return null
        return {
          id: branch.rootId,
          position: rootNode.position,
          hiddenCount,
          collapsed: collapsedBranches.has(branch.rootId),
        }
      })
      .filter(
        (
          toggle
        ): toggle is {
          id: string
          position: { x: number; y: number }
          hiddenCount: number
          collapsed: boolean
        } => Boolean(toggle)
      )
  }, [branchData, collapsedBranches, visibleNodeMap])

  const branchBadges = useMemo(() => {
    const badgeMap = new Map<string, string>()
    branchData.forEach((branch) => {
      if (!collapsedBranches.has(branch.rootId)) return
      const hiddenCount = Math.max(branch.nodes.size - 1, 0)
      if (hiddenCount === 0) return
      badgeMap.set(branch.rootId, `+${hiddenCount}`)
    })
    return badgeMap
  }, [branchData, collapsedBranches])

  const handleMinimapNavigate = (x: number, y: number) => {
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
  }

  return (
    <div className="h-full relative overflow-hidden bg-surface">
      <div ref={scrollRef} className="absolute inset-0 overflow-auto">
        <div
          className="relative"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          {/* 网格背景 */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `
                linear-gradient(to right, var(--border) 1px, transparent 1px),
                linear-gradient(to bottom, var(--border) 1px, transparent 1px)
              `,
              backgroundSize: '20px 20px',
            }}
          />

          {/* 泳道背景 */}
          {stageLanes.map((lane) => (
            <div
              key={lane.key}
              className={`absolute left-0 right-0 rounded-xl border pointer-events-none ${lane.tone}`}
              style={{ top: lane.top, height: lane.height }}
            >
              <div className="absolute left-6 top-3 text-xs font-medium uppercase tracking-[0.2em]">
                {lane.label}
              </div>
            </div>
          ))}

          {/* 连接线 */}
          <svg className="absolute inset-0 pointer-events-none">
            {visibleConnections.map((conn, index) => {
              const fromNode = visibleNodeMap.get(conn.source)
              const toNode = visibleNodeMap.get(conn.target)

              if (!fromNode || !toNode) return null

              const isDimmed =
                !!focusSet &&
                !focusSet.has(fromNode.id) &&
                !focusSet.has(toNode.id)

              const isCritical = criticalPath.edges.has(
                `${fromNode.id}=>${toNode.id}`
              )
              const badge =
                criticalPath.nodes.has(fromNode.id) &&
                branchBadges.has(toNode.id)
                  ? branchBadges.get(toNode.id)
                  : undefined

              return (
                <ConnectionLine
                  key={index}
                  from={fromNode.position}
                  to={toNode.position}
                  isActive={
                    fromNode.status === 'completed' && toNode.status === 'active'
                  }
                  isDimmed={isDimmed}
                  isCritical={isCritical}
                  badge={badge}
                />
              )
            })}
          </svg>

          {/* 节点 */}
          <TooltipProvider delayDuration={120}>
            {visibleNodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                isDimmed={!!focusSet && !focusSet.has(node.id)}
                isCritical={criticalPath.nodes.has(node.id)}
                onClick={() => {
                  setSelectedNodeId(node.id)
                  router.push(`/spec-agent/node/${node.id}`)
                }}
              />
            ))}
          </TooltipProvider>

          {branchToggles.map((toggle) => (
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
                disabled={criticalLocked}
                onClick={() =>
                  setCollapsedBranches((prev) => {
                    const next = new Set(prev)
                    if (next.has(toggle.id)) {
                      next.delete(toggle.id)
                    } else {
                      next.add(toggle.id)
                    }
                    return next
                  })
                }
              >
                {toggle.collapsed ? `+${toggle.hiddenCount}` : `-${toggle.hiddenCount}`}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 空状态提示 */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🎯</div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {t('canvas.empty.title')}
            </h3>
            <p className="text-muted-foreground">
              {t('canvas.empty.description')}
            </p>
          </div>
        </div>
      )}

      {nodes.length > 0 && (
        <CanvasMinimap
          nodes={visibleNodes}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          viewport={viewport}
          criticalNodes={criticalPath.nodes}
          onNavigate={handleMinimapNavigate}
        />
      )}
    </div>
  )
}
