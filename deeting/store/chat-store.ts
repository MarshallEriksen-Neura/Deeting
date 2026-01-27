"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { cancelChatCompletion, streamChatCompletion, type ChatMessage } from "@/lib/api/chat";
import {
  buildMessageContent,
  type ChatImageAttachment,
} from "@/lib/chat/message-content";
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter";
import type { Message, MessageRole } from "@/lib/chat/message-types";
import { createRequestId } from "@/lib/chat/request-id";
import { resolveSessionIdFromBrowser } from "@/lib/chat/session-storage";
import { fetchConversationHistory } from "@/lib/api/conversations";
import type { ModelInfo } from "@/lib/api/models";
import { signAssets } from "@/lib/api/media-assets";

export type { Message, MessageRole };

export interface ChatAssistant {
  id: string;
  name: string;
  desc: string;
  color: string;
  systemPrompt?: string;
  ownerUserId?: string | null;
}

const SESSION_STORAGE_PREFIX = "deeting-chat-session";
const HISTORY_PAGE_SIZE = 30;

function sessionKeyForAssistant(assistantId: string) {
  return `${SESSION_STORAGE_PREFIX}:${assistantId}`;
}

function createMessageId() {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const toHex = (byte: number) => byte.toString(16).padStart(2, "0");
    return (
      `${toHex(bytes[0])}${toHex(bytes[1])}${toHex(bytes[2])}${toHex(bytes[3])}` +
      `-${toHex(bytes[4])}${toHex(bytes[5])}` +
      `-${toHex(bytes[6])}${toHex(bytes[7])}` +
      `-${toHex(bytes[8])}${toHex(bytes[9])}` +
      `-${toHex(bytes[10])}${toHex(bytes[11])}${toHex(bytes[12])}${toHex(bytes[13])}${toHex(bytes[14])}${toHex(bytes[15])}`
    );
  }

  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let activeCancel: (() => void) | null = null;

function buildChatMessages(history: Message[], systemPrompt?: string): ChatMessage[] {
  const mapped = history.map((msg) => ({
    role: msg.role,
    content: buildMessageContent(
      msg.content,
      msg.role === "user" ? msg.attachments ?? [] : []
    ),
  })) as ChatMessage[];

  const trimmedPrompt = systemPrompt?.trim();
  if (trimmedPrompt && !mapped.some((msg) => msg.role === "system")) {
    mapped.unshift({ role: "system", content: trimmedPrompt });
  }

  return mapped;
}


const resolveMessageAttachments = async (messages: Message[]) => {
  const objectKeys = new Set<string>();
  messages.forEach((message) => {
    message.attachments?.forEach((attachment) => {
      const key = attachment.objectKey;
      if (!key) return;
      if (!attachment.url || attachment.url.startsWith("asset://")) {
        objectKeys.add(key);
      }
    });
  });
  if (!objectKeys.size) return messages;

  const signed = await signAssets(Array.from(objectKeys));
  const urlMap = new Map(
    signed.assets.map((item) => [item.object_key, item.asset_url])
  );

  return messages.map((message) => {
    if (!message.attachments?.length) return message;
    const attachments = message.attachments.map((attachment) => {
      if (!attachment.objectKey) return attachment;
      const url = urlMap.get(attachment.objectKey);
      if (!url) return attachment;
      return { ...attachment, url };
    });
    return { ...message, attachments };
  });
};

interface ChatConfig {
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
}

interface ChatState {
  input: string;
  attachments: ChatImageAttachment[];
  messages: Message[];
  isLoading: boolean;
  globalLoading: boolean;
  config: ChatConfig;
  assistants: ChatAssistant[];
  models: ModelInfo[];
  activeAssistantId?: string;
  sessionId?: string;
  historyCursor?: number | null;
  historyHasMore: boolean;
  historyLoading: boolean;
  streamEnabled: boolean;
  errorMessage: string | null;
  statusStage: string | null;
  statusStep: string | null;
  statusState: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  activeRequestId: string | null;
}

interface ChatActions {
  setInput: (input: string) => void;
  setAttachments: (attachments: ChatImageAttachment[]) => void;
  addAttachments: (attachments: ChatImageAttachment[]) => void;
  removeAttachment: (attachmentId: string) => void;
  clearAttachments: () => void;
  setConfig: (config: Partial<ChatConfig>) => void;
  setAssistants: (assistants: ChatAssistant[]) => void;
  setModels: (models: ModelInfo[]) => void;
  setActiveAssistantId: (assistantId?: string) => void;
  setSessionId: (sessionId?: string) => void;
  setStreamEnabled: (enabled: boolean) => void;
  setErrorMessage: (error: string | null) => void;
  setGlobalLoading: (loading: boolean) => void;
  setMessages: (messages: Message[]) => void;
  updateMessage: (id: string, content: string) => void;
  addMessage: (role: MessageRole, content: string, attachments?: ChatImageAttachment[]) => void;
  clearMessages: () => void;
  resetSession: () => void;
  loadHistory: (assistantId?: string) => Promise<void>;
  loadHistoryBySession: (sessionId: string) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  sendMessage: () => Promise<void>;
  cancelActiveRequest: () => Promise<void>;
}

export const useChatStore = create<ChatState & ChatActions>()(
  persist(
    (set, get) => ({
      input: "",
      attachments: [],
      messages: [],
      isLoading: false,
      globalLoading: false,
      config: {
        model: "gpt-4o",
        temperature: 0.7,
        topP: 1.0,
        maxTokens: 2048,
      },
      assistants: [],
      models: [],
      activeAssistantId: undefined,
      sessionId: undefined,
      historyCursor: null,
      historyHasMore: false,
      historyLoading: false,
      streamEnabled: false,
      errorMessage: null,
      statusStage: null,
      statusStep: null,
      statusState: null,
      statusCode: null,
      statusMeta: null,
      activeRequestId: null,

      setInput: (input) => set({ input }),

      setAttachments: (attachments) => set({ attachments }),

      addAttachments: (attachments) =>
        set((state) => ({
          attachments: [...state.attachments, ...attachments],
        })),

      removeAttachment: (attachmentId) =>
        set((state) => ({
          attachments: state.attachments.filter((attachment) => attachment.id !== attachmentId),
        })),

      clearAttachments: () => set({ attachments: [] }),

      setConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),

      setAssistants: (assistants) => set({ assistants }),

      setModels: (models) => set({ models }),

      setActiveAssistantId: (assistantId) => set({ activeAssistantId: assistantId }),

      setSessionId: (sessionId) => set({ sessionId }),

      setStreamEnabled: (enabled) => set({ streamEnabled: enabled }),

      setErrorMessage: (errorMessage) => set({ errorMessage }),

      setGlobalLoading: (loading) => set({ globalLoading: loading }),

      setMessages: (messages) => set({ messages }),

      updateMessage: (id, content) =>
        set((state) => ({
          messages: state.messages.map((msg) => (msg.id === id ? { ...msg, content } : msg)),
        })),

      addMessage: (role, content, attachments) => {
        const newMessage: Message = {
          id: createMessageId(),
          role,
          content,
          attachments,
          createdAt: Date.now(),
        };
        set((state) => ({ messages: [...state.messages, newMessage] }));
      },

      clearMessages: () => set({ messages: [] }),

      resetSession: () => {
        const activeAssistantId = get().activeAssistantId;
        if (typeof window !== "undefined" && activeAssistantId) {
          localStorage.removeItem(sessionKeyForAssistant(activeAssistantId));
        }
        set({
          messages: [],
          sessionId: undefined,
          attachments: [],
          historyCursor: null,
          historyHasMore: false,
          historyLoading: false,
        });
      },

      loadHistory: async (assistantId) => {
        if (typeof window === "undefined") return;
        const targetAssistantId = assistantId ?? get().activeAssistantId;
        if (!targetAssistantId) return;
        const storageKey = sessionKeyForAssistant(targetAssistantId);
        const storedSessionId = localStorage.getItem(storageKey);
        const querySessionId = (() => {
          try {
            const params = new URLSearchParams(window.location.search);
            return params.get("session")?.trim() || null;
          } catch {
            return null;
          }
        })();
        const resolvedSessionId = storedSessionId || querySessionId;
        if (!resolvedSessionId) {
          set({
            messages: [],
            sessionId: undefined,
            historyCursor: null,
            historyHasMore: false,
            historyLoading: false,
          });
          return;
        }
        if (!storedSessionId && querySessionId) {
          localStorage.setItem(storageKey, querySessionId);
        }
        try {
          await get().loadHistoryBySession(resolvedSessionId);
        } catch {
          set({
            messages: [],
            sessionId: undefined,
            historyCursor: null,
            historyHasMore: false,
            historyLoading: false,
          });
        }
      },

      loadHistoryBySession: async (sessionId) => {
        if (!sessionId) return;
        set({ historyLoading: true });
        try {
          const windowState = await fetchConversationHistory(sessionId, {
            limit: HISTORY_PAGE_SIZE,
          });
          const mapped = normalizeConversationMessages(windowState.messages ?? [], {
            idPrefix: sessionId,
          });
          let resolved = mapped;
          try {
            resolved = await resolveMessageAttachments(mapped);
          } catch (error) {
            console.warn("signAssets_failed", error);
            set({ errorMessage: "i18n:input.image.errorSign" });
            resolved = mapped;
          }
          set({
            messages: resolved,
            sessionId,
            historyCursor: windowState.next_cursor ?? null,
            historyHasMore: Boolean(windowState.has_more),
          });
          const activeAssistantId = get().activeAssistantId;
          if (typeof window !== "undefined" && activeAssistantId) {
            localStorage.setItem(sessionKeyForAssistant(activeAssistantId), sessionId);
          }
        } catch {
          set({
            messages: [],
            sessionId: undefined,
            historyCursor: null,
            historyHasMore: false,
          });
        } finally {
          set({ historyLoading: false });
        }
      },

      loadMoreHistory: async () => {
        const { sessionId, historyCursor, historyHasMore, historyLoading } = get();
        if (!sessionId || historyLoading || !historyHasMore) return;
        if (historyCursor == null) return;
        set({ historyLoading: true });
        try {
          const windowState = await fetchConversationHistory(sessionId, {
            cursor: historyCursor ?? undefined,
            limit: HISTORY_PAGE_SIZE,
          });
          const mapped = normalizeConversationMessages(windowState.messages ?? [], {
            idPrefix: sessionId,
          });
          let resolved = mapped;
          try {
            resolved = await resolveMessageAttachments(mapped);
          } catch (error) {
            console.warn("signAssets_failed", error);
            set({ errorMessage: "i18n:input.image.errorSign" });
            resolved = mapped;
          }
          set((state) => ({
            messages: [...resolved, ...state.messages],
            historyCursor: windowState.next_cursor ?? null,
            historyHasMore: Boolean(windowState.has_more),
          }));
        } catch {
          set({ historyHasMore: false });
        } finally {
          set({ historyLoading: false });
        }
      },

      sendMessage: async () => {
        const {
          input,
          attachments,
          messages,
          config,
          models,
          assistants,
          activeAssistantId,
          sessionId,
          streamEnabled,
          updateMessage,
          setSessionId,
        } = get();
        const trimmedInput = input.trim();
        if (!trimmedInput && attachments.length === 0) return;

        const selectedModel =
          models.find((model) => model.provider_model_id === config.model || model.id === config.model) ??
          models[0];
        const activeAssistant = assistants.find((assistant) => assistant.id === activeAssistantId);
        if (!selectedModel || !activeAssistant) return;

        const userMessage: Message = {
          id: createMessageId(),
          role: "user",
          content: trimmedInput,
          attachments: attachments.length ? attachments : undefined,
          createdAt: Date.now(),
        };
        const assistantMessageId = createMessageId();
        const assistantMessage: Message = {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
        };

        set((state) => ({
          messages: [...state.messages, userMessage, assistantMessage],
          input: "",
          attachments: [],
          isLoading: true,
          statusStage: null,
          statusStep: null,
          statusState: null,
          statusCode: null,
          statusMeta: null,
        }));

        const requestMessages = buildChatMessages([...messages, userMessage], activeAssistant.systemPrompt);
        let resolvedSessionId = sessionId;
        const storageKey = sessionKeyForAssistant(activeAssistant.id);
        if (!resolvedSessionId) {
          const fallbackSessionId = resolveSessionIdFromBrowser(storageKey);
          if (fallbackSessionId) {
            resolvedSessionId = fallbackSessionId;
            setSessionId(resolvedSessionId);
            if (typeof window !== "undefined") {
              localStorage.setItem(storageKey, resolvedSessionId);
            }
          }
        }
        const requestId = createRequestId();
        set({ activeRequestId: requestId });

        const payload = {
          model: selectedModel.id,
          provider_model_id: selectedModel.provider_model_id ?? undefined,
          messages: requestMessages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          request_id: requestId,
          assistant_id: activeAssistant?.id ?? undefined,
          session_id: resolvedSessionId ?? undefined,
        };

        try {
          await streamChatCompletion(
            { ...payload, stream: streamEnabled, status_stream: true },
            {
              onDelta: (_delta, snapshot) => {
                updateMessage(assistantMessageId, snapshot);
              },
              onMessage: (data) => {
                if (data && typeof data === "object" && "type" in data) {
                  const payload = data as {
                    type?: string;
                    stage?: string | null;
                    step?: string | null;
                    state?: string | null;
                    code?: string | null;
                    meta?: unknown;
                    message?: string;
                    error_code?: string;
                  };
                  if (payload.type === "status") {
                    set({
                      statusStage: payload.stage ?? null,
                      statusStep: payload.step ?? null,
                      statusState: payload.state ?? null,
                      statusCode: payload.code ?? null,
                      statusMeta: typeof payload.meta === "object" && payload.meta ? (payload.meta as Record<string, unknown>) : null,
                    });
                    return;
                  }
                  if (payload.type === "error") {
                    const message = payload.message || "Request failed";
                    updateMessage(assistantMessageId, message);
                    set({ errorMessage: payload.error_code ? `${payload.error_code}: ${message}` : message });
                    return;
                  }
                }

                const session = (data as { session_id?: string | null })?.session_id ?? undefined;
                if (session) {
                  setSessionId(session);
                  localStorage.setItem(storageKey, session);
                }
              },
            },
            {
              onCancel: (cancel) => {
                activeCancel = cancel;
              },
            }
          );
        } catch (error) {
          const message = error instanceof Error && error.message ? error.message : "Request failed";
          updateMessage(assistantMessageId, message);
          set({ errorMessage: message });
        } finally {
          set({
            isLoading: false,
            statusStage: null,
            statusStep: null,
            statusState: null,
            statusCode: null,
            statusMeta: null,
            activeRequestId: null,
          });
          activeCancel = null;
        }
      },
      cancelActiveRequest: async () => {
        const requestId = get().activeRequestId;
        if (!requestId) return;
        activeCancel?.();
        activeCancel = null;
        set({
          isLoading: false,
          statusStage: null,
          statusStep: null,
          statusState: null,
          statusCode: null,
          statusMeta: null,
          activeRequestId: null,
        });
        try {
          await cancelChatCompletion(requestId);
        } catch {
          // ignore cancel errors
        }
      },
    }),
    {
      name: "deeting-chat-store",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        messages: state.messages.map(({ attachments, ...rest }) => rest),
        config: state.config,
        activeAssistantId: state.activeAssistantId,
        streamEnabled: state.streamEnabled,
      }), // Persist messages and config
    }
  )
);
