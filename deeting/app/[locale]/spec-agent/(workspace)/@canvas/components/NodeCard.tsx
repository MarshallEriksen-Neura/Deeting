import { CheckCircle, Play, Clock, AlertTriangle } from 'lucide-react'

interface Node {
  id: string
  type: 'action' | 'logic_gate'
  title: string
  status: 'pending' | 'active' | 'completed' | 'error'
  position: { x: number; y: number }
  duration: string | null
  pulse: string | null
}

interface NodeCardProps {
  node: Node
  isSelected: boolean
  onClick: () => void
}

const statusConfig = {
  pending: {
    icon: Clock,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-muted-foreground/20'
  },
  active: {
    icon: Play,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary'
  },
  completed: {
    icon: CheckCircle,
    color: 'text-teal-accent',
    bgColor: 'bg-teal-accent/10',
    borderColor: 'border-teal-accent'
  },
  error: {
    icon: AlertTriangle,
    color: 'text-destructive',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive'
  }
}

export function NodeCard({ node, isSelected, onClick }: NodeCardProps) {
  const config = statusConfig[node.status]
  const Icon = config.icon

  return (
    <div
      className={`absolute cursor-pointer transition-all duration-200 ${
        isSelected ? 'scale-105 z-10' : 'hover:scale-102'
      }`}
      style={{
        left: node.position.x,
        top: node.position.y,
        transform: 'translate(-50%, -50%)'
      }}
      onClick={onClick}
    >
      <div className={`
        relative p-4 rounded-lg border-2 bg-card shadow-lg
        ${config.borderColor} ${isSelected ? 'ring-2 ring-primary/50' : ''}
      `}>
        {/* 状态指示器 */}
        <div className="absolute -top-2 -left-2">
          <div className={`w-6 h-6 rounded-full ${config.bgColor} border-2 ${config.borderColor} flex items-center justify-center`}>
            <Icon className={`w-3 h-3 ${config.color}`} />
          </div>
        </div>

        {/* 节点内容 */}
        <div className="min-w-48">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              {node.id}: {node.title}
            </span>
            {node.duration && (
              <span className="text-xs text-muted-foreground">
                {node.duration}
              </span>
            )}
          </div>

          {/* 脉冲日志 */}
          {node.pulse && (
            <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded px-2 py-1">
              {node.pulse}
            </div>
          )}

          {/* 类型标签 */}
          <div className="mt-2">
            <span className={`inline-block px-2 py-1 text-xs rounded ${
              node.type === 'logic_gate'
                ? 'bg-primary-soft/20 text-primary-soft'
                : 'bg-teal-accent/20 text-teal-accent'
            }`}>
              {node.type === 'logic_gate' ? '逻辑网关' : '执行节点'}
            </span>
          </div>
        </div>

        {/* 活跃状态的光晕效果 */}
        {node.status === 'active' && (
          <div className="absolute inset-0 rounded-lg border-2 border-primary animate-pulse opacity-50" />
        )}
      </div>
    </div>
  )
}