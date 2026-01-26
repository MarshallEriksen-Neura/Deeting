'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeCard } from './components/NodeCard'
import { ConnectionLine } from './components/ConnectionLine'
import { CanvasMinimap } from './components/CanvasMinimap'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useI18n } from '@/hooks/use-i18n'
import { useRouter } from '@/i18n/routing'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function Canvas() {
  const t = useI18n('spec-agent')
  const nodes = useSpecAgentStore((state) => state.nodes)
  const connections = useSpecAgentStore((state) => state.connections)
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
    connections.forEach((conn) => {
      if (conn.source === selectedNodeId) next.add(conn.target)
      if (conn.target === selectedNodeId) next.add(conn.source)
    })
    return next
  }, [connections, selectedNodeId])

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

          {/* 连接线 */}
          <svg className="absolute inset-0 pointer-events-none">
            {connections.map((conn, index) => {
              const fromNode = nodes.find((n) => n.id === conn.source)
              const toNode = nodes.find((n) => n.id === conn.target)

              if (!fromNode || !toNode) return null

              const isDimmed =
                !!focusSet &&
                !focusSet.has(fromNode.id) &&
                !focusSet.has(toNode.id)

              return (
                <ConnectionLine
                  key={index}
                  from={fromNode.position}
                  to={toNode.position}
                  isActive={
                    fromNode.status === 'completed' && toNode.status === 'active'
                  }
                  isDimmed={isDimmed}
                />
              )
            })}
          </svg>

          {/* 节点 */}
          <TooltipProvider delayDuration={120}>
            {nodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                isDimmed={!!focusSet && !focusSet.has(node.id)}
                onClick={() => {
                  setSelectedNodeId(node.id)
                  router.push(`/spec-agent/node/${node.id}`)
                }}
              />
            ))}
          </TooltipProvider>
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
          nodes={nodes}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          viewport={viewport}
          onNavigate={handleMinimapNavigate}
        />
      )}
    </div>
  )
}
