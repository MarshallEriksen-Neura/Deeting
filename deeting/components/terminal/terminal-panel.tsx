"use client";

import * as React from "react";
import { SquareTerminal } from "lucide-react";

import { useTerminalSession } from "./use-terminal-session";

interface TerminalPanelProps {
  /**
   * True when the parent splitter has the terminal panel collapsed (size 0).
   * Used to gate xterm's FitAddon — see `useTerminalSession` for details.
   */
  isCollapsed: boolean;
}

/**
 * TerminalPanel — Phase 2: real xterm.js renderer with a self-echo input
 * loop. Stays mounted across collapse/expand cycles so scrollback survives;
 * the parent splitter just shrinks the panel to 0 width when "closed."
 *
 * Phase 3-4 land the Tauri PTY backend and rewire the `onData` path inside
 * `useTerminalSession`; this component does not need to change.
 */
export function TerminalPanel({ isCollapsed }: TerminalPanelProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  useTerminalSession({ containerRef, isCollapsed });

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-400">
        <SquareTerminal className="h-3.5 w-3.5" />
        <span>Terminal</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-500">
          Phase 2 · self-echo
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
