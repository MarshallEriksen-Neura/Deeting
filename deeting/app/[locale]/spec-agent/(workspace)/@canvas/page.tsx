'use client'

import { NodeCard } from './components/NodeCard'
import { ConnectionLine } from './components/ConnectionLine'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useI18n } from '@/hooks/use-i18n'

export default function Canvas() {
  const t = useI18n('spec-agent')
  const nodes = useSpecAgentStore((state) => state.nodes)
  const connections = useSpecAgentStore((state) => state.connections)
  const selectedNodeId = useSpecAgentStore((state) => state.selectedNodeId)
  const setSelectedNodeId = useSpecAgentStore((state) => state.setSelectedNodeId)

  return (
    <div className="h-full relative overflow-hidden bg-surface">
      {/* 网格背景 */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--border) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px'
        }}
      />

      {/* 连接线 */}
      <svg className="absolute inset-0 pointer-events-none">
        {connections.map((conn, index) => {
          const fromNode = nodes.find((n) => n.id === conn.source)
          const toNode = nodes.find((n) => n.id === conn.target)

          if (!fromNode || !toNode) return null

          return (
            <ConnectionLine
              key={index}
              from={fromNode.position}
              to={toNode.position}
              isActive={fromNode.status === 'completed' && toNode.status === 'active'}
            />
          )
        })}
      </svg>

      {/* 节点 */}
      {nodes.map((node) => (
        <NodeCard
          key={node.id}
          node={node}
          isSelected={selectedNodeId === node.id}
          onClick={() => setSelectedNodeId(node.id)}
        />
      ))}

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
    </div>
  )
}
