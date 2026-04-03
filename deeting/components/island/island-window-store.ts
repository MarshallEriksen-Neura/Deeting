"use client";

import { create } from "zustand";

import {
  approveIslandTool,
  rejectIslandTool,
  streamIslandTextConversation,
  type IslandChatRequestConfig,
} from "@/lib/api/island";
import { createConversation } from "@/lib/api/conversations";
import { loadConversationHistoryPage } from "@/lib/chat/history-loader";
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri";

import type { IslandApproval, IslandMode, IslandRecentMessage } from "./island-store";
import {
  buildIslandWindowDerivedState,
  truncateIslandText,
} from "./island-window-derived-state";
import {
  type IslandStatusStep,
  resolveIslandRuntimeStatus,
} from "./island-runtime-status";

interface IslandWindowState {
  mode: IslandMode;
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  lastReplyAt: number | null;
  recentMessages: IslandRecentMessage[];
  pendingApproval: IslandApproval | null;
  isBusy: boolean;
  errorMessage: string | null;
  sessionId: string | null;
  selectedAssistantId: string | null;
  chatRequestConfig: IslandChatRequestConfig | null;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  stageHistory: IslandStatusStep[];
  suspendRemoteSync: boolean;

  expand: () => void;
  collapse: () => void;
  hide: () => void;
  toggleExpand: () => void;
  restoreWorkspace: () => void;
  syncFromEvent: (payload: IslandSyncPayload) => void;
  sendQuickReply: (text: string) => Promise<void>;
  approvePendingApproval: () => Promise<void>;
  rejectPendingApproval: () => Promise<void>;
}

export interface IslandSyncPayload {
  mode: IslandMode;
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  lastReplyAt: number | null;
  recentMessages: IslandRecentMessage[];
  pendingApproval: IslandApproval | null;
  isBusy: boolean;
  errorMessage: string | null;
  sessionId: string | null;
  selectedAssistantId: string | null;
  chatRequestConfig?: IslandChatRequestConfig | null;
  statusStage?: string | null;
  statusCode?: string | null;
  statusMeta?: Record<string, unknown> | null;
  stageHistory?: IslandStatusStep[];
}

type IslandActionCompletedPayload = {
  sessionId: string | null;
};

async function emitActionCompleted(payload: IslandActionCompletedPayload) {
  const { emit } = await import("@tauri-apps/api/event");
  await emit("island:action-completed", payload);
}

function buildOptimisticRecentMessages(
  recentMessages: IslandRecentMessage[],
  content: string
) {
  const optimisticMessage: IslandRecentMessage = {
    role: "user",
    content,
    createdAt: Date.now(),
  };
  return [...recentMessages, optimisticMessage].slice(-8);
}

function upsertStreamingAssistantPreview(
  recentMessages: IslandRecentMessage[],
  content: string
) {
  const preview = truncateIslandText(content.trim(), 220);
  if (!preview) {
    return recentMessages;
  }

  const nextMessages = [...recentMessages];
  const nextAssistant: IslandRecentMessage = {
    role: "assistant",
    content: preview,
    createdAt: Date.now(),
  };

  if (nextMessages.at(-1)?.role === "assistant") {
    nextMessages[nextMessages.length - 1] = nextAssistant;
  } else {
    nextMessages.push(nextAssistant);
  }

  return nextMessages.slice(-8);
}

async function loadIslandWindowStateFromHistory(sessionId: string) {
  const history = await loadConversationHistoryPage(sessionId, {
    limit: 200,
    idPrefix: sessionId,
    isTauriRuntime: detectTauriRuntime(),
  });

  return buildIslandWindowDerivedState({
    selectedAssistant: null,
    messages: history.messages,
    isLoading: false,
    globalLoading: false,
    statusCode: null,
    errorMessage: null,
  });
}

async function ensureSessionId(
  sessionId: string | null,
  selectedAssistantId: string | null
) {
  if (sessionId) {
    return sessionId;
  }

  const created = await createConversation({
    assistant_id: selectedAssistantId ?? undefined,
  });
  return created.session_id;
}

export const useIslandWindowStore = create<IslandWindowState>((set, get) => ({
  mode: "collapsed",
  statusLabel: "Idle",
  summaryText: "Connecting to workspace...",
  lastReplyText: "No replies yet.",
  lastReplyAt: null,
  recentMessages: [],
  pendingApproval: null,
  isBusy: false,
  errorMessage: null,
  sessionId: null,
  selectedAssistantId: null,
  chatRequestConfig: null,
  statusStage: null,
  statusCode: null,
  statusMeta: null,
  stageHistory: [],
  suspendRemoteSync: false,

  expand: () => set({ mode: "expanded" }),
  collapse: () => set({ mode: "collapsed" }),
  hide: () => set({ mode: "hidden" }),
  toggleExpand: () =>
    set((state) => ({
      mode: state.mode === "expanded" ? "collapsed" : "expanded",
    })),

  restoreWorkspace: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("show_main_hide_island");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restore workspace";
      set({ errorMessage: message });
    }
  },

  syncFromEvent: (payload) => {
    if (get().suspendRemoteSync) {
      set((state) => ({
        sessionId: payload.sessionId ?? state.sessionId,
        selectedAssistantId: payload.selectedAssistantId ?? state.selectedAssistantId,
        chatRequestConfig: payload.chatRequestConfig ?? state.chatRequestConfig,
        statusStage: payload.statusStage ?? state.statusStage,
        statusCode: payload.statusCode ?? state.statusCode,
        statusMeta: payload.statusMeta ?? state.statusMeta,
        stageHistory: payload.stageHistory ?? state.stageHistory,
      }));
      return;
    }

    set({
      statusLabel: payload.statusLabel,
      summaryText: payload.summaryText,
      lastReplyText: payload.lastReplyText,
      lastReplyAt: payload.lastReplyAt,
      recentMessages: payload.recentMessages,
      pendingApproval: payload.pendingApproval,
      isBusy: payload.isBusy,
      errorMessage: payload.errorMessage,
      sessionId: payload.sessionId,
      selectedAssistantId: payload.selectedAssistantId,
      chatRequestConfig: payload.chatRequestConfig ?? null,
      statusStage: payload.statusStage ?? null,
      statusCode: payload.statusCode ?? null,
      statusMeta: payload.statusMeta ?? null,
      stageHistory: payload.stageHistory ?? [],
    });
  },

  sendQuickReply: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const previousState = get();
    const requestConfig = previousState.chatRequestConfig;
    if (!requestConfig) {
      set({ errorMessage: "No chat model selected" });
      return;
    }

    let streamErrorMessage: string | null = null;
    set({
      isBusy: true,
      errorMessage: null,
      suspendRemoteSync: true,
      statusLabel: "Working...",
      summaryText: truncateIslandText(trimmed, 52),
      recentMessages: buildOptimisticRecentMessages(previousState.recentMessages, trimmed),
      pendingApproval: null,
      statusStage: "listen",
      statusCode: null,
      statusMeta: null,
      stageHistory: [],
    });

    try {
      const sessionId = await ensureSessionId(
        previousState.sessionId,
        previousState.selectedAssistantId
      );
      await streamIslandTextConversation(sessionId, trimmed, requestConfig, {
        onDelta: (_delta, snapshot) => {
          set((state) => ({
            statusLabel: "Working...",
            lastReplyText: truncateIslandText(snapshot, 220),
            lastReplyAt: Date.now(),
            recentMessages: upsertStreamingAssistantPreview(state.recentMessages, snapshot),
          }));
        },
        onMessage: (data) => {
          if (
            data &&
            typeof data === "object" &&
            "type" in data &&
            (data as { type?: string }).type === "status"
          ) {
            const streamStatus = data as {
              stage?: string | null;
              code?: string | null;
              meta?: Record<string, unknown> | null;
            };
            set((state) => {
              const runtimeStatus = resolveIslandRuntimeStatus(
                {
                  selectedAssistant: null,
                  messages: [],
                  isLoading: true,
                  globalLoading: false,
                  statusStage: streamStatus.stage ?? null,
                  statusCode: streamStatus.code ?? null,
                  statusMeta: streamStatus.meta ?? null,
                  errorMessage: null,
                },
                state.pendingApproval,
                state.stageHistory
              );
              return {
                statusStage: runtimeStatus.statusStage,
                statusCode: runtimeStatus.statusCode,
                statusMeta: runtimeStatus.statusMeta,
                stageHistory: runtimeStatus.stageHistory,
              };
            });
            return;
          }
          if (
            data &&
            typeof data === "object" &&
            "type" in data &&
            (data as { type?: string }).type === "error"
          ) {
            streamErrorMessage =
              typeof (data as { message?: unknown }).message === "string"
                ? (data as { message: string }).message
                : "Island send failed";
          }
        },
      });
      if (streamErrorMessage) {
        throw new Error(streamErrorMessage);
      }
      const nextState = await loadIslandWindowStateFromHistory(sessionId);
      set({
        ...nextState,
        sessionId,
        selectedAssistantId: previousState.selectedAssistantId,
        chatRequestConfig: previousState.chatRequestConfig,
        statusStage: previousState.statusStage,
        statusCode: previousState.statusCode,
        statusMeta: previousState.statusMeta,
        stageHistory: previousState.stageHistory,
        isBusy: false,
        suspendRemoteSync: false,
      });
      await emitActionCompleted({ sessionId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Island send failed";
      set({
        statusLabel: previousState.statusLabel,
        summaryText: previousState.summaryText,
        lastReplyText: previousState.lastReplyText,
        lastReplyAt: previousState.lastReplyAt,
        recentMessages: previousState.recentMessages,
        pendingApproval: previousState.pendingApproval,
        errorMessage: message,
        selectedAssistantId: previousState.selectedAssistantId,
        chatRequestConfig: previousState.chatRequestConfig,
        statusStage: previousState.statusStage,
        statusCode: previousState.statusCode,
        statusMeta: previousState.statusMeta,
        stageHistory: previousState.stageHistory,
        isBusy: false,
        suspendRemoteSync: false,
      });
    }
  },

  approvePendingApproval: async () => {
    const approval = get().pendingApproval;
    if (!approval) return;

    const sessionId = get().sessionId;
    if (!sessionId) {
      set({ errorMessage: "No active session" });
      return;
    }

    const previousState = get();
    set({ isBusy: true, errorMessage: null, suspendRemoteSync: true });
    try {
      await approveIslandTool(
        approval.approvalToken,
        approval.toolName,
        approval.callId
      );
      const nextState = await loadIslandWindowStateFromHistory(sessionId);
      set({
        ...nextState,
        sessionId,
        selectedAssistantId: previousState.selectedAssistantId,
        chatRequestConfig: previousState.chatRequestConfig,
        isBusy: false,
        suspendRemoteSync: false,
      });
      await emitActionCompleted({ sessionId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Island approval failed";
      set({
        statusLabel: previousState.statusLabel,
        summaryText: previousState.summaryText,
        lastReplyText: previousState.lastReplyText,
        lastReplyAt: previousState.lastReplyAt,
        recentMessages: previousState.recentMessages,
        pendingApproval: previousState.pendingApproval,
        errorMessage: message,
        selectedAssistantId: previousState.selectedAssistantId,
        chatRequestConfig: previousState.chatRequestConfig,
        isBusy: false,
        suspendRemoteSync: false,
      });
    }
  },

  rejectPendingApproval: async () => {
    const approval = get().pendingApproval;
    if (!approval) return;

    const sessionId = get().sessionId;
    if (!sessionId) {
      set({ errorMessage: "No active session" });
      return;
    }

    const previousState = get();
    set({ isBusy: true, errorMessage: null, suspendRemoteSync: true });
    try {
      await rejectIslandTool(approval.approvalToken, approval.toolName);
      const nextState = await loadIslandWindowStateFromHistory(sessionId);
      set({
        ...nextState,
        sessionId,
        selectedAssistantId: previousState.selectedAssistantId,
        chatRequestConfig: previousState.chatRequestConfig,
        isBusy: false,
        suspendRemoteSync: false,
      });
      await emitActionCompleted({ sessionId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Island rejection failed";
      set({
        statusLabel: previousState.statusLabel,
        summaryText: previousState.summaryText,
        lastReplyText: previousState.lastReplyText,
        lastReplyAt: previousState.lastReplyAt,
        recentMessages: previousState.recentMessages,
        pendingApproval: previousState.pendingApproval,
        errorMessage: message,
        selectedAssistantId: previousState.selectedAssistantId,
        chatRequestConfig: previousState.chatRequestConfig,
        isBusy: false,
        suspendRemoteSync: false,
      });
    }
  },
}));
