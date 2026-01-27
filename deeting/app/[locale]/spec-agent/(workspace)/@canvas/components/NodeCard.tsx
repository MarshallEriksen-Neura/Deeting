'use client'

import { memo } from 'react'
import { CheckCircle, Play, Clock, AlertTriangle, PauseCircle } from 'lucide-react'
import { useI18n } from '@/hooks/use-i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Node {
  id: string
  type: 'action' | 'logic_gate' | 'replan_trigger'
  title: string
  status: 'pending' | 'active' | 'completed' | 'error' | 'waiting'
  position: { x: number; y: number }
  duration: string | null
  pulse: string | null
  modelOverride?: string | null
  outputPreview?: string | null
  logs?: string[]
}

interface NodeCardProps {
  node: Node
  isSelected: boolean
  isDimmed?: boolean
  isCritical?: boolean
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
  waiting: {
    icon: PauseCircle,
    color: 'text-primary-soft',
    bgColor: 'bg-primary-soft/10',
    borderColor: 'border-primary-soft'
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

export const NodeCard = memo(function NodeCard({
  node,
  isSelected,
  isDimmed,
  isCritical,
  onClick,
}: NodeCardProps) {
  const t = useI18n('spec-agent')
  const config = statusConfig[node.status]
  const Icon = config.icon
  const previewLines = node.logs?.slice(0, 3) ?? []
  const hasPreview =
    Boolean(node.pulse) || Boolean(node.outputPreview) || previewLines.length > 0

  const card = (
    <div
      className={`absolute cursor-pointer transition-all duration-200 ${
        isSelected ? 'scale-[1.04] z-10' : 'hover:scale-[1.02]'
      } ${isDimmed ? 'opacity-20' : 'opacity-100'}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={onClick}
    >
      <div
        className={`relative px-3 py-2 rounded-md border bg-card shadow-sm ${
          config.borderColor
        } ${isSelected ? 'ring-2 ring-primary/40' : ''} ${
          isCritical && !isSelected ? 'ring-1 ring-primary/20' : ''
        }`}
      >
        {/* 状态指示器 */}
        <div className="absolute -top-2 -left-2">
          <div
            className={`w-5 h-5 rounded-full ${config.bgColor} border ${config.borderColor} flex items-center justify-center`}
          >
            <Icon className={`w-3 h-3 ${config.color}`} />
          </div>
        </div>

        {/* 紧凑节点内容 */}
        <div className="min-w-40">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {node.id}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {node.title}
            </span>
          </div>
        </div>

        {/* 活跃状态的光晕效果 */}
        {node.status === 'active' && (
          <div className="absolute inset-0 rounded-md border border-primary animate-pulse opacity-40" />
        )}
      </div>
    </div>
  )

  if (!hasPreview) return card

  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-xs">
        <div className="space-y-1 text-xs text-muted-foreground">
          {node.pulse && (
            <div className="font-mono text-[10px] text-foreground/80">
              {node.pulse}
            </div>
          )}
          {node.outputPreview && <div>{node.outputPreview}</div>}
          {previewLines.length > 0 && (
            <div className="space-y-0.5">
              {previewLines.map((line, index) => (
                <div key={`${node.id}-log-${index}`} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          )}
          {node.type === 'action' && node.modelOverride && (
            <div className="text-[10px] text-muted-foreground">
              {t('canvas.node.model.label')}: {node.modelOverride}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
})
