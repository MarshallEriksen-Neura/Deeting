"use client";

import * as React from "react";
import { AlertTriangle, Plus, Sparkles, SquareTerminal, X } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/hooks/use-i18n";
import { isTauriRuntime } from "@/lib/runtime/tauri";
import type { TerminalContextCommand } from "@/lib/terminal-context";
import { copyToClipboard } from "@/lib/utils/copy-to-clipboard";
import {
  useTerminalPanelStore,
  type TerminalUiSession,
} from "@/store/terminal-panel-store";

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
  pasteText: (text: string) => Promise<void>;
}

interface PtyListResponse {
  sessionIds: string[];
  sessions?: Array<{
    sessionId: string;
    status?: TerminalUiSession["status"];
  }>;
}

const MAX_TERMINAL_SESSIONS = 2;

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
  const setPendingSelection = useTerminalPanelStore(
    (state) => state.setPendingSelection,
  );
  const sessions = useTerminalPanelStore((state) => state.sessions);
  const activeSessionId = useTerminalPanelStore((state) => state.activeSessionId);
  const addSession = useTerminalPanelStore((state) => state.addSession);
  const removeSession = useTerminalPanelStore((state) => state.removeSession);
  const setActiveSession = useTerminalPanelStore((state) => state.setActiveSession);
  const updateSession = useTerminalPanelStore((state) => state.updateSession);
  const terminalContext = useTerminalPanelStore((state) => state.terminalContext);
  const hasSeenHint = useTerminalPanelStore((state) => state.hasSeenHint);
  const markHintSeen = useTerminalPanelStore((state) => state.markHintSeen);

  const [menu, setMenu] = React.useState<ContextMenuState | null>(null);
  const [hasHydratedBackendSessions, setHasHydratedBackendSessions] =
    React.useState(() => !isTauriRuntime());
  const [dismissedFailureId, setDismissedFailureId] = React.useState<
    string | null
  >(null);
  const sessionList = React.useMemo(
    () =>
      Object.values(sessions).sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      ),
    [sessions],
  );
  const activeSession =
    sessionList.find((session) => session.id === activeSessionId) ??
    sessionList[0] ??
    null;
  const canCreateSession = sessionList.length < MAX_TERMINAL_SESSIONS;
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
    latestFailedCommand &&
    `${activeSession?.id ?? ""}:${latestFailedCommand.id}` !== dismissedFailureId
      ? latestFailedCommand
      : null;
  const activeSessionError = activeSession?.lastError?.trim() || null;

  const getSessionStatusLabel = React.useCallback(
    (status: TerminalUiSession["status"]) => t(`terminal.status.${status}`),
    [t],
  );

  const createSession = React.useCallback(() => {
    const id = createTerminalSessionId();
    const nextIndex = sessionList.length + 1;
    addSession({
      id,
      title: t("terminal.tabTitle", { index: nextIndex }),
      status: "starting",
      createdAt: new Date().toISOString(),
    });
    setActiveSession(id);
  }, [addSession, sessionList.length, setActiveSession, t]);

  React.useEffect(() => {
    let cancelled = false;
    if (!isTauriRuntime()) {
      setHasHydratedBackendSessions(true);
      return;
    }

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const response = await invoke<PtyListResponse>("pty_list");
        if (cancelled) return;
        const backendSessions =
          response.sessions && response.sessions.length > 0
            ? response.sessions
            : response.sessionIds.map((sessionId) => ({
                sessionId,
                status: "ready" as const,
              }));
        const current = useTerminalPanelStore.getState();
        const existingCount = Object.keys(current.sessions).length;
        backendSessions.forEach((backendSession, index) => {
          const sessionId = backendSession.sessionId.trim();
          if (!sessionId || current.sessions[sessionId]) return;
          addSession({
            id: sessionId,
            title: t("terminal.tabTitle", { index: existingCount + index + 1 }),
            status:
              backendSession.status === "exited"
                ? "exited"
                : backendSession.status === "starting"
                  ? "starting"
                  : "ready",
            createdAt: new Date(Date.now() + index).toISOString(),
          });
        });
        if (!current.activeSessionId && backendSessions[0]?.sessionId) {
          setActiveSession(backendSessions[0].sessionId);
        }
      } finally {
        if (!cancelled) setHasHydratedBackendSessions(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addSession, setActiveSession, t]);

  React.useEffect(() => {
    if (isCollapsed || !hasHydratedBackendSessions || sessionList.length > 0) return;
    createSession();
  }, [
    createSession,
    hasHydratedBackendSessions,
    isCollapsed,
    sessionList.length,
  ]);

  React.useEffect(() => {
    if (activeSession && activeSessionId !== activeSession.id) {
      setActiveSession(activeSession.id);
    }
  }, [activeSession, activeSessionId, setActiveSession]);

  const handleContextMenu = React.useCallback(
    (nextMenu: ContextMenuState) => {
      setMenu(nextMenu);
    },
    [],
  );

  const handleCreateSession = React.useCallback(() => {
    if (!canCreateSession) return;
    createSession();
  }, [canCreateSession, createSession]);

  const handleCloseSession = React.useCallback(
    async (sessionId: string) => {
      if (isTauriRuntime()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("pty_close", { sessionId });
        } catch {
          // The UI state should still forget the tab; the backend command is
          // idempotent and may already have observed process exit.
        }
      }
      removeSession(sessionId);
      if (dismissedFailureId?.startsWith(`${sessionId}:`)) {
        setDismissedFailureId(null);
      }
    },
    [dismissedFailureId, removeSession],
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
      await menu?.pasteText(text);
    } catch {
      toast.error(t("terminal.toast.pasteFailed"));
    }
  }, [menu, t]);

  const handleDismissFailure = React.useCallback(() => {
    if (!visibleFailedCommand) return;
    setDismissedFailureId(`${activeSession?.id ?? ""}:${visibleFailedCommand.id}`);
  }, [activeSession, visibleFailedCommand]);

  const handleSendFailureToChat = React.useCallback(() => {
    if (!visibleFailedCommand) return;
    setPendingSelection(
      buildTerminalBridgeText(
        terminalContextCommandToSnapshot(visibleFailedCommand),
        "diagnose-error",
      ),
    );
    if (!hasSeenHint) markHintSeen();
    setDismissedFailureId(`${activeSession?.id ?? ""}:${visibleFailedCommand.id}`);
  }, [
    activeSession,
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
      <div className="flex shrink-0 items-center gap-3 border-b border-[rgba(15,17,28,0.08)] px-6 py-3">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <SquareTerminal className="h-3.5 w-3.5 text-[#6d5cff]" />
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[rgba(20,21,28,0.52)]">
            {t("terminal.title")}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {sessionList.map((session) => {
            const active = session.id === activeSession?.id;
            return (
              <div
                key={session.id}
                className={[
                  "group flex min-w-0 max-w-[150px] items-center rounded-sm border text-[11px] transition-colors",
                  active
                    ? "border-[rgba(109,92,255,0.26)] bg-[rgba(109,92,255,0.08)] text-[rgba(20,21,28,0.82)]"
                    : "border-transparent text-[rgba(20,21,28,0.46)] hover:bg-[rgba(15,17,28,0.04)] hover:text-[rgba(20,21,28,0.7)]",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => setActiveSession(session.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left"
                  title={`${session.title} · ${getSessionStatusLabel(session.status)}${
                    session.lastError ? ` · ${session.lastError}` : ""
                  }`}
                >
                  <span
                    className={[
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      session.status === "ready"
                        ? "bg-emerald-500"
                        : session.status === "exited"
                          ? "bg-rose-400"
                          : "bg-amber-400",
                    ].join(" ")}
                  />
                  <span className="min-w-0 truncate">{session.title}</span>
                </button>
                {sessionList.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t("terminal.closeTab", { title: session.title })}
                    onClick={() => void handleCloseSession(session.id)}
                    className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[rgba(20,21,28,0.36)] opacity-0 transition-opacity hover:bg-[rgba(15,17,28,0.06)] hover:text-[rgba(20,21,28,0.76)] group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleCreateSession}
          disabled={!canCreateSession}
          title={
            canCreateSession
              ? t("terminal.newTab")
              : t("terminal.tabLimit", { count: MAX_TERMINAL_SESSIONS })
          }
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[rgba(15,17,28,0.08)] text-[rgba(20,21,28,0.52)] transition-colors hover:bg-[rgba(15,17,28,0.05)] hover:text-[rgba(20,21,28,0.76)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
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

      {activeSessionError ? (
        <div className="mx-6 mt-4 flex shrink-0 items-start gap-2.5 rounded-sm border border-[rgba(220,38,38,0.12)] bg-[rgba(220,38,38,0.04)] px-3 py-2 text-[11px]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium tracking-wide text-rose-700">
              {t("terminal.sessionError.title")}
            </div>
            <div className="mt-1 line-clamp-2 font-mono text-[11px] text-rose-700/65">
              {activeSessionError}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              activeSession
                ? updateSession(activeSession.id, { lastError: null })
                : undefined
            }
            aria-label={t("terminal.sessionError.dismiss")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-rose-700/40 transition-colors hover:bg-[rgba(220,38,38,0.08)] hover:text-rose-700"
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
                  code: visibleFailedCommand.exitCode ?? "",
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
      <div className="relative min-h-0 flex-1 overflow-hidden">
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
          <div className="relative h-full w-full">
            {sessionList.map((session) => (
              <TerminalSessionView
                key={session.id}
                session={session}
                isActive={session.id === activeSession?.id}
                isCollapsed={isCollapsed}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
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

interface TerminalSessionViewProps {
  session: TerminalUiSession;
  isActive: boolean;
  isCollapsed: boolean;
  onContextMenu: (menu: ContextMenuState) => void;
}

function TerminalSessionView({
  session,
  isActive,
  isCollapsed,
  onContextMenu,
}: TerminalSessionViewProps) {
  const [containerElement, setContainerElement] =
    React.useState<HTMLDivElement | null>(null);
  const { getSelection, getLastCommand, pasteText } = useTerminalSession({
    terminalId: session.id,
    containerElement,
    isCollapsed,
    isActive,
  });

  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isActive) return;
      event.preventDefault();
      onContextMenu({
        x: event.clientX,
        y: event.clientY,
        selectionText: getSelection(),
        lastCommand: getLastCommand(),
        pasteText,
      });
    },
    [getLastCommand, getSelection, isActive, onContextMenu, pasteText],
  );

  return (
    <div
      className={[
        "absolute inset-0 h-full w-full transition-opacity duration-150",
        isActive ? "opacity-100" : "pointer-events-none opacity-0",
      ].join(" ")}
      aria-hidden={!isActive}
      onContextMenu={handleContextMenu}
    >
      <div ref={setContainerElement} className="h-full w-full" />
    </div>
  );
}

function createTerminalSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `term-${crypto.randomUUID()}`;
  }
  return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
