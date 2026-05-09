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
    <div className="flex h-full w-full flex-col border-l border-[rgba(15,17,28,0.08)] bg-[#f8f7f2]">
      {/* ── Swiss Card Header ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(15,17,28,0.08)] px-6 py-3">
        <SquareTerminal className="h-3.5 w-3.5 text-[#6d5cff]" />
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[rgba(20,21,28,0.52)]">
          {t("terminal.title")}
        </span>
      </div>

      {/* ── Hint Banner (card chip) ── */}
      {showHint ? (
        <div className="mx-6 mt-4 flex shrink-0 items-center gap-2 rounded-sm border border-[rgba(15,17,28,0.08)] bg-[rgba(255,255,255,0.58)] px-3 py-2 text-[11px]">
          <Sparkles className="h-3 w-3 shrink-0 text-[#6d5cff]" />
          <span className="flex-1 leading-snug text-[rgba(20,21,28,0.6)]">
            {t("terminal.hint")}
          </span>
          <button
            type="button"
            onClick={markHintSeen}
            aria-label={t("terminal.dismissHint")}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[rgba(20,21,28,0.42)] transition-colors hover:bg-[rgba(15,17,28,0.05)] hover:text-[rgba(20,21,28,0.76)]"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ) : null}

      {/* ── Failure Banner (card chip) ── */}
      {visibleFailedCommand ? (
        <div className="mx-6 mt-4 flex shrink-0 items-start gap-2.5 rounded-sm border border-[rgba(220,38,38,0.12)] bg-[rgba(220,38,38,0.04)] px-3 py-2 text-[11px]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium tracking-wide text-rose-700">
                {t("terminal.failure.title")}
              </span>
              <span className="rounded-sm border border-[rgba(220,38,38,0.12)] px-1.5 py-0.5 text-[10px] text-rose-700/70">
                {t("terminal.failure.exitCode", {
                  code: visibleFailedCommand.exitCode,
                })}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-rose-700/75">
              {visibleFailedCommand.command?.trim() ||
                t("terminal.failure.commandUnavailable")}
            </div>
            {visibleFailedCommand.outputSummary.trim() ? (
              <div className="mt-1 line-clamp-2 text-rose-700/55">
                {visibleFailedCommand.outputSummary}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-start gap-1.5">
            <button
              type="button"
              onClick={handleSendFailureToChat}
              className="rounded-sm border border-[rgba(220,38,38,0.12)] bg-[rgba(220,38,38,0.06)] px-2 py-1 text-[10px] font-medium text-rose-700 transition-colors hover:bg-[rgba(220,38,38,0.1)]"
            >
              {t("terminal.failure.sendToAi")}
            </button>
            <button
              type="button"
              onClick={handleDismissFailure}
              aria-label={t("terminal.failure.dismiss")}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-rose-700/40 transition-colors hover:bg-[rgba(220,38,38,0.08)] hover:text-rose-700"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* ── xterm Canvas Area (card body with Swiss spacing) ── */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onContextMenu={handleContextMenu}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-100"
          style={{
            backgroundColor: "#f8f7f2",
            backgroundImage:
              "linear-gradient(rgba(20,21,28,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(20,21,28,0.045) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
            backgroundPosition: "-1px -1px",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{
            background:
              "linear-gradient(180deg, rgba(248,247,242,0.94) 0%, rgba(248,247,242,0.72) 48%, rgba(248,247,242,0) 100%)",
          }}
        />
        <div className="relative z-10 h-full w-full px-5 pb-4 pt-5">
          <div ref={setContainerElement} className="h-full w-full" />
        </div>
      </div>

      {/* ── Context Menu ── */}
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
