"use client";

import * as React from "react";
import { AlertTriangle, Sparkles, SquareTerminal, X } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/hooks/use-i18n";
import type { TerminalContextCommand } from "@/lib/terminal-context";
import { copyToClipboard } from "@/lib/utils/copy-to-clipboard";
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
 * Right-click now exposes both basic clipboard actions and the curated AI
 * bridge actions tied to selections / OSC 133 command boundaries.
 *
 * First-open hint: the bridge isn't discoverable from looking at xterm, so
 * the very first time the panel becomes visible we surface a one-shot banner
 * pointing at it. `hasSeenHint` is persisted in the store, so the banner
 * never reappears once dismissed (or after the user's first successful send,
 * which is the strongest possible "they got it" signal).
 */
export function TerminalPanel({ isCollapsed }: TerminalPanelProps) {
  const t = useI18n("chat");
  const [containerElement, setContainerElement] =
    React.useState<HTMLDivElement | null>(null);
  const { getSelection, getLastCommand, pasteText } = useTerminalSession({
    containerElement,
    isCollapsed,
  });
  const setPendingSelection = useTerminalPanelStore(
    (state) => state.setPendingSelection,
  );
  const terminalContext = useTerminalPanelStore((state) => state.terminalContext);
  const hasSeenHint = useTerminalPanelStore((state) => state.hasSeenHint);
  const markHintSeen = useTerminalPanelStore((state) => state.markHintSeen);

  const [menu, setMenu] = React.useState<ContextMenuState | null>(null);
  const [dismissedFailureId, setDismissedFailureId] = React.useState<
    string | null
  >(null);
  const canPasteFromClipboard =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.readText === "function";
  const latestFailedCommand = React.useMemo(() => {
    const commands = terminalContext?.commands ?? [];
    const latest = commands[commands.length - 1];
    if (!latest || latest.state !== "completed") return null;
    if (typeof latest.exitCode !== "number" || latest.exitCode === 0) return null;
    return latest;
  }, [terminalContext]);
  const visibleFailedCommand =
    latestFailedCommand && latestFailedCommand.id !== dismissedFailureId
      ? latestFailedCommand
      : null;

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

  const handleCopySelection = React.useCallback(async () => {
    if (!menu?.selectionText) return;
    const ok = await copyToClipboard(menu.selectionText);
    if (!ok) {
      toast.error(t("terminal.toast.copyFailed"));
    }
  }, [menu, t]);

  const handlePasteFromClipboard = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      toast.error(t("terminal.toast.clipboardUnavailable"));
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      await pasteText(text);
    } catch {
      toast.error(t("terminal.toast.pasteFailed"));
    }
  }, [pasteText, t]);

  const handleDismissFailure = React.useCallback(() => {
    if (!visibleFailedCommand) return;
    setDismissedFailureId(visibleFailedCommand.id);
  }, [visibleFailedCommand]);

  const handleSendFailureToChat = React.useCallback(() => {
    if (!visibleFailedCommand) return;
    setPendingSelection(
      buildTerminalBridgeText(
        terminalContextCommandToSnapshot(visibleFailedCommand),
        "diagnose-error",
      ),
    );
    if (!hasSeenHint) markHintSeen();
    setDismissedFailureId(visibleFailedCommand.id);
  }, [
    visibleFailedCommand,
    setPendingSelection,
    hasSeenHint,
    markHintSeen,
  ]);

  const handleDismiss = React.useCallback(() => setMenu(null), []);

  // Show the discoverability hint only when the panel is actually visible —
  // otherwise users would never even see it before it's "shown."
  const showHint = !isCollapsed && !hasSeenHint;

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-400">
        <SquareTerminal className="h-3.5 w-3.5" />
        <span>{t("terminal.title")}</span>
      </div>
      {showHint ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-300">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="flex-1 leading-snug">
            {t("terminal.hint")}
          </span>
          <button
            type="button"
            onClick={markHintSeen}
            aria-label={t("terminal.dismissHint")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      {visibleFailedCommand ? (
        <div className="flex shrink-0 items-start gap-3 border-b border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {t("terminal.failure.title")}
              </span>
              <span className="rounded-full border border-rose-400/25 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-200/85">
                {t("terminal.failure.exitCode", {
                  code: visibleFailedCommand.exitCode,
                })}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-rose-100/90">
              {visibleFailedCommand.command?.trim() ||
                t("terminal.failure.commandUnavailable")}
            </div>
            {visibleFailedCommand.outputSummary.trim() ? (
              <div className="mt-1 line-clamp-2 text-rose-100/70">
                {visibleFailedCommand.outputSummary}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleSendFailureToChat}
            className="shrink-0 rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-100 transition-colors hover:bg-rose-500/20"
          >
            {t("terminal.failure.sendToAi")}
          </button>
          <button
            type="button"
            onClick={handleDismissFailure}
            aria-label={t("terminal.failure.dismiss")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-rose-200/70 transition-colors hover:bg-rose-500/15 hover:text-rose-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-hidden pl-3"
        onContextMenu={handleContextMenu}
      >
        <div ref={setContainerElement} className="h-full w-full" />
      </div>
      {menu ? (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          canCopySelection={menu.selectionText.length > 0}
          canSendSelection={menu.selectionText.trim().length > 0}
          canPaste={canPasteFromClipboard}
          onCopySelection={handleCopySelection}
          onPasteFromClipboard={handlePasteFromClipboard}
          onSendToChat={handleSendToChat}
          hasLastCommand={Boolean(menu.lastCommand?.command)}
          hasLastCommandOutput={Boolean(menu.lastCommand?.output)}
          hasLastCommandFailure={
            typeof menu.lastCommand?.exitCode === "number" &&
            menu.lastCommand.exitCode !== 0
          }
          onSendLastCommand={() => sendTerminalBridgeText("command")}
          onSendLastCommandOutput={() => sendTerminalBridgeText("output")}
          onSendLastError={() => sendTerminalBridgeText("diagnose-error")}
          onDismiss={handleDismiss}
        />
      ) : null}
    </div>
  );
}

function terminalContextCommandToSnapshot(
  command: TerminalContextCommand,
): TerminalCommandSnapshot {
  const numericId = Number.parseInt(command.id.replace(/^cmd_/, ""), 10);
  return {
    id: Number.isFinite(numericId) ? numericId : 0,
    command: command.command,
    output: command.output,
    exitCode: command.exitCode,
    stream: command.stream,
    outputStartLine: command.startedLine,
    outputEndLine: command.endedLine,
  };
}
