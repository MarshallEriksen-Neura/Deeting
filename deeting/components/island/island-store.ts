"use client";

import { create } from "zustand";

import {
  approveIslandTool,
  executeIslandTextConversation,
  rejectIslandTool,
} from "@/lib/api/island";
import { createConversation } from "@/lib/api/conversations";
import { deriveAssistantActivityState } from "@/lib/chat/assistant-activity";
import { loadConversationHistoryPage } from "@/lib/chat/history-loader";
import { extractAssistantTextFromBlocks } from "@/lib/chat/message-blocks";
import { findLatestMessageToolApproval } from "@/lib/chat/tool-approval";
import type { Message } from "@/lib/chat/message-types";
import type { ChatAssistant } from "@/store/chat-store";
import { useChatStore } from "@/store/chat-store";
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri";

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
  selectedAssistant: ChatAssistant | null;
  messages: Message[];
  isLoading: boolean;
  globalLoading: boolean;
  statusCode: string | null;
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

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function messagePreview(message: Message | undefined): string | null {
  if (!message) return null;
  const fromBlocks = extractAssistantTextFromBlocks(message.blocks).trim();
  if (fromBlocks.length > 0) {
    return fromBlocks;
  }

  const content = typeof message.content === "string" ? message.content.trim() : "";
  return content.length > 0 ? content : null;
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
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!Array.isArray(message.blocks) || message.blocks.length === 0) continue;
    const approval = findLatestMessageToolApproval(message.blocks, {
      messageId: message.id,
    });
    if (!approval) continue;

    return {
      id: approval.approval_token,
      title: approval.tool_name,
      desc: approval.description ?? "Approval is required before the task can continue.",
      approvalToken: approval.approval_token,
      toolName: approval.tool_name,
      callId: approval.meta.call_id,
    };
  }

  return null;
}

function deriveSummaryText(
  messages: Message[],
  selectedAssistant: ChatAssistant | null
): string {
  const latestUser = findLatestUserMessage(messages);
  const latestUserPreview = latestUser
    ? typeof latestUser.content === "string"
      ? latestUser.content.trim()
      : ""
    : "";
  if (latestUserPreview.length > 0) {
    return truncate(latestUserPreview, 52);
  }

  if (selectedAssistant?.name) {
    return `Chatting with ${selectedAssistant.name}`;
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
  for (let i = messages.length - 1; i >= 0 && recent.length < 3; i -= 1) {
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
      content: truncate(preview, 80),
      createdAt: msg.createdAt,
    });
  }
  return recent;
}

function deriveStatusLabel(
  snapshot: IslandChatSnapshot,
  pendingApproval: IslandApproval | null
): string {
  if (pendingApproval) return "Pending approval";
  if (snapshot.errorMessage) return "Needs attention";
  if (snapshot.globalLoading || snapshot.isLoading) return "Working...";

  const latestAssistant = findLatestAssistantMessage(snapshot.messages);
  const activity = deriveAssistantActivityState(latestAssistant?.blocks);

  if (activity.statusCode === "approval.required") return "Pending approval";
  if (activity.isActive) return "Working...";
  if (snapshot.statusCode) return "Working...";
  if (snapshot.messages.length > 0) return "Ready";
  return "Idle";
}

function getChatSnapshot(): IslandChatSnapshot {
  const chatState = useChatStore.getState();
  return {
    sessionId: chatState.sessionId,
    selectedAssistant: chatState.selectedAssistant,
    messages: chatState.messages,
    isLoading: chatState.isLoading,
    globalLoading: chatState.globalLoading,
    statusCode: chatState.statusCode,
    errorMessage: chatState.errorMessage,
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
  const chatState = useChatStore.getState();
  if (chatState.sessionId) {
    return chatState.sessionId;
  }

  const created = await createConversation({
    assistant_id: chatState.selectedAssistantId ?? undefined,
  });
  useChatStore.getState().setSessionId(created.session_id);
  return created.session_id;
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
    set({
      statusLabel: deriveStatusLabel(snapshot, pendingApproval),
      summaryText: deriveSummaryText(snapshot.messages, snapshot.selectedAssistant),
      lastReplyText: deriveLastReplyText(snapshot.messages),
      lastReplyAt: latestAssistant?.createdAt ?? null,
      recentMessages: deriveRecentMessages(snapshot.messages),
      pendingApproval,
      errorMessage: snapshot.errorMessage,
    });
  },
  sendQuickReply: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    set({ isBusy: true, errorMessage: null });
    try {
      const sessionId = await ensureSessionId();
      await executeIslandTextConversation(sessionId, trimmed);
      await syncChatHistory(sessionId);
      useIslandStore.getState().hydrateFromChat(getChatSnapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Island send failed";
      set({ errorMessage: message });
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
