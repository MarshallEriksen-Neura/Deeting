'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, History, Send } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { fetchSpecPlanDetail } from '@/lib/api/spec-agent'
import { fetchConversationHistory } from '@/lib/api/conversations'
import { useSpecDraftStream, useSpecPlanHistory } from '@/lib/swr/use-spec-agent'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useI18n } from '@/hooks/use-i18n'

import { TerminalLogs } from '@/components/ui/terminal-logs'

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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null)
  
  const drafting = useSpecAgentStore((state) => state.drafting)
  const conversationSessionId = useSpecAgentStore(
    (state) => state.conversationSessionId
  )
  const projectName = useSpecAgentStore((state) => state.projectName)
  const plannerModel = useSpecAgentStore((state) => state.plannerModel)
  const nodes = useSpecAgentStore((state) => state.nodes)
  const setPlanDetail = useSpecAgentStore((state) => state.setPlanDetail)
  const setSelectedNodeId = useSpecAgentStore((state) => state.setSelectedNodeId)

  const activeNode = useMemo(() => {
    // Priority: Active -> Waiting -> Error -> None
    return nodes.find((n) => n.status === 'active') || 
           nodes.find((n) => n.status === 'waiting') ||
           nodes.find((n) => n.status === 'error' && (n.logs?.length ?? 0) > 0)
  }, [nodes])

  const { start } = useSpecDraftStream()
  const { items, isLoading, isLoadingMore, hasMore, loadMore } = useSpecPlanHistory({
    enabled: historyOpen,
    size: 20,
  })
  const lastDraftStatus = useRef(drafting.status)
  const hydratedSessionRef = useRef<string | null>(null)

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
    if (!conversationSessionId) return
    if (hydratedSessionRef.current === conversationSessionId) return
    let active = true

    const normalizeTimestamp = (value: unknown) => {
      if (typeof value !== 'string') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      return formatTime(date)
    }

    const normalizeContent = (content: unknown, metaInfo?: Record<string, unknown>) => {
      const event = metaInfo?.spec_agent_event
      if (event === 'drafting') {
        return t('console.system.drafting')
      }
      if (event === 'ready') {
        const name =
          typeof metaInfo?.project_name === 'string'
            ? metaInfo.project_name
            : t('console.system.defaultProject')
        return t('console.system.ready', { projectName: name })
      }
      if (event === 'error') {
        return t('console.system.error')
      }
      if (typeof content === 'string') return content
      if (content == null) return ''
      try {
        return JSON.stringify(content)
      } catch {
        return String(content)
      }
    }

    fetchConversationHistory(conversationSessionId, { limit: 200 })
      .then((payload) => {
        if (!active) return
        const normalized = payload.messages.map((message, index) => {
          const metaInfo = message.meta_info ?? {}
          const timestamp =
            normalizeTimestamp(metaInfo.created_at) ||
            formatTime(new Date())
          const type =
            message.role === 'user'
              ? 'user'
              : message.role === 'assistant'
                ? 'agent'
                : 'system'
          return {
            id: `${message.turn_index ?? index}-${message.role}`,
            type,
            content: normalizeContent(message.content, metaInfo),
            timestamp,
          }
        })
        hydratedSessionRef.current = conversationSessionId
        setMessages(normalized)
      })
      .catch(() => {
        if (!active) return
      })

    return () => {
      active = false
    }
  }, [conversationSessionId, t])

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
    if (!plannerModel) {
      appendMessage({
        type: 'system',
        content: t('console.system.modelMissing'),
        timestamp: formatTime(new Date()),
      })
      return
    }
    setInput('')
    start({ query, model: plannerModel })
  }, [appendMessage, input, plannerModel, start, t])

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

  const resolvePlanStatus = useCallback((status: string) => {
    const normalized = status.toUpperCase()
    const mapping: Record<string, string> = {
      DRAFT: 'drafting',
      RUNNING: 'running',
      PAUSED: 'waiting',
      COMPLETED: 'completed',
      FAILED: 'error',
    }
    return mapping[normalized] ?? 'drafting'
  }, [])

  const handleSelectPlan = useCallback(
    async (planId: string) => {
      setHistoryError(null)
      setLoadingPlanId(planId)
      try {
        const detail = await fetchSpecPlanDetail(planId)
        setPlanDetail({
          planId: detail.id,
          conversationSessionId: detail.conversation_session_id ?? null,
          projectName: detail.project_name,
          manifest: detail.manifest,
          connections: detail.connections,
          execution: detail.execution,
        })
        setSelectedNodeId(null)
        setHistoryOpen(false)
        const params = new URLSearchParams(searchParams?.toString())
        params.set('plan', planId)
        if (pathname) {
          const next = params.toString()
          router.replace(next ? `${pathname}?${next}` : pathname)
        }
      } catch {
        setHistoryError(t('history.loadFailed'))
      } finally {
        setLoadingPlanId(null)
      }
    },
    [pathname, router, searchParams, setPlanDetail, setSelectedNodeId, t]
  )

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{t('console.title')}</h2>
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => setHistoryOpen(true)}>
            <History className="w-4 h-4" />
            {t('history.title')}
          </Button>
          <SheetContent side="left" className="w-[360px] p-0">
            <SheetHeader className="px-4 py-4 border-b border-border">
              <SheetTitle>{t('history.title')}</SheetTitle>
              <SheetDescription>{t('history.subtitle')}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col h-full">
              <ScrollArea className="flex-1 px-2 py-3">
                <div className="space-y-2">
                  {isLoading && items.length === 0 && (
                    <div className="text-sm text-muted-foreground px-3 py-2">
                      {t('history.loading')}
                    </div>
                  )}
                  {!isLoading && items.length === 0 && (
                    <div className="text-sm text-muted-foreground px-3 py-2">
                      {t('history.empty')}
                    </div>
                  )}
                  {historyError && (
                    <div className="text-sm text-destructive px-3 py-2">
                      {historyError}
                    </div>
                  )}
                  {items.map((plan) => {
                    const statusKey = resolvePlanStatus(plan.status)
                    return (
                      <Button
                        key={plan.id}
                        variant="ghost"
                        className="w-full justify-between px-3 py-3 h-auto rounded-xl border border-transparent hover:border-border"
                        onClick={() => void handleSelectPlan(plan.id)}
                        disabled={loadingPlanId === plan.id}
                      >
                        <span className="flex flex-col items-start gap-1 text-left">
                          <span className="text-sm font-medium text-foreground">
                            {plan.project_name || t('history.untitled')}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-2">
                            <Clock className="w-3 h-3" />
                            {new Date(plan.updated_at).toLocaleString()}
                          </span>
                        </span>
                        <Badge variant={statusKey === 'error' ? 'destructive' : 'secondary'}>
                          {t(`statusbar.status.${statusKey}`)}
                        </Badge>
                      </Button>
                    )
                  })}
                </div>
              </ScrollArea>
              <div className="px-4 py-3 border-t border-border">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!hasMore || isLoadingMore}
                  onClick={loadMore}
                >
                  {hasMore ? t('history.loadMore') : t('history.noMore')}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
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

          {/* Real-time Execution Logs */}
          {activeNode && activeNode.logs && activeNode.logs.length > 0 && (
            <div className="mt-6 border-t border-white/10 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${
                  activeNode.status === 'active' ? 'bg-emerald-500 animate-pulse' : 
                  activeNode.status === 'error' ? 'bg-red-500' : 'bg-amber-500'
                }`} />
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  {activeNode.title}
                </span>
              </div>
              <TerminalLogs logs={activeNode.logs} />
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* 输入框 */}
      <div className="flex-shrink-0 p-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={t('console.input.placeholder')}
            className="flex-1 min-h-[40px] resize-none"
            rows={1}
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
