"use client";

import * as React from "react";
import { SquareTerminal } from "lucide-react";

import { useTerminalPanelStore } from "@/store/terminal-panel-store";

import { TerminalContextMenu } from "./terminal-context-menu";
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
 */
export function TerminalPanel({ isCollapsed }: TerminalPanelProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { getSelection } = useTerminalSession({ containerRef, isCollapsed });
  const setPendingSelection = useTerminalPanelStore(
    (state) => state.setPendingSelection,
  );

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
      });
    },
    [getSelection],
  );

  const handleSendToChat = React.useCallback(() => {
    if (!menu) return;
    const text = menu.selectionText.trim();
    if (!text) return;
    // Markdown-fenced quote so the AI sees "this is terminal output", and
    // so multi-line selections don't collapse into a single paragraph.
    setPendingSelection(["```", text, "```"].join("\n"));
  }, [menu, setPendingSelection]);

  const handleDismiss = React.useCallback(() => setMenu(null), []);

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-400">
        <SquareTerminal className="h-3.5 w-3.5" />
        <span>Terminal</span>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden"
        onContextMenu={handleContextMenu}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {menu ? (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          hasSelection={menu.selectionText.trim().length > 0}
          onSendToChat={handleSendToChat}
          onDismiss={handleDismiss}
        />
      ) : null}
    </div>
  );
}
