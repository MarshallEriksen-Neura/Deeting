'use client'

import { useState } from 'react'
import { NodeCard } from './components/NodeCard'
import { ConnectionLine } from './components/ConnectionLine'

// 模拟的DAG数据
const mockNodes = [
  {
    id: 'T1',
    type: 'action',
    title: '搜索商品',
    status: 'completed',
    position: { x: 100, y: 100 },
    duration: '3.2s',
    pulse: '已获取 12 条结果'
  },
  {
    id: 'G1',
    type: 'logic_gate',
    title: '评估性价比',
    status: 'active',
    position: { x: 400, y: 100 },
    duration: '1.8s',
    pulse: '正在计算最优方案...'
  },
  {
    id: 'T2',
    type: 'action',
    title: '生成报告',
    status: 'pending',
    position: { x: 700, y: 100 },
    duration: null,
    pulse: null
  }
]

const mockConnections = [
  { from: 'T1', to: 'G1' },
  { from: 'G1', to: 'T2' }
]

export default function Canvas() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

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
        {mockConnections.map((conn, index) => {
          const fromNode = mockNodes.find(n => n.id === conn.from)
          const toNode = mockNodes.find(n => n.id === conn.to)

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
      {mockNodes.map((node) => (
        <NodeCard
          key={node.id}
          node={node}
          isSelected={selectedNode === node.id}
          onClick={() => setSelectedNode(node.id)}
        />
      ))}

      {/* 空状态提示 */}
      {mockNodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🎯</div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              开始你的Spec Agent任务
            </h3>
            <p className="text-muted-foreground">
              在Console中输入指令，AI将自动规划和执行任务流程
            </p>
          </div>
        </div>
      )}
    </div>
  )
}