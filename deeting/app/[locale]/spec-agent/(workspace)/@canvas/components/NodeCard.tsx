'use client'

import { memo } from 'react'
import { Settings2 } from 'lucide-react'
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
  pendingInstruction?: string | null
  outputPreview?: string | null
  logs?: string[]
}

interface NodeCardProps {
  node: Node
  isSelected: boolean
  isDimmed?: boolean
  isCritical?: boolean
  isHighlighted?: boolean
  onClick: () => void
}

const statusConfig = {
  pending: {
    dot: 'bg-slate-300',
    dotRing: 'ring-slate-200/60',
    border: 'border-border/40',
  },
  active: {
    dot: 'bg-primary shadow-[0_0_10px_rgba(37,99,235,0.55)]',
    dotRing: 'ring-primary/40 animate-pulse',
    border: 'border-primary/40',
  },
  waiting: {
    dot: 'bg-amber-400 shadow-[0_0_10px_rgba(251,146,60,0.55)]',
    dotRing: 'ring-amber-300/50 animate-pulse',
    border: 'border-amber-200/50',
  },
  completed: {
    dot: 'bg-emerald-400',
    dotRing: 'ring-emerald-200/60',
    border: 'border-emerald-200/40',
  },
  error: {
    dot: 'bg-rose-400',
    dotRing: 'ring-rose-200/60',
    border: 'border-rose-200/40',
  }
}

export const NodeCard = memo(function NodeCard({
  node,
  isSelected,
  isDimmed,
  isCritical,
  isHighlighted,
  onClick,
}: NodeCardProps) {
  const t = useI18n('spec-agent')
  const config = statusConfig[node.status]
  const previewLines = node.logs?.slice(0, 3) ?? []
  const hasPreview =
    Boolean(node.pulse) || Boolean(node.outputPreview) || previewLines.length > 0

  const card = (
    <div
      className={`absolute cursor-pointer transition-all duration-200 ${
        isSelected ? 'scale-[1.04] z-10' : 'hover:scale-[1.02]'
      } ${isDimmed && !isHighlighted ? 'opacity-20' : 'opacity-100'} ${
        isHighlighted ? 'z-20' : ''
      }`}
      style={{
        left: node.position.x,
        top: node.position.y,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={onClick}
    >
      {node.status === 'active' && (
        <div className="absolute inset-0 rounded-md spec-agent-soft-pulse opacity-60 pointer-events-none" />
      )}
      <div
        className={`relative z-10 px-3 py-2 rounded-md border bg-background/80 shadow-sm backdrop-blur ${
          config.border
        } ${
          isSelected
            ? 'ring-2 ring-primary/50 shadow-[0_0_18px_rgba(59,130,246,0.35)]'
            : ''
        } ${isCritical && !isSelected ? 'ring-1 ring-primary/20' : ''} ${
          isHighlighted
            ? 'ring-2 ring-sky-400/60 shadow-[0_0_22px_rgba(56,189,248,0.55)] animate-pulse'
            : ''
        }`}
      >
        {/* 状态指示灯 */}
        <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className={`h-3.5 w-3.5 rounded-full ${config.dot} ring-2 ${config.dotRing}`}
          />
        </div>

        {/* 紧凑节点内容 */}
        <div className="min-w-44">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {node.id}
            </span>
            <span className="text-xs text-muted-foreground/80 truncate">
              {node.title}
            </span>
          </div>
        </div>

        {node.pendingInstruction && (
          <div
            className="absolute right-1 top-1 rounded-full bg-sky-500/10 p-1 text-sky-500/80"
            title={t('canvas.node.pendingInstruction')}
          >
            <Settings2 className="h-3 w-3" />
          </div>
        )}

        {/* 活跃状态的光晕效果 */}
        {node.status === 'active' && (
          <div className="absolute inset-0 rounded-md border border-primary/60 animate-pulse opacity-40" />
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
