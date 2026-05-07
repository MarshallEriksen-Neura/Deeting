"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

interface TerminalContextMenuProps {
  /** Viewport-relative position. Comes from the contextmenu event coords. */
  x: number;
  y: number;
  /** True iff the terminal has a non-empty selection. Disables the only
   *  action when false (we still render the menu so the user gets feedback
   *  that right-click "did something"). */
  hasSelection: boolean;
  /** Fired only when `hasSelection` is true. */
  onSendToChat: () => void;
  /** Fires on outside click, Escape, or after an action is chosen. */
  onDismiss: () => void;
}

/**
 * Minimal context menu surfaced on right-click within the terminal panel.
 *
 * v1 holds exactly one action — the only deliberate AI/terminal bridge in
 * the product. Copy / Paste deliberately stay on Ctrl+C / Ctrl+V (xterm
 * handles those natively); adding them here would invite scope creep into
 * a "real" terminal context menu.
 */
export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  onSendToChat,
  onDismiss,
}: TerminalContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    // mousedown (not click) so we dismiss before click-induced focus shifts.
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onDismiss]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: x, top: y, zIndex: 80 }}
      className="min-w-[200px] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 text-zinc-100 shadow-[0_18px_48px_-18px_rgba(0,0,0,0.7)]"
    >
      <button
        type="button"
        role="menuitem"
        disabled={!hasSelection}
        onClick={() => {
          if (!hasSelection) return;
          onSendToChat();
          onDismiss();
        }}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
          hasSelection
            ? "text-zinc-100 hover:bg-zinc-800"
            : "cursor-not-allowed text-zinc-500",
        )}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span>Send selection to chat AI</span>
      </button>
    </div>
  );
}
