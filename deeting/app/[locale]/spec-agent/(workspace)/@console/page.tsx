'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useSpecDraftStream } from '@/lib/swr/use-spec-agent'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useI18n } from '@/hooks/use-i18n'

interface ConsoleMessage {
  id: string
  type: 'user' | 'system' | 'agent'
  content: string
  timestamp: string
}

const formatTime = (date: Date) =>
  date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

export default function Console() {
  const t = useI18n('spec-agent')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const drafting = useSpecAgentStore((state) => state.drafting)
  const projectName = useSpecAgentStore((state) => state.projectName)
  const { start } = useSpecDraftStream()
  const lastDraftStatus = useRef(drafting.status)

  const appendMessage = useCallback((message: Omit<ConsoleMessage, 'id'>) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...message,
      },
    ])
  }, [])

  useEffect(() => {
    if (lastDraftStatus.current === drafting.status) return
    lastDraftStatus.current = drafting.status
    if (drafting.status === 'drafting') {
      appendMessage({
        type: 'system',
        content: t('console.system.drafting'),
        timestamp: formatTime(new Date()),
      })
      return
    }
    if (drafting.status === 'ready') {
      appendMessage({
        type: 'system',
        content: t('console.system.ready', {
          projectName: projectName ?? t('console.system.defaultProject'),
        }),
        timestamp: formatTime(new Date()),
      })
      return
    }
    if (drafting.status === 'error') {
      appendMessage({
        type: 'system',
        content: drafting.message || t('console.system.error'),
        timestamp: formatTime(new Date()),
      })
    }
  }, [appendMessage, drafting.message, drafting.status, projectName, t])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    const query = input.trim()
    appendMessage({
      type: 'user',
      content: query,
      timestamp: formatTime(new Date()),
    })
    setInput('')
    start({ query })
  }, [appendMessage, input, start])

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const hasMessages = useMemo(() => messages.length > 0, [messages.length])

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-foreground">{t('console.title')}</h2>
      </div>

      {/* 消息列表 */}
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
            <div className="text-sm text-muted-foreground">
              {t('console.empty')}
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* 输入框 */}
      <div className="flex-shrink-0 p-4">
        <div className="flex gap-2">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={t('console.input.placeholder')}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim()}
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
