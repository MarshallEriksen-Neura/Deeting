'use client'

import { memo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TerminalLogs } from '@/components/ui/terminal-logs'
import type { ConsoleMessage } from '../types'
import type { SpecUiNode } from '@/store/spec-agent-store'

type ConsoleMessageListProps = {
  t: (key: string) => string
  messages: ConsoleMessage[]
  hasMessages: boolean
  activeNode: SpecUiNode | undefined
}

export const ConsoleMessageList = memo(function ConsoleMessageList({
  t,
  messages,
  hasMessages,
  activeNode,
}: ConsoleMessageListProps) {
  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-3">
        {messages.map((message) => (
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
        ))}
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
