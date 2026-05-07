"use client";

import * as React from "react";
import { AlertTriangle, FileText, History, Sparkles } from "lucide-react";

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
  /** True when OSC 133 has captured a previous command. */
  hasLastCommand: boolean;
  /** True when OSC 133 has captured a previous command output block. */
  hasLastCommandOutput: boolean;
  /** True when the previous command exited non-zero. */
  hasLastCommandFailure: boolean;
  onSendLastCommand: () => void;
  onSendLastCommandOutput: () => void;
  onSendLastError: () => void;
  /** Fires on outside click, Escape, or after an action is chosen. */
  onDismiss: () => void;
}

/** Distance from the viewport edge before we flip the menu's anchor. */
const VIEWPORT_MARGIN = 8;

/**
 * Minimal context menu surfaced on right-click within the terminal panel.
 *
 * Copy / Paste deliberately stay on Ctrl+C / Ctrl+V (xterm handles those
 * natively); this menu only exposes AI bridge actions backed by either a
 * selection or OSC 133 command boundaries.
 *
 * Position is clamped to the viewport: if the raw click coords would push
 * the menu off the right or bottom edge, the anchor flips so the menu opens
 * up/left from the click instead. The clamp runs in a layout effect, so the
 * adjustment lands before the browser paints — no flicker.
 */
export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  onSendToChat,
  hasLastCommand,
  hasLastCommandOutput,
  hasLastCommandFailure,
  onSendLastCommand,
  onSendLastCommandOutput,
  onSendLastError,
  onDismiss,
}: TerminalContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ x, y });

  React.useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overflowsRight = x + rect.width + VIEWPORT_MARGIN > vw;
    const overflowsBottom = y + rect.height + VIEWPORT_MARGIN > vh;
    const nextX = overflowsRight
      ? Math.max(VIEWPORT_MARGIN, x - rect.width)
      : x;
    const nextY = overflowsBottom
      ? Math.max(VIEWPORT_MARGIN, y - rect.height)
      : y;
    setPosition((prev) =>
      prev.x === nextX && prev.y === nextY ? prev : { x: nextX, y: nextY },
    );
  }, [x, y]);

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
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 80,
      }}
      className="min-w-[200px] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 text-zinc-100 shadow-[0_18px_48px_-18px_rgba(0,0,0,0.7)]"
    >
      <ContextMenuButton
        enabled={hasSelection}
        icon={<Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
        label="Send selection to chat AI"
        onSelect={onSendToChat}
        onDismiss={onDismiss}
      />
      <ContextMenuButton
        enabled={hasLastCommand}
        icon={<History className="h-3.5 w-3.5 shrink-0 text-sky-300" />}
        label="Send last command"
        onSelect={onSendLastCommand}
        onDismiss={onDismiss}
      />
      <ContextMenuButton
        enabled={hasLastCommandOutput}
        icon={<FileText className="h-3.5 w-3.5 shrink-0 text-emerald-300" />}
        label="Send last command output"
        onSelect={onSendLastCommandOutput}
        onDismiss={onDismiss}
      />
      <ContextMenuButton
        enabled={hasLastCommandFailure}
        icon={
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-300" />
        }
        label="Send error to AI for diagnosis"
        onSelect={onSendLastError}
        onDismiss={onDismiss}
      />
    </div>
  );
}

interface ContextMenuButtonProps {
  enabled: boolean;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  onDismiss: () => void;
}

function ContextMenuButton({
  enabled,
  icon,
  label,
  onSelect,
  onDismiss,
}: ContextMenuButtonProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={!enabled}
      onClick={() => {
        if (!enabled) return;
        onSelect();
        onDismiss();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
        enabled
          ? "text-zinc-100 hover:bg-zinc-800"
          : "cursor-not-allowed text-zinc-500",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
