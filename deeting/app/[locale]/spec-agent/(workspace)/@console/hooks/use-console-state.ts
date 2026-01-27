import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { fetchSpecPlanDetail } from '@/lib/api/spec-agent'
import { fetchConversationHistory } from '@/lib/api/conversations'
import { useSpecDraftStream, useSpecPlanHistory } from '@/lib/swr/use-spec-agent'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import type { ConsoleMessage } from '../types'
import { formatTime } from '../console-utils'

export const useConsoleState = (t: (key: string, params?: Record<string, string>) => string) => {
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
  const setHighlightNodeId = useSpecAgentStore(
    (state) => state.setHighlightNodeId
  )
  const setFocusNodeId = useSpecAgentStore((state) => state.setFocusNodeId)

  const activeNode = useMemo(() => {
    return (
      nodes.find((n) => n.status === 'active') ||
      nodes.find((n) => n.status === 'waiting') ||
      nodes.find((n) => n.status === 'error' && (n.logs?.length ?? 0) > 0)
    )
  }, [nodes])

  const { items, isLoading, isLoadingMore, hasMore, loadMore } =
    useSpecPlanHistory({ enabled: historyOpen, size: 20 })
  const lastDraftStatus = useRef(drafting.status)
  const hydratedSessionRef = useRef<string | null>(null)
  const hydrationRequestRef = useRef(0)
  const isMountedRef = useRef(true)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    return () => {
      isMountedRef.current = false
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      if (locateTimerRef.current) {
        clearTimeout(locateTimerRef.current)
        locateTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const cached = sessionStorage.getItem('deeting-spec-agent:console-state')
    if (!cached) return
    try {
      const parsed = JSON.parse(cached) as {
        input?: string
        historyOpen?: boolean
      }
      if (typeof parsed.input === 'string') setInput(parsed.input)
      if (typeof parsed.historyOpen === 'boolean') setHistoryOpen(parsed.historyOpen)
    } catch {
      // ignore malformed cache
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem(
      'deeting-spec-agent:console-state',
      JSON.stringify({ input, historyOpen })
    )
  }, [historyOpen, input])

  const highlightKey = useMemo(() => {
    if (!activeNode) return ''
    return `${activeNode.id}-${activeNode.status}-${activeNode.logs?.length ?? 0}`
  }, [activeNode])

  useEffect(() => {
    if (!activeNode?.id) {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      setHighlightNodeId(null)
      return
    }
    setHighlightNodeId(activeNode.id)
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightNodeId(null)
    }, 1200)
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [activeNode?.id, highlightKey, setHighlightNodeId])

  const handleLocateNode = useCallback(
    (nodeId: string) => {
      if (!nodeId) return
      setFocusNodeId(nodeId)
      setHighlightNodeId(nodeId)
      if (locateTimerRef.current) {
        clearTimeout(locateTimerRef.current)
      }
      locateTimerRef.current = setTimeout(() => {
        setHighlightNodeId(null)
      }, 1800)
    },
    [setFocusNodeId, setHighlightNodeId]
  )

  const hydrateConversation = useCallback(
    (sessionId: string) => {
      if (!sessionId) return
      if (hydratedSessionRef.current === sessionId) return
      const requestId = ++hydrationRequestRef.current

      const normalizeTimestamp = (value: unknown) => {
        if (typeof value !== 'string') return ''
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return ''
        return formatTime(date)
      }

      const normalizeContent = (
        content: unknown,
        metaInfo?: Record<string, unknown>
      ) => {
        const event = metaInfo?.spec_agent_event
        const nodeId =
          typeof metaInfo?.spec_agent_node_id === 'string'
            ? metaInfo.spec_agent_node_id
            : typeof metaInfo?.node_id === 'string'
              ? metaInfo.node_id
              : ''
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
        if (event === 'node_started') {
          return t('console.system.nodeStarted', { nodeId })
        }
        if (event === 'node_waiting') {
          return t('console.system.nodeWaiting', { nodeId })
        }
        if (event === 'node_failed') {
          return t('console.system.nodeFailed', { nodeId })
        }
        if (typeof content === 'string') return content
        if (content == null) return ''
        try {
          return JSON.stringify(content)
        } catch {
          return String(content)
        }
      }

      fetchConversationHistory(sessionId, { limit: 200 })
        .then((payload) => {
          if (!isMountedRef.current) return
          if (hydrationRequestRef.current !== requestId) return
          const normalized = payload.messages.map((message, index) => {
            const metaInfo = message.meta_info ?? {}
            const timestamp =
              normalizeTimestamp(metaInfo.created_at) || formatTime(new Date())
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
              meta: metaInfo,
            }
          })
          hydratedSessionRef.current = sessionId
          setMessages(normalized)
        })
        .catch(() => {
          if (!isMountedRef.current) return
        })
    },
    [t]
  )

  const { start } = useSpecDraftStream({
    onPlanInit: (data) => {
      if (data.conversation_session_id) {
        hydrateConversation(data.conversation_session_id)
      }
    },
  })

  useEffect(() => {
    if (!conversationSessionId) return
    hydrateConversation(conversationSessionId)
  }, [conversationSessionId, hydrateConversation])

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
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
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

  return {
    input,
    setInput,
    messages,
    hasMessages,
    activeNode,
    nodes,
    historyOpen,
    setHistoryOpen,
    historyError,
    loadingPlanId,
    historyItems: items,
    historyLoading: isLoading,
    historyLoadingMore: isLoadingMore,
    historyHasMore: hasMore,
    loadMoreHistory: loadMore,
    handleSend,
    handleKeyPress,
    resolvePlanStatus,
    handleSelectPlan,
    handleLocateNode,
  }
}
