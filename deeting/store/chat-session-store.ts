"use client"

import { create } from "zustand"

// 会话管理 Store
interface ChatSessionStore {
  // 会话相关
  sessionId?: string
  setSessionId: (sessionId?: string) => void
  
  // 全局加载状态（如新建会话等）
  globalLoading: boolean
  setGlobalLoading: (loading: boolean) => void

  // 加载状态
  isLoading: boolean
  setIsLoading: (loading: boolean) => void

  // 历史记录加载
  historyCursor: number | null
  historyHasMore: boolean
  historyLoading: boolean
  setHistoryState: (state: {
    cursor?: number | null
    hasMore?: boolean
    loading?: boolean
  }) => void
  
  // 错误状态
  errorMessage: string | null
  setErrorMessage: (error: string | null) => void
  
  // 状态信息
  statusStage: string | null
  statusStep: string | null
  statusState: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
  setStatus: (status: {
    stage?: string | null
    step?: string | null
    state?: string | null
    code?: string | null
    meta?: Record<string, unknown> | null
  }) => void
  clearStatus: () => void
  
  // 重置会话
  resetSession: () => void
}

export const useChatSessionStore = create<ChatSessionStore>((set) => ({
  // 会话相关
  sessionId: undefined,
  setSessionId: (sessionId) => set({ sessionId }),

  // 全局加载状态
  globalLoading: false,
  setGlobalLoading: (globalLoading) => set({ globalLoading }),

  // 加载状态
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),

  // 历史记录加载
  historyCursor: null,
  historyHasMore: false,
  historyLoading: false,
  setHistoryState: (state) => set((prev) => ({
    historyCursor: state.cursor !== undefined ? state.cursor : prev.historyCursor,
    historyHasMore: state.hasMore !== undefined ? state.hasMore : prev.historyHasMore,
    historyLoading: state.loading !== undefined ? state.loading : prev.historyLoading,
  })),

  // 错误状态
  errorMessage: null,
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  // 状态信息
  statusStage: null,
  statusStep: null,
  statusState: null,
  statusCode: null,
  statusMeta: null,
  
  setStatus: (status) => set((state) => ({
    statusStage: status.stage !== undefined ? status.stage : state.statusStage,
    statusStep: status.step !== undefined ? status.step : state.statusStep,
    statusState: status.state !== undefined ? status.state : state.statusState,
    statusCode: status.code !== undefined ? status.code : state.statusCode,
    statusMeta: status.meta !== undefined ? status.meta : state.statusMeta,
  })),

  clearStatus: () => set({
    statusStage: null,
    statusStep: null,
    statusState: null,
    statusCode: null,
    statusMeta: null,
  }),

  // 重置会话
  resetSession: () => set({
    sessionId: undefined,
    globalLoading: false,
    isLoading: false,
    errorMessage: null,
    statusStage: null,
    statusStep: null,
    statusState: null,
    statusCode: null,
    statusMeta: null,
    historyCursor: null,
    historyHasMore: false,
    historyLoading: false,
  }),
}))
