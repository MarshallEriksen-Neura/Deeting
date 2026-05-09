"use client";

import * as React from "react";
import {
  AlertTriangle,
  ClipboardPaste,
  Copy,
  FileText,
  History,
  Sparkles,
} from "lucide-react";

import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

interface TerminalContextMenuProps {
  /** Viewport-relative position. Comes from the contextmenu event coords. */
  x: number;
  y: number;
  /** True iff the terminal has any copied-eligible selection. */
  canCopySelection: boolean;
  /** True iff the terminal has a non-empty trimmed selection for AI bridge. */
  canSendSelection: boolean;
  canPaste: boolean;
  onCopySelection: () => void;
  onPasteFromClipboard: () => void;
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
 * Includes basic clipboard actions plus AI bridge actions backed by either
 * a selection or OSC 133 command boundaries.
 *
 * Position is clamped to the viewport: if the raw click coords would push
 * the menu off the right or bottom edge, the anchor flips so the menu opens
 * up/left from the click instead. The clamp runs in a layout effect, so the
 * adjustment lands before the browser paints — no flicker.
 */
export function TerminalContextMenu({
  x,
  y,
  canCopySelection,
  canSendSelection,
  canPaste,
  onCopySelection,
  onPasteFromClipboard,
  onSendToChat,
  hasLastCommand,
  hasLastCommandOutput,
  hasLastCommandFailure,
  onSendLastCommand,
  onSendLastCommandOutput,
  onSendLastError,
  onDismiss,
}: TerminalContextMenuProps) {
  const t = useI18n("chat");
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
      className="min-w-[200px] overflow-hidden rounded-sm border border-[rgba(255,255,255,0.1)] bg-[#18181b] py-1 text-zinc-100"
    >
      <ContextMenuButton
        enabled={canCopySelection}
        icon={<Copy className="h-3.5 w-3.5 shrink-0 text-zinc-200" />}
        label={t("terminal.contextMenu.copy")}
        onSelect={onCopySelection}
        onDismiss={onDismiss}
      />
      <ContextMenuButton
        enabled={canPaste}
        icon={
          <ClipboardPaste className="h-3.5 w-3.5 shrink-0 text-zinc-200" />
        }
        label={t("terminal.contextMenu.paste")}
        onSelect={onPasteFromClipboard}
        onDismiss={onDismiss}
      />
      <ContextMenuSeparator />
      <ContextMenuButton
        enabled={canSendSelection}
        icon={<Sparkles className="h-3.5 w-3.5 shrink-0 text-[#6d5cff]" />}
        label={t("terminal.contextMenu.sendSelectionToChat")}
        onSelect={onSendToChat}
        onDismiss={onDismiss}
      />
      <ContextMenuButton
        enabled={hasLastCommand}
        icon={<History className="h-3.5 w-3.5 shrink-0 text-[#6d5cff]" />}
        label={t("terminal.contextMenu.sendLastCommand")}
        onSelect={onSendLastCommand}
        onDismiss={onDismiss}
      />
      <ContextMenuButton
        enabled={hasLastCommandOutput}
        icon={<FileText className="h-3.5 w-3.5 shrink-0 text-[#22c55e]" />}
        label={t("terminal.contextMenu.sendLastCommandOutput")}
        onSelect={onSendLastCommandOutput}
        onDismiss={onDismiss}
      />
      <ContextMenuButton
        enabled={hasLastCommandFailure}
        icon={
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#ef4444]" />
        }
        label={t("terminal.contextMenu.sendLastError")}
        onSelect={onSendLastError}
        onDismiss={onDismiss}
      />
    </div>
  );
}

function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-[rgba(255,255,255,0.06)]" role="separator" />;
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
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] tracking-wide transition-colors",
        enabled
          ? "text-zinc-200 hover:bg-[rgba(109,92,255,0.12)] hover:text-zinc-100"
          : "cursor-not-allowed text-zinc-500",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
