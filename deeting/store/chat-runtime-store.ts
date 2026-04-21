"use client"

import { create } from "zustand"
import type { PendingChatTakeover, PendingTakeoverRequestedAction } from "@/store/chat-store"
import { loadConversationHistoryPage } from "@/lib/chat/history-loader"
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"
import { useChatStore } from "@/store/chat-store"

async function readConversationHistoryState(sessionId: string) {
  const page = await loadConversationHistoryPage(sessionId, {
    limit: 30,
    idPrefix: sessionId,
    isTauriRuntime: detectTauriRuntime(),
  })

  return {
    messages: page.messages,
    historyCursor: page.nextCursor,
    historyHasMore: page.hasMore,
  }
}

function mirrorRuntimePatchToChatStore(patch: Partial<{
  sessionId: string | null
  isLoading: boolean
  globalLoading: boolean
  statusMessageId: string | null
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
  errorMessage: string | null
  historyCursor: number | null
  historyHasMore: boolean
  pendingTakeover: PendingChatTakeover | null
  pendingTakeoverRequestedAction: PendingTakeoverRequestedAction | null
}>) {
  useChatStore.setState(patch)
}

interface ChatRuntimeStore {
  sessionId: string | null
  initialized: boolean
  isLoading: boolean
  globalLoading: boolean
  activeMessageId: string | null
  interruptedMessageId: string | null
  statusMessageId: string | null
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
  errorMessage: string | null
  historyCursor: number | null
  historyHasMore: boolean
  pendingTakeover: PendingChatTakeover | null
  pendingTakeoverRequestedAction: PendingTakeoverRequestedAction | null
  initSession: (sessionId: string | null) => Promise<void>
  loadHistory: (sessionId: string) => Promise<void>
  resetSession: () => void
  setSessionId: (sessionId: string | null) => void
  setIsLoading: (loading: boolean) => void
  setGlobalLoading: (loading: boolean) => void
  setActiveMessageId: (messageId: string | null) => void
  setInterruptedMessageId: (messageId: string | null) => void
  setStatus: (status: {
    messageId?: string | null
    stage?: string | null
    code?: string | null
    meta?: Record<string, unknown> | null
  }) => void
  clearStatus: () => void
  setErrorMessage: (message: string | null) => void
  setHistoryState: (state: { cursor?: number | null; hasMore?: boolean; loading?: boolean }) => void
  setPendingTakeover: (draft: {
    input: string
    attachments: PendingChatTakeover["attachments"]
    selectedKnowledgeFileIds: string[]
    pageContext?: PendingChatTakeover["pageContext"]
  } | null) => void
  setPendingTakeoverRequestedAction: (action: PendingTakeoverRequestedAction | null) => void
  clearPendingTakeover: () => void
}

function isStatusMetaEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null
) {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

const emptyRuntimeState = {
  sessionId: null,
  initialized: false,
  isLoading: false,
  globalLoading: false,
  activeMessageId: null,
  interruptedMessageId: null,
  statusMessageId: null,
  statusStage: null,
  statusCode: null,
  statusMeta: null,
  errorMessage: null,
  historyCursor: null,
  historyHasMore: false,
  pendingTakeover: null,
  pendingTakeoverRequestedAction: null,
} satisfies Omit<
  ChatRuntimeStore,
  | "initSession"
  | "loadHistory"
  | "resetSession"
  | "setSessionId"
  | "setIsLoading"
  | "setGlobalLoading"
  | "setActiveMessageId"
  | "setInterruptedMessageId"
  | "setStatus"
  | "clearStatus"
  | "setErrorMessage"
  | "setHistoryState"
  | "setPendingTakeover"
  | "setPendingTakeoverRequestedAction"
  | "clearPendingTakeover"
>

export const useChatRuntimeStore = create<ChatRuntimeStore>()((set, get) => ({
  ...emptyRuntimeState,

  initSession: async (sessionId) => {
    const state = get()
    const isNewSession = state.sessionId !== sessionId
    const shouldRefreshCurrentSession =
      state.initialized && !isNewSession && Boolean(sessionId) && !state.isLoading

    if (state.initialized && !isNewSession && !shouldRefreshCurrentSession) {
      return
    }

    const shouldReset = isNewSession
    const shouldLoadHistory = Boolean(sessionId) && (shouldReset || shouldRefreshCurrentSession)
    const nextHistoryLoading = shouldReset || shouldLoadHistory

    set({
      sessionId,
      initialized: true,
      isLoading: nextHistoryLoading,
      ...(shouldReset
        ? { ...emptyRuntimeState, sessionId, initialized: true, isLoading: nextHistoryLoading }
        : {}),
    })
    mirrorRuntimePatchToChatStore({
      sessionId,
      isLoading: nextHistoryLoading,
      ...(shouldReset
        ? {
            statusMessageId: null,
            statusStage: null,
            statusCode: null,
            statusMeta: null,
            errorMessage: null,
            historyCursor: null,
            historyHasMore: false,
            pendingTakeover: null,
            pendingTakeoverRequestedAction: null,
          }
        : {}),
    })

    try {
      let messages = shouldReset ? [] : useChatStore.getState().messages
      let historyCursor: number | null = shouldReset ? null : state.historyCursor
      let historyHasMore = shouldReset ? false : state.historyHasMore

      if (shouldLoadHistory && sessionId) {
        try {
          const historyState = await readConversationHistoryState(sessionId)
          messages = historyState.messages
          historyCursor = historyState.historyCursor
          historyHasMore = historyState.historyHasMore
        } catch (error) {
          console.error("Failed to load history:", error)
          if (shouldReset) {
            messages = []
            historyCursor = null
            historyHasMore = false
          }
        }
      }

      useChatStore.setState({
        ...(shouldReset
          ? {
              messages: [],
              focusedMessageId: null,
              input: "",
              attachments: [],
              selectedKnowledgeFileIds: [],
              pageContext: null,
              compareByMessageId: {},
            }
          : {}),
        messages,
        compareByMessageId: {},
      })

      set({
        historyCursor,
        historyHasMore,
        isLoading: false,
      })
      mirrorRuntimePatchToChatStore({
        historyCursor,
        historyHasMore,
        isLoading: false,
      })
    } catch (error) {
      console.error("initSession error:", error)
      set({ isLoading: false, errorMessage: "Failed to initialize session" })
      mirrorRuntimePatchToChatStore({
        isLoading: false,
        errorMessage: "Failed to initialize session",
      })
    }
  },

  loadHistory: async (sessionId) => {
    const state = get()
    if (state.isLoading) return

    set({ isLoading: true, sessionId })
    mirrorRuntimePatchToChatStore({ isLoading: true, sessionId })

    try {
      const historyState = await readConversationHistoryState(sessionId)
      useChatStore.setState({
        messages: historyState.messages,
        compareByMessageId: {},
      })
      set({
        historyCursor: historyState.historyCursor,
        historyHasMore: historyState.historyHasMore,
      })
      mirrorRuntimePatchToChatStore({
        historyCursor: historyState.historyCursor,
        historyHasMore: historyState.historyHasMore,
      })
    } catch (error) {
      console.error("Failed to load history:", error)
      useChatStore.setState({
        messages: [],
        compareByMessageId: {},
      })
      set({
        historyCursor: null,
        historyHasMore: false,
      })
      mirrorRuntimePatchToChatStore({
        historyCursor: null,
        historyHasMore: false,
      })
    } finally {
      set({ isLoading: false })
      mirrorRuntimePatchToChatStore({ isLoading: false })
    }
  },

  resetSession: () => {
    useChatStore.setState({
      messages: [],
      focusedMessageId: null,
      compareByMessageId: {},
      input: "",
      attachments: [],
      selectedKnowledgeFileIds: [],
      pageContext: null,
    })
    set({
      ...emptyRuntimeState,
    })
    mirrorRuntimePatchToChatStore({
      sessionId: null,
      isLoading: false,
      globalLoading: false,
      statusMessageId: null,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
      errorMessage: null,
      historyCursor: null,
      historyHasMore: false,
      pendingTakeover: null,
      pendingTakeoverRequestedAction: null,
    })
  },

  setSessionId: (sessionId) => {
    set({ sessionId })
    mirrorRuntimePatchToChatStore({ sessionId })
  },
  setIsLoading: (isLoading) => {
    set({ isLoading })
    mirrorRuntimePatchToChatStore({ isLoading })
  },
  setGlobalLoading: (globalLoading) => {
    set({ globalLoading })
    mirrorRuntimePatchToChatStore({ globalLoading })
  },
  setActiveMessageId: (messageId) =>
    set({
      activeMessageId:
        typeof messageId === "string" && messageId.trim().length > 0 ? messageId.trim() : null,
    }),
  setInterruptedMessageId: (messageId) =>
    set({
      interruptedMessageId:
        typeof messageId === "string" && messageId.trim().length > 0 ? messageId.trim() : null,
    }),
  setStatus: (status) =>
    set((state) => {
      const nextMessageId =
        status.messageId !== undefined ? status.messageId : state.statusMessageId
      const nextStage = status.stage !== undefined ? status.stage : state.statusStage
      const nextCode = status.code !== undefined ? status.code : state.statusCode
      const nextMeta = status.meta !== undefined ? status.meta : state.statusMeta

      if (
        nextMessageId === state.statusMessageId &&
        nextStage === state.statusStage &&
        nextCode === state.statusCode &&
        isStatusMetaEqual(state.statusMeta, nextMeta)
      ) {
        return state
      }

      const patch = {
        statusMessageId: nextMessageId,
        statusStage: nextStage,
        statusCode: nextCode,
        statusMeta: nextMeta,
      }
      mirrorRuntimePatchToChatStore(patch)
      return patch
    }),
  clearStatus: () =>
    {
      const patch = {
        statusMessageId: null,
        statusStage: null,
        statusCode: null,
        statusMeta: null,
      }
      set(patch)
      mirrorRuntimePatchToChatStore(patch)
    },
  setErrorMessage: (errorMessage) => {
    set({ errorMessage })
    mirrorRuntimePatchToChatStore({ errorMessage })
  },
  setHistoryState: (state) =>
    {
      const patch = {
        ...(state.cursor !== undefined ? { historyCursor: state.cursor } : {}),
        ...(state.hasMore !== undefined ? { historyHasMore: state.hasMore } : {}),
        ...(state.loading !== undefined ? { isLoading: state.loading } : {}),
      }
      set(patch)
      mirrorRuntimePatchToChatStore(patch)
    },
  setPendingTakeover: (draft) =>
    {
      const pendingTakeover = draft
        ? {
            input: draft.input,
            attachments: draft.attachments,
            selectedKnowledgeFileIds: Array.from(
              new Set(
                draft.selectedKnowledgeFileIds
                  .map((value) => value.trim())
                  .filter((value) => value.length > 0)
              )
            ),
            pageContext: draft.pageContext ?? null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        : null
      const patch = {
        pendingTakeover,
        pendingTakeoverRequestedAction: null,
      }
      set(patch)
      mirrorRuntimePatchToChatStore(patch)
    },
  setPendingTakeoverRequestedAction: (pendingTakeoverRequestedAction) =>
    set((state) => {
      const patch = {
        pendingTakeoverRequestedAction: state.pendingTakeover
          ? pendingTakeoverRequestedAction
          : null,
      }
      mirrorRuntimePatchToChatStore(patch)
      return patch
    }),
  clearPendingTakeover: () =>
    {
      const patch = {
        pendingTakeover: null,
        pendingTakeoverRequestedAction: null,
      }
      set(patch)
      mirrorRuntimePatchToChatStore(patch)
    },
}))
