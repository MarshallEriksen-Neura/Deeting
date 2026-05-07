"use client";

import * as React from "react";

import { useChatStore } from "@/store/chat-store";
import { useTerminalPanelStore } from "@/store/terminal-panel-store";

interface UsePendingTerminalSelectionOptions {
  inputRef: React.RefObject<HTMLInputElement | null>;
}

interface UsePendingTerminalSelectionResult {
  /**
   * True for ~700ms after a selection lands. Callers apply a flash class to
   * the input wrapper so the user sees the bridge actually delivered
   * something, even when the input is scrolled out of view.
   */
  isFlashing: boolean;
}

const FLASH_DURATION_MS = 700;

/**
 * Bridge consumer: the terminal panel writes a quoted selection into
 * `terminal-panel-store.pendingSelection`; this hook drains it into the
 * chat input field.
 *
 * Behavior:
 * - Append (with `\n\n` separator) when the input is non-empty, otherwise
 *   replace.
 * - Focus the input and place the caret at the end on the next animation
 *   frame (the controlled `<input>` needs that frame to flush its new value
 *   before `setSelectionRange` lands at the right offset).
 * - Drive `isFlashing` for ~700ms so the caller can flash the input wrapper.
 *
 * Reading `input` via `useChatStore.getState()` keeps this hook's effect
 * from re-running on every keystroke — we only ever react to the
 * `pendingSelection` transition itself.
 */
export function usePendingTerminalSelection({
  inputRef,
}: UsePendingTerminalSelectionOptions): UsePendingTerminalSelectionResult {
  const pendingSelection = useTerminalPanelStore(
    (state) => state.pendingSelection,
  );
  const consumePendingSelection = useTerminalPanelStore(
    (state) => state.consumePendingSelection,
  );
  const setInput = useChatStore((state) => state.setInput);
  const [isFlashing, setIsFlashing] = React.useState(false);

  React.useEffect(() => {
    if (pendingSelection === null) return;
    const text = pendingSelection;
    consumePendingSelection();

    const currentInput = useChatStore.getState().input;
    const next =
      currentInput.trim().length > 0
        ? `${currentInput}\n\n${text}`
        : text;
    setInput(next);

    const rafHandle = requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const end = node.value.length;
      try {
        node.setSelectionRange(end, end);
      } catch {
        // Some input types reject setSelectionRange — safe to ignore.
      }
    });

    setIsFlashing(true);
    const flashTimer = window.setTimeout(
      () => setIsFlashing(false),
      FLASH_DURATION_MS,
    );

    return () => {
      cancelAnimationFrame(rafHandle);
      window.clearTimeout(flashTimer);
    };
  }, [pendingSelection, consumePendingSelection, setInput, inputRef]);

  return { isFlashing };
}
