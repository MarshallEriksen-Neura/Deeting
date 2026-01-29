'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import {
  Crosshair,
  ChevronDown,
  ChevronRight,
  Wrench,
  User,
  Bot,
  Zap,
  Clock,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TerminalLogs } from '@/components/ui/terminal-logs'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ConsoleMessage } from '../types'
import type { SpecUiNode } from '@/store/spec-agent-store'

type ConsoleMessageListProps = {
  t: (key: string) => string
  messages: ConsoleMessage[]
  hasMessages: boolean
  activeNode: SpecUiNode | undefined
  nodes: SpecUiNode[]
  onLocateNode: (nodeId: string) => void
}

/** 可折叠的执行步骤卡片 - 升级版 */
function CollapsibleCard({
  icon,
  label,
  badge,
  children,
  defaultOpen = false,
  variant = 'default',
}: {
  icon: React.ReactNode
  label: string
  badge?: string
  children: React.ReactNode
  defaultOpen?: boolean
  variant?: 'default' | 'active' | 'success' | 'error'
}) {
  const [open, setOpen] = useState(defaultOpen)

  const variantStyles = {
    default: 'border-border/40 bg-muted/20',
    active: 'border-primary/30 bg-primary/5',
    success: 'border-emerald-500/30 bg-emerald-500/5',
    error: 'border-red-500/30 bg-red-500/5',
  }

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden',
        'backdrop-blur-sm',
        'transition-all duration-200',
        variantStyles[variant],
        open && 'shadow-sm'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-3',
          'text-xs text-muted-foreground',
          'hover:bg-muted/30 transition-colors',
          'cursor-pointer'
        )}
      >
        <span
          className={cn(
            'transition-transform duration-200',
            open && 'rotate-90'
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
        {icon}
        <span className="font-medium uppercase tracking-wider">{label}</span>
        {badge && (
          <span className="ml-auto px-2 py-0.5 text-[10px] rounded-full bg-muted/50">
            {badge}
          </span>
        )}
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-out',
          open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  )
}

export const ConsoleMessageList = memo(function ConsoleMessageList({
  t,
  messages,
  hasMessages,
  activeNode,
  nodes,
  onLocateNode,
}: ConsoleMessageListProps) {
  const nodeIds = useMemo(
    () => nodes.map((node) => node.id).sort((a, b) => b.length - a.length),
    [nodes]
  )

  const resolveMessageNodeId = useCallback(
    (content: string, meta?: Record<string, unknown>) => {
      const metaNodeId =
        typeof meta?.spec_agent_node_id === 'string'
          ? meta.spec_agent_node_id
          : typeof meta?.node_id === 'string'
            ? meta.node_id
            : null
      if (metaNodeId && nodeIds.includes(metaNodeId)) return metaNodeId
      if (!content) return null
      const bracketMatches = content.match(/\[([^\]]+)\]/g) ?? []
      for (const match of bracketMatches) {
        const value = match.slice(1, -1)
        if (nodeIds.includes(value)) return value
      }
      for (const id of nodeIds) {
        if (content.includes(id)) return id
      }
      return null
    },
    [nodeIds]
  )

  return (
    <ScrollArea className="flex-1 px-4 py-4">
      <div className="space-y-5">
        {messages.map((message, index) => {
          const explicitNodeId = resolveMessageNodeId(
            message.content,
            message.meta
          )
          const targetNodeId =
            explicitNodeId ||
            (message.type !== 'user' ? activeNode?.id ?? null : null)

          // 用户消息 - 精致气泡样式
          if (message.type === 'user') {
            return (
              <div key={message.id} className="flex items-start gap-3 group">
                {/* 头像 */}
                <div
                  className={cn(
                    'flex-shrink-0 w-8 h-8 rounded-xl',
                    'bg-gradient-to-br from-primary/20 to-primary/10',
                    'flex items-center justify-center',
                    'ring-1 ring-primary/20',
                    'shadow-sm'
                  )}
                >
                  <User className="h-4 w-4 text-primary" />
                </div>
                {/* 消息体 */}
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {t('console.role.user')}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                      {message.timestamp}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'rounded-2xl rounded-tl-md px-4 py-3',
                      'bg-gradient-to-br from-muted/60 to-muted/40',
                      'text-sm text-foreground',
                      'shadow-sm',
                      'border border-border/30'
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              </div>
            )
          }

          // 系统/Agent 消息 - 卡片样式
          const isAgent = message.type === 'agent'
          return (
            <div key={message.id} className="flex items-start gap-3 group">
              {/* 头像 */}
              <div
                className={cn(
                  'flex-shrink-0 w-8 h-8 rounded-xl',
                  'flex items-center justify-center',
                  'shadow-sm',
                  isAgent
                    ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 ring-1 ring-emerald-500/20'
                    : 'bg-gradient-to-br from-amber-500/20 to-amber-500/10 ring-1 ring-amber-500/20'
                )}
              >
                {isAgent ? (
                  <Bot className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Zap className="h-4 w-4 text-amber-500" />
                )}
              </div>
              {/* 消息体 */}
              <div className="flex-1 space-y-2">
                {/* 角色 + 时间 + 定位按钮 */}
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs font-medium',
                      isAgent ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                    )}
                  >
                    {isAgent ? t('console.role.agent') : t('console.role.system')}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 font-mono flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {message.timestamp}
                  </span>
                  {targetNodeId && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={cn(
                        'h-6 w-6 rounded-lg',
                        'text-muted-foreground/60 hover:text-primary',
                        'opacity-0 group-hover:opacity-100 transition-opacity'
                      )}
                      onClick={() => onLocateNode(targetNodeId)}
                      aria-label={t('console.locate')}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {/* 消息内容 */}
                <div
                  className={cn(
                    'rounded-2xl rounded-tl-md px-4 py-3',
                    'text-sm text-foreground/90',
                    'border shadow-sm',
                    isAgent
                      ? 'bg-gradient-to-br from-emerald-500/5 to-transparent border-emerald-500/20'
                      : 'bg-gradient-to-br from-amber-500/5 to-transparent border-amber-500/20'
                  )}
                >
                  {message.content}
                </div>
              </div>
            </div>
          )
        })}

        {/* 空状态 */}
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
              <Bot className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground/60">
              {t('console.empty')}
            </p>
          </div>
        )}

        {/* 活跃节点日志 - 工具执行卡片 */}
        {activeNode && activeNode.logs && activeNode.logs.length > 0 && (
          <CollapsibleCard
            icon={<Wrench className="h-4 w-4 text-primary" />}
            label={t('execution.toolExecution')}
            badge={activeNode.duration ?? undefined}
            variant={
              activeNode.status === 'active'
                ? 'active'
                : activeNode.status === 'error'
                  ? 'error'
                  : activeNode.status === 'completed'
                    ? 'success'
                    : 'default'
            }
            defaultOpen
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  activeNode.status === 'active' && 'bg-primary animate-pulse',
                  activeNode.status === 'error' && 'bg-red-500',
                  activeNode.status === 'completed' && 'bg-emerald-500',
                  activeNode.status !== 'active' &&
                    activeNode.status !== 'error' &&
                    activeNode.status !== 'completed' &&
                    'bg-amber-500'
                )}
              />
              <span className="text-xs font-mono text-muted-foreground">
                {activeNode.title}
              </span>
            </div>
            <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3">
              <TerminalLogs logs={activeNode.logs} />
            </div>
          </CollapsibleCard>
        )}
      </div>
    </ScrollArea>
  )
})
