'use client'

import { memo } from 'react'
import type { SpecConnection } from '@/lib/api/spec-agent'
import type { SpecUiNode } from '@/store/spec-agent-store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConnectionLine } from './ConnectionLine'
import { NodeCard } from './NodeCard'
import { BranchToggleLayer } from './branch-toggle-layer'
import type { CanvasStageLane } from '../hooks/use-stage-lanes'

type CanvasSceneProps = {
  nodes: SpecUiNode[]
  connections: SpecConnection[]
  stageLanes: CanvasStageLane[]
  focusSet: Set<string> | null
  selectedNodeId: string | null
  criticalPath: { nodes: Set<string>; edges: Set<string> }
  branchToggles: Array<{
    id: string
    position: { x: number; y: number }
    hiddenCount: number
    collapsed: boolean
  }>
  branchBadges: Map<string, string>
  criticalLocked: boolean
  canvasWidth: number
  canvasHeight: number
  onToggleBranch: (id: string) => void
  onNodeClick: (id: string) => void
}

export const CanvasScene = memo(function CanvasScene({
  nodes,
  connections,
  stageLanes,
  focusSet,
  selectedNodeId,
  criticalPath,
  branchToggles,
  branchBadges,
  criticalLocked,
  canvasWidth,
  canvasHeight,
  onToggleBranch,
  onNodeClick,
}: CanvasSceneProps) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  return (
    <div className="relative" style={{ width: canvasWidth, height: canvasHeight }}>
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

      <svg className="absolute inset-0 pointer-events-none">
        {connections.map((conn, index) => {
          const fromNode = nodeMap.get(conn.source)
          const toNode = nodeMap.get(conn.target)
          if (!fromNode || !toNode) return null
          const isDimmed =
            !!focusSet &&
            !focusSet.has(fromNode.id) &&
            !focusSet.has(toNode.id)
          const isCritical = criticalPath.edges.has(
            `${fromNode.id}=>${toNode.id}`
          )
          const badge =
            criticalPath.nodes.has(fromNode.id) && branchBadges.has(toNode.id)
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

      <TooltipProvider delayDuration={120}>
        {nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            isSelected={selectedNodeId === node.id}
            isDimmed={!!focusSet && !focusSet.has(node.id)}
            isCritical={criticalPath.nodes.has(node.id)}
            onClick={() => onNodeClick(node.id)}
          />
        ))}
      </TooltipProvider>

      <BranchToggleLayer
        toggles={branchToggles}
        disabled={criticalLocked}
        onToggle={onToggleBranch}
      />
    </div>
  )
})
