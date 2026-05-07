"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { TerminalContextSnapshot } from "@/lib/terminal-context";

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
 * - `terminalContext` is a volatile request-scoped snapshot for chat runtime
 *   tools. It is intentionally excluded from persistence.
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
  /** Latest queryable terminal context snapshot for the chat runtime. */
  terminalContext: TerminalContextSnapshot | null;
}

interface TerminalPanelActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  markHintSeen: () => void;
  setPendingSelection: (text: string | null) => void;
  setTerminalContext: (context: TerminalContextSnapshot | null) => void;
  /** Returns the current pending selection and clears it atomically. */
  consumePendingSelection: () => string | null;
}

type TerminalPanelStore = TerminalPanelState & TerminalPanelActions;

const DEFAULT_STATE: TerminalPanelState = {
  isOpen: false,
  hasSeenHint: false,
  pendingSelection: null,
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
      setTerminalContext: (context) => set({ terminalContext: context }),
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
      // Only persist hasSeenHint; never persist isOpen, pendingSelection, or terminalContext.
      partialize: (state) => ({ hasSeenHint: state.hasSeenHint }),
    },
  ),
);
