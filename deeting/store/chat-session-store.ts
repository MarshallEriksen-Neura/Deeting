"use client"

/**
 * chat-session-store.ts - 兼容层
 *
 * 此文件保留用于向后兼容。新代码应直接使用 @/store/chat-store
 *
 * @deprecated 请使用 @/store/chat-store
 */

import { useChatStore } from "./chat-store"

/**
 * @deprecated 请使用 useChatStore
 */
export const useChatSessionStore = <T = ReturnType<typeof createSessionStoreApi>>(
  selector?: (state: ReturnType<typeof createSessionStoreApi>) => T
): T => {
  const api = createSessionStoreApi()

  if (selector) {
    return selector(api)
  }
  return api as T
}

function createSessionStoreApi() {
  const store = useChatStore.getState()
  const setState = useChatStore.setState

  return {
    // 会话相关
    sessionId: store.sessionId,
    setSessionId: (sessionId?: string) => setState({ sessionId: sessionId ?? null }),

    // 全局加载状态
    globalLoading: store.globalLoading,
    setGlobalLoading: (globalLoading: boolean) => setState({ globalLoading }),

    // 加载状态
    isLoading: store.isLoading,
    setIsLoading: (isLoading: boolean) => setState({ isLoading }),

    // 历史记录加载
    historyCursor: store.historyCursor,
    historyHasMore: store.historyHasMore,
    historyLoading: store.isLoading,
    setHistoryState: (state: {
      cursor?: number | null
      hasMore?: boolean
      loading?: boolean
    }) => {
      const updates: Partial<typeof store> = {}
      if (state.cursor !== undefined) updates.historyCursor = state.cursor
      if (state.hasMore !== undefined) updates.historyHasMore = state.hasMore
      if (state.loading !== undefined) updates.isLoading = state.loading
      setState(updates)
    },

    // 错误状态
    errorMessage: store.errorMessage,
    setErrorMessage: (errorMessage: string | null) => setState({ errorMessage }),

    // 状态信息
    statusStage: store.statusStage,
    statusStep: null as string | null,
    statusState: null as string | null,
    statusCode: store.statusCode,
    statusMeta: store.statusMeta,

    setStatus: (status: {
      stage?: string | null
      step?: string | null
      state?: string | null
      code?: string | null
      meta?: Record<string, unknown> | null
    }) => {
      const updates: Partial<typeof store> = {}
      if (status.stage !== undefined) updates.statusStage = status.stage
      if (status.code !== undefined) updates.statusCode = status.code
      if (status.meta !== undefined) updates.statusMeta = status.meta
      setState(updates)
    },

    clearStatus: () =>
      setState({
        statusStage: null,
        statusCode: null,
        statusMeta: null,
      }),

    // 重置会话
    resetSession: () => useChatStore.getState().resetSession(),
  }
}
