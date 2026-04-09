"use client";

import { create } from "zustand";

import {
  approveIslandTool,
  rejectIslandTool,
  streamIslandTextConversation,
} from "@/lib/api/island";
import { createConversation } from "@/lib/api/conversations";
import { loadConversationHistoryPage } from "@/lib/chat/history-loader";
import { extractAssistantTextFromBlocks } from "@/lib/chat/message-blocks";
import { findUnresolvedToolApprovals } from "@/lib/chat/tool-approval";
import type { Message } from "@/lib/chat/message-types";
import { useChatStore } from "@/store/chat-store";
import { useChatRuntimeStore } from "@/store/chat-runtime-store";
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri";
import { resolveIslandChatRequestConfig } from "./island-chat-request";
import {
  type IslandStatusStep,
  resolveIslandRuntimeStatus,
} from "./island-runtime-status";

export interface IslandRecentMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface IslandApproval {
  id: string;
  title: string;
  desc: string;
  approvalToken: string;
  toolName: string;
  callId?: string | null;
}

export type IslandMode = "collapsed" | "expanded" | "hidden";

type IslandChatSnapshot = {
  sessionId: string | null;
  messages: Message[];
  isLoading: boolean;
  globalLoading: boolean;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  errorMessage: string | null;
};

interface IslandState {
  mode: IslandMode;
  statusLabel: string;
  summaryText: string;
  lastReplyText: string;
  lastReplyAt: number | null;
  recentMessages: IslandRecentMessage[];
  pendingApproval: IslandApproval | null;
  isBusy: boolean;
  errorMessage: string | null;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  stageHistory: IslandStatusStep[];

  expand: () => void;
  collapse: () => void;
  hide: () => void;
  toggleExpand: () => void;
  restoreWorkspace: () => void;
  hydrateFromChat: (snapshot: IslandChatSnapshot) => void;
  sendQuickReply: (text: string) => Promise<void>;
  approvePendingApproval: () => Promise<void>;
  rejectPendingApproval: () => Promise<void>;
}

const DEFAULT_LAST_REPLY = "No replies yet.";
const DEFAULT_SUMMARY = "Open a conversation to keep Deeting nearby.";
const ISLAND_TRANSCRIPT_MAX_MESSAGES = 8;

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function messagePreview(message: Message | undefined): string | null {
  if (!message) return null;
  const fromBlocks = extractAssistantTextFromBlocks(message.blocks).trim();
  return fromBlocks.length > 0 ? fromBlocks : null;
}

function findLatestAssistantMessage(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (messagePreview(message)) return message;
  }
  return undefined;
}

function findLatestUserMessage(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (content.length > 0) return message;
  }
  return undefined;
}

function derivePendingApproval(messages: Message[]): IslandApproval | null {
  const approval = findUnresolvedToolApprovals(messages)[0];
  if (!approval) return null;

  return {
    id: approval.approval_token,
    title: approval.tool_name,
    desc: approval.description ?? "Approval is required before the task can continue.",
    approvalToken: approval.approval_token,
    toolName: approval.tool_name,
    callId: approval.meta.call_id,
  };
}

function deriveSummaryText(messages: Message[]): string {
  const latestUser = findLatestUserMessage(messages);
  const latestUserPreview = latestUser
    ? typeof latestUser.content === "string"
      ? latestUser.content.trim()
      : ""
    : "";
  if (latestUserPreview.length > 0) {
    return truncate(latestUserPreview, 52);
  }

  return DEFAULT_SUMMARY;
}

function deriveLastReplyText(messages: Message[]): string {
  const latestAssistant = findLatestAssistantMessage(messages);
  const preview = messagePreview(latestAssistant);
  return preview ? truncate(preview, 220) : DEFAULT_LAST_REPLY;
}

function deriveRecentMessages(messages: Message[]): IslandRecentMessage[] {
  const recent: IslandRecentMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && recent.length < ISLAND_TRANSCRIPT_MAX_MESSAGES; i -= 1) {
    const msg = messages[i];
    if (msg.role === "system") continue;
    const preview =
      msg.role === "assistant"
        ? messagePreview(msg)
        : typeof msg.content === "string"
          ? msg.content.trim()
          : null;
    if (!preview) continue;
    recent.unshift({
      role: msg.role as "user" | "assistant",
      content: preview,
      createdAt: msg.createdAt,
    });
  }
  return recent;
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
  return [...recentMessages, optimisticMessage].slice(-ISLAND_TRANSCRIPT_MAX_MESSAGES);
}

function upsertStreamingAssistantPreview(
  recentMessages: IslandRecentMessage[],
  content: string
) {
  const preview = truncate(content.trim(), 220);
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

  return nextMessages.slice(-ISLAND_TRANSCRIPT_MAX_MESSAGES);
}

function deriveStatusLabel(snapshot: IslandChatSnapshot, pendingApproval: IslandApproval | null): string {
  if (pendingApproval) return "Pending approval";
  if (snapshot.errorMessage) return "Needs attention";
  if (snapshot.globalLoading || snapshot.isLoading) return "Working...";
  if (snapshot.statusCode) return "Working...";
  if (snapshot.statusCode) return "Working...";
  if (snapshot.messages.length > 0) return "Ready";
  return "Idle";
}

function getChatSnapshot(): IslandChatSnapshot {
  const chatState = useChatStore.getState();
  const runtimeState = useChatRuntimeStore.getState();
  return {
    sessionId: runtimeState.sessionId,
    messages: chatState.messages,
    isLoading: runtimeState.isLoading,
    globalLoading: runtimeState.globalLoading,
    statusStage: runtimeState.statusStage,
    statusCode: runtimeState.statusCode,
    statusMeta: runtimeState.statusMeta,
    errorMessage: runtimeState.errorMessage,
  };
}

async function syncChatHistory(sessionId: string) {
  const history = await loadConversationHistoryPage(sessionId, {
    limit: 200,
    idPrefix: sessionId,
    isTauriRuntime: detectTauriRuntime(),
  });
  useChatStore.getState().setMessages(history.messages);
  return history.messages;
}

async function ensureSessionId() {
  const runtimeState = useChatRuntimeStore.getState();
  if (runtimeState.sessionId) {
    return runtimeState.sessionId;
  }

  const created = await createConversation({
  });
  useChatRuntimeStore.getState().setSessionId(created.session_id);
  return created.session_id;
}

function resolveCurrentIslandChatRequest() {
  const chatState = useChatStore.getState();
  return resolveIslandChatRequestConfig({
    configModel: chatState.config.model,
    models: chatState.models,
    isTauriRuntime: detectTauriRuntime(),
  });
}

export const useIslandStore = create<IslandState>((set) => ({
  mode: "hidden",
  statusLabel: "Idle",
  summaryText: DEFAULT_SUMMARY,
  lastReplyText: DEFAULT_LAST_REPLY,
  lastReplyAt: null,
  recentMessages: [],
  pendingApproval: null,
  isBusy: false,
  errorMessage: null,
  statusStage: null,
  statusCode: null,
  statusMeta: null,
  stageHistory: [],

  expand: () => set({ mode: "expanded" }),
  collapse: () => set({ mode: "collapsed" }),
  hide: () => set({ mode: "hidden" }),
  toggleExpand: () =>
    set((state) => ({
      mode: state.mode === "expanded" ? "collapsed" : "expanded",
    })),
  restoreWorkspace: () => set({ mode: "hidden" }),
  hydrateFromChat: (snapshot) => {
    const latestAssistant = findLatestAssistantMessage(snapshot.messages);
    const pendingApproval = derivePendingApproval(snapshot.messages);
    set((state) => {
      const runtimeStatus = resolveIslandRuntimeStatus(snapshot, pendingApproval, state.stageHistory);
      return {
      statusLabel: deriveStatusLabel(snapshot, pendingApproval),
      summaryText: deriveSummaryText(snapshot.messages),
      lastReplyText: deriveLastReplyText(snapshot.messages),
      lastReplyAt: latestAssistant?.createdAt ?? null,
      recentMessages: deriveRecentMessages(snapshot.messages),
      pendingApproval,
      errorMessage: snapshot.errorMessage,
      statusStage: runtimeStatus.statusStage,
      statusCode: runtimeStatus.statusCode,
      statusMeta: runtimeStatus.statusMeta,
      stageHistory: runtimeStatus.stageHistory,
    };
    });
  },
  sendQuickReply: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const previousState = useIslandStore.getState();
    const requestConfig = resolveCurrentIslandChatRequest();
    if (!requestConfig) {
      set({ errorMessage: "No chat model selected" });
      return;
    }

    let streamErrorMessage: string | null = null;
    set({
      isBusy: true,
      errorMessage: null,
      statusLabel: "Working...",
      summaryText: truncate(trimmed, 52),
      recentMessages: buildOptimisticRecentMessages(previousState.recentMessages, trimmed),
      pendingApproval: null,
      statusStage: "listen",
      statusCode: null,
      statusMeta: null,
      stageHistory: [],
    });
    try {
      const sessionId = await ensureSessionId();
      await streamIslandTextConversation(sessionId, trimmed, requestConfig, {
        onDelta: (_delta, snapshot) => {
          set((state) => ({
            statusLabel: "Working...",
            lastReplyText: truncate(snapshot, 220),
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
                  ...getChatSnapshot(),
                  statusStage: streamStatus.stage ?? null,
                  statusCode: streamStatus.code ?? null,
                  statusMeta: streamStatus.meta ?? null,
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
            const message = (data as { message?: unknown }).message;
            streamErrorMessage =
              typeof message === "string"
                ? message
                : "Island send failed";
          }
        },
      });
      if (streamErrorMessage) {
        throw new Error(streamErrorMessage);
      }
      await syncChatHistory(sessionId);
      useIslandStore.getState().hydrateFromChat(getChatSnapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Island send failed";
      set({
        statusLabel: previousState.statusLabel,
        summaryText: previousState.summaryText,
        lastReplyText: previousState.lastReplyText,
        lastReplyAt: previousState.lastReplyAt,
        recentMessages: previousState.recentMessages,
        pendingApproval: previousState.pendingApproval,
        errorMessage: message,
        statusStage: previousState.statusStage,
        statusCode: previousState.statusCode,
        statusMeta: previousState.statusMeta,
        stageHistory: previousState.stageHistory,
      });
    } finally {
      set({ isBusy: false });
    }
  },
  approvePendingApproval: async () => {
    const pendingApproval = useIslandStore.getState().pendingApproval;
    if (!pendingApproval) return;

    set({ isBusy: true, errorMessage: null });
    try {
      await approveIslandTool(
        pendingApproval.approvalToken,
        pendingApproval.toolName,
        pendingApproval.callId
      );
      const sessionId = await ensureSessionId();
      await syncChatHistory(sessionId);
      useIslandStore.getState().hydrateFromChat(getChatSnapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Island approval failed";
      set({ errorMessage: message });
    } finally {
      set({ isBusy: false });
    }
  },
  rejectPendingApproval: async () => {
    const pendingApproval = useIslandStore.getState().pendingApproval;
    if (!pendingApproval) return;

    set({ isBusy: true, errorMessage: null });
    try {
      await rejectIslandTool(pendingApproval.approvalToken, pendingApproval.toolName);
      const sessionId = await ensureSessionId();
      await syncChatHistory(sessionId);
      useIslandStore.getState().hydrateFromChat(getChatSnapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Island rejection failed";
      set({ errorMessage: message });
    } finally {
      set({ isBusy: false });
    }
  },
}));
