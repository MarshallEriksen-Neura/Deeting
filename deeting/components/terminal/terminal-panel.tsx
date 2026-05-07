"use client";

import * as React from "react";
import { Sparkles, SquareTerminal, X } from "lucide-react";

import { useTerminalPanelStore } from "@/store/terminal-panel-store";

import type { TerminalCommandSnapshot } from "./terminal-command-boundaries";
import { TerminalContextMenu } from "./terminal-context-menu";
import { buildTerminalBridgeText } from "./terminal-shell-integration";
import { useTerminalSession } from "./use-terminal-session";

interface TerminalPanelProps {
  /**
   * True when the parent splitter has the terminal panel collapsed (size 0).
   * Used to gate xterm's FitAddon — see `useTerminalSession` for details.
   */
  isCollapsed: boolean;
}

interface ContextMenuState {
  /** Viewport coords from the contextmenu event. */
  x: number;
  y: number;
  /** Selection captured at right-click time (frozen — xterm clears the
   *  selection as soon as the user clicks elsewhere, including on the menu). */
  selectionText: string;
  lastCommand: TerminalCommandSnapshot | null;
}

/**
 * TerminalPanel — xterm.js renderer bound to a Tauri-managed PTY.
 *
 * Stays mounted across collapse/expand cycles AND chat-route switches so
 * scrollback and the underlying shell session survive. The parent splitter
 * just shrinks the panel to 0 width when "closed."
 *
 * The Tauri PTY wiring lives in `useTerminalSession`. In browser-only dev
 * mode (no Tauri), the hook degrades to a placeholder banner instead of
 * invoking missing commands.
 *
 * Right-click → "Send selection to chat AI" is the one curated bridge. Copy /
 * Paste deliberately stay on Ctrl+C / Ctrl+V (xterm handles those natively).
 *
 * First-open hint: the bridge isn't discoverable from looking at xterm, so
 * the very first time the panel becomes visible we surface a one-shot banner
 * pointing at it. `hasSeenHint` is persisted in the store, so the banner
 * never reappears once dismissed (or after the user's first successful send,
 * which is the strongest possible "they got it" signal).
 */
export function TerminalPanel({ isCollapsed }: TerminalPanelProps) {
  const [containerElement, setContainerElement] =
    React.useState<HTMLDivElement | null>(null);
  const { getSelection, getLastCommand } = useTerminalSession({
    containerElement,
    isCollapsed,
  });
  const setPendingSelection = useTerminalPanelStore(
    (state) => state.setPendingSelection,
  );
  const hasSeenHint = useTerminalPanelStore((state) => state.hasSeenHint);
  const markHintSeen = useTerminalPanelStore((state) => state.markHintSeen);

  const [menu, setMenu] = React.useState<ContextMenuState | null>(null);

  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Suppress the platform's native context menu — xterm's canvas has
      // nothing useful for it to act on, so the OS one would just look broken.
      event.preventDefault();
      // Snapshot the selection at click time. Xterm clears its selection on
      // any subsequent click (including on our menu's button), so reading
      // later via getSelection() would return "".
      const selectionText = getSelection();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        selectionText,
        lastCommand: getLastCommand(),
      });
    },
    [getSelection, getLastCommand],
  );

  const handleSendToChat = React.useCallback(() => {
    if (!menu) return;
    const text = menu.selectionText.trim();
    if (!text) return;
    // Markdown-fenced quote so the AI sees "this is terminal output", and
    // so multi-line selections don't collapse into a single paragraph.
    setPendingSelection(["```", text, "```"].join("\n"));
    // First successful send teaches the user the gesture; no need to keep
    // the banner around afterwards.
    if (!hasSeenHint) markHintSeen();
  }, [menu, setPendingSelection, hasSeenHint, markHintSeen]);

  const sendTerminalBridgeText = React.useCallback(
    (intent: "command" | "output" | "diagnose-error") => {
      if (!menu?.lastCommand) return;
      setPendingSelection(buildTerminalBridgeText(menu.lastCommand, intent));
      if (!hasSeenHint) markHintSeen();
    },
    [menu, setPendingSelection, hasSeenHint, markHintSeen],
  );

  const handleDismiss = React.useCallback(() => setMenu(null), []);

  // Show the discoverability hint only when the panel is actually visible —
  // otherwise users would never even see it before it's "shown."
  const showHint = !isCollapsed && !hasSeenHint;

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-400">
        <SquareTerminal className="h-3.5 w-3.5" />
        <span>Terminal</span>
      </div>
      {showHint ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-300">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="flex-1 leading-snug">
            Tip: select text and right-click to send it to chat AI.
          </span>
          <button
            type="button"
            onClick={markHintSeen}
            aria-label="Dismiss tip"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        onContextMenu={handleContextMenu}
      >
        <div ref={setContainerElement} className="h-full w-full" />
      </div>
      {menu ? (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          hasSelection={menu.selectionText.trim().length > 0}
          hasLastCommand={Boolean(menu.lastCommand?.command)}
          hasLastCommandOutput={Boolean(menu.lastCommand?.output)}
          hasLastCommandFailure={
            typeof menu.lastCommand?.exitCode === "number" &&
            menu.lastCommand.exitCode !== 0
          }
          onSendToChat={handleSendToChat}
          onSendLastCommand={() => sendTerminalBridgeText("command")}
          onSendLastCommandOutput={() => sendTerminalBridgeText("output")}
          onSendLastError={() => sendTerminalBridgeText("diagnose-error")}
          onDismiss={handleDismiss}
        />
      ) : null}
    </div>
  );
}
