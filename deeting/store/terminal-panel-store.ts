"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { TerminalContextSnapshot } from "@/lib/terminal-context";

export interface TerminalUiSession {
  id: string;
  title: string;
  status: "starting" | "ready" | "exited";
  createdAt: string;
  lastError?: string | null;
}

/**
 * Terminal panel state.
 *
 * Controls visibility of the right-side terminal panel on the chat page.
 * The panel itself is rendered by react-resizable-panels; this store is the
 * source of truth that the splitter's imperative panel handle syncs to.
 *
 * Design notes:
 * - `isOpen` is intentionally volatile (resets to false on each app load)
 *   to avoid surprising users with an open terminal on first render.
 * - `hasSeenHint` is persisted: the welcome hint should appear exactly once
 *   per user, not once per session.
 * - `pendingSelection` is a one-shot terminal-to-chat bridge consumed by the
 *   chat input; never persisted to avoid leaking terminal contents.
 * - Terminal sessions and contexts are volatile request-scoped state for chat
 *   runtime tools. They are intentionally excluded from persistence.
 */
export interface TerminalPanelState {
  /** Whether the terminal panel is currently expanded. */
  isOpen: boolean;
  /** True after the user has dismissed the first-open AI-CLI hint. */
  hasSeenHint: boolean;
  /**
   * Text the user wants to send into the chat input as a quoted block.
   * Set by terminal bridge gestures such as "send selection" or OSC
   * 133-backed command diagnostics; cleared by the chat input the moment it
   * consumes the value. Never auto-submits.
   */
  pendingSelection: string | null;
  /** Active terminal session id. Used as the default AI tool target. */
  activeSessionId: string | null;
  /** Open terminal UI sessions keyed by terminal session id. */
  sessions: Record<string, TerminalUiSession>;
  /** Latest queryable terminal context snapshots keyed by terminal session id. */
  terminalContextsBySessionId: Record<string, TerminalContextSnapshot>;
  /** Latest queryable terminal context snapshot for the chat runtime. */
  terminalContext: TerminalContextSnapshot | null;
}

interface TerminalPanelActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  markHintSeen: () => void;
  setPendingSelection: (text: string | null) => void;
  addSession: (session: TerminalUiSession) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  updateSession: (sessionId: string, patch: Partial<TerminalUiSession>) => void;
  setTerminalContext: (
    sessionIdOrContext: string | TerminalContextSnapshot | null,
    context?: TerminalContextSnapshot | null,
  ) => void;
  /** Returns the current pending selection and clears it atomically. */
  consumePendingSelection: () => string | null;
}

type TerminalPanelStore = TerminalPanelState & TerminalPanelActions;

const DEFAULT_STATE: TerminalPanelState = {
  isOpen: false,
  hasSeenHint: false,
  pendingSelection: null,
  activeSessionId: null,
  sessions: {},
  terminalContextsBySessionId: {},
  terminalContext: null,
};

export const useTerminalPanelStore = create<TerminalPanelStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set({ isOpen: !get().isOpen }),
      markHintSeen: () => set({ hasSeenHint: true }),
      setPendingSelection: (text) => set({ pendingSelection: text }),
      addSession: (session) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            [session.id]: session,
          },
          activeSessionId: state.activeSessionId ?? session.id,
        })),
      removeSession: (sessionId) =>
        set((state) => {
          const sessions = { ...state.sessions };
          delete sessions[sessionId];
          const terminalContextsBySessionId = {
            ...state.terminalContextsBySessionId,
          };
          delete terminalContextsBySessionId[sessionId];
          const remainingIds = Object.keys(sessions);
          const activeSessionId =
            state.activeSessionId === sessionId
              ? remainingIds[remainingIds.length - 1] ?? null
              : state.activeSessionId;
          const terminalContext = activeSessionId
            ? terminalContextsBySessionId[activeSessionId] ?? null
            : null;
          return {
            sessions,
            terminalContextsBySessionId,
            activeSessionId,
            terminalContext,
          };
        }),
      setActiveSession: (sessionId) =>
        set((state) => ({
          activeSessionId: sessionId,
          terminalContext: sessionId
            ? state.terminalContextsBySessionId[sessionId] ?? null
            : null,
        })),
      updateSession: (sessionId, patch) =>
        set((state) => {
          const current = state.sessions[sessionId];
          if (!current) return {};
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...current, ...patch, id: sessionId },
            },
          };
        }),
      setTerminalContext: (sessionIdOrContext, context) =>
        set((state) => {
          if (
            typeof sessionIdOrContext !== "string" ||
            context === undefined
          ) {
            const nextContext =
              typeof sessionIdOrContext === "string" ? null : sessionIdOrContext;
            const sessionId = nextContext?.sessionId ?? state.activeSessionId;
            if (!sessionId) {
              return { terminalContext: nextContext };
            }
            return {
              terminalContextsBySessionId: nextContext
                ? {
                    ...state.terminalContextsBySessionId,
                    [sessionId]: nextContext,
                  }
                : state.terminalContextsBySessionId,
              terminalContext:
                state.activeSessionId === sessionId ? nextContext : state.terminalContext,
            };
          }

          const sessionId = sessionIdOrContext;
          const remainingContexts = { ...state.terminalContextsBySessionId };
          delete remainingContexts[sessionId];
          const terminalContextsBySessionId = context
            ? {
                ...state.terminalContextsBySessionId,
                [sessionId]: context,
              }
            : remainingContexts;
          return {
            terminalContextsBySessionId,
            terminalContext:
              state.activeSessionId === sessionId ? context ?? null : state.terminalContext,
          };
        }),
      consumePendingSelection: () => {
        const text = get().pendingSelection;
        if (text !== null) set({ pendingSelection: null });
        return text;
      },
    }),
    {
      name: "deeting-terminal-panel-store",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Only persist hasSeenHint; never persist isOpen, sessions, pendingSelection, or terminal contexts.
      partialize: (state) => ({ hasSeenHint: state.hasSeenHint }),
    },
  ),
);
