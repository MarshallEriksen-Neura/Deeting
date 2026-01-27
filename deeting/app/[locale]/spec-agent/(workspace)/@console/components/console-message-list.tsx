'use client'

import { memo, useCallback, useMemo } from 'react'
import { Crosshair } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TerminalLogs } from '@/components/ui/terminal-logs'
import { Button } from '@/components/ui/button'
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
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-3">
        {messages.map((message) => {
          const explicitNodeId = resolveMessageNodeId(
            message.content,
            message.meta
          )
          const targetNodeId =
            explicitNodeId ||
            (message.type !== 'user' ? activeNode?.id ?? null : null)
          return (
            <div key={message.id} className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{message.timestamp}</span>
                <span className="uppercase font-medium">
                  {message.type === 'user'
                    ? t('console.role.user')
                    : message.type === 'system'
                      ? t('console.role.system')
                      : t('console.role.agent')}
                </span>
                {targetNodeId && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 text-muted-foreground/80 hover:text-foreground"
                    onClick={() => onLocateNode(targetNodeId)}
                    aria-label={t('console.locate')}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div
                className={`text-sm ${
                  message.type === 'user'
                    ? 'text-foreground'
                    : 'text-muted-foreground font-mono'
                }`}
              >
                {message.content}
              </div>
            </div>
          )
        })}
        {!hasMessages && (
          <div className="text-sm text-muted-foreground">{t('console.empty')}</div>
        )}

        {activeNode && activeNode.logs && activeNode.logs.length > 0 && (
          <div className="mt-6 border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  activeNode.status === 'active'
                    ? 'bg-emerald-500 animate-pulse'
                    : activeNode.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-amber-500'
                }`}
              />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                {activeNode.title}
              </span>
            </div>
            <TerminalLogs logs={activeNode.logs} />
          </div>
        )}
      </div>
    </ScrollArea>
  )
})
