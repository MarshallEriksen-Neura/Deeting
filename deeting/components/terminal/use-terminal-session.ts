"use client";

import * as React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";

import { isTauriRuntime } from "@/lib/runtime/tauri";
import { useTerminalPanelStore } from "@/store/terminal-panel-store";

import {
  installOsc133CommandBoundaries,
  type TerminalCommandBoundaryTracker,
  type TerminalCommandSnapshot,
} from "./terminal-command-boundaries";
import {
  injectOsc133ShellIntegration,
  resolveTerminalPlatform,
} from "./terminal-shell-integration";

import "@xterm/xterm/css/xterm.css";

interface UseTerminalSessionOptions {
  containerElement: HTMLDivElement | null;
  isCollapsed: boolean;
}

interface UseTerminalSessionResult {
  /** Reads the current xterm selection, or "" if nothing is selected. */
  getSelection: () => string;
  /** Reads the latest OSC 133-delimited command, or null if unavailable. */
  getLastCommand: () => TerminalCommandSnapshot | null;
  /** Pastes text into the live terminal session. */
  pasteText: (text: string) => Promise<void>;
}

interface PtyOpenResponse {
  sessionId: string;
}

interface PtyOutputPayload {
  sessionId: string;
  data: string;
}

interface PtyExitPayload {
  sessionId: string;
  exitCode: number | null;
}

type TerminalWithOptionalPaste = Terminal & {
  paste?: (data: string) => void;
};

const TERMINAL_OUTPUT_EVENT = "terminal:output";
const TERMINAL_EXIT_EVENT = "terminal:exit";

const TERMINAL_THEME = {
  background: "#09090b",
  foreground: "#e4e4e7",
  cursor: "#fbbf24",
  cursorAccent: "#09090b",
  selectionBackground: "#3f3f46",
  black: "#27272a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#52525b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

const NON_TAURI_BANNER = [
  "\x1b[2;90m# Terminal requires the desktop app.\x1b[0m",
  "\x1b[2;90m# Browser dev mode renders xterm without a real shell.\x1b[0m",
  "",
];

/**
 * Mounts and manages an xterm.js Terminal bound to a Tauri PTY.
 *
 * Lifecycle:
 * - **Lazy mount**: xterm + PTY are created on the **first** time the panel
 *   is non-collapsed. Users who never open the terminal pay zero cost.
 * - **Persistent across toggles**: once mounted, the terminal and PTY
 *   survive collapse/expand cycles. If the route unmounts, only the xterm
 *   view is disposed; the Tauri PTY remains app-local and a later mount
 *   reattaches through `pty_open`.
 * - **Resize gated by collapse**: while collapsed, the FitAddon is frozen
 *   and `pty_resize` is not called — the parent panel's 0-width
 *   collapsedSize must never propagate into a `cols=0`/`rows=0` update.
 *
 * Tauri runtime detection: in browser-only dev mode (Next.js without
 * Tauri shell), we render xterm with a placeholder banner instead of
 * trying to invoke commands that would fail.
 *
 * v1 single-session note: `pty_open` errors if a session already exists
 * on the backend. The mount effect runs once and keeps the session for
 * the hook's lifetime, so this is invariant.
 */
export function useTerminalSession({
  containerElement,
  isCollapsed,
}: UseTerminalSessionOptions): UseTerminalSessionResult {
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const isReadyRef = React.useRef<boolean>(false);
  const shellRef = React.useRef<"powershell" | "posix" | "unknown">("unknown");
  const publishContextRafRef = React.useRef<number | null>(null);
  const commandTrackerRef =
    React.useRef<TerminalCommandBoundaryTracker | null>(null);
  const [containerSize, setContainerSize] = React.useState({
    width: 0,
    height: 0,
  });
  const hasVisibleContainer = containerSize.width > 0 && containerSize.height > 0;

  React.useEffect(() => {
    if (!containerElement) {
      setContainerSize({ width: 0, height: 0 });
      return;
    }

    const readContainerSize = () => {
      setContainerSize({
        width: containerElement.clientWidth,
        height: containerElement.clientHeight,
      });
    };

    readContainerSize();
    const observer = new ResizeObserver(readContainerSize);
    observer.observe(containerElement);
    return () => observer.disconnect();
  }, [containerElement]);

  // Latch: flip true on first expand and stay true forever. Drives the
  // mount effect's dep so xterm/PTY mount once and only once.
  const [shouldMount, setShouldMount] = React.useState(false);
  React.useEffect(() => {
    if ((!isCollapsed || hasVisibleContainer) && !shouldMount) {
      setShouldMount(true);
    }
  }, [
    hasVisibleContainer,
    isCollapsed,
    shouldMount,
  ]);

  // Mount effect — runs exactly once when shouldMount flips to true.
  // Cleanup runs only when the hook itself unmounts.
  React.useEffect(() => {
    if (!shouldMount) return;
    if (terminalRef.current) return;
    const container = containerElement;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        "'JetBrains Mono', 'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      lineHeight: 1.3,
      scrollback: 5000,
      allowProposedApi: true,
      overviewRuler: { width: 6 },
      theme: TERMINAL_THEME,
    });

    const fit = new FitAddon();
    const webLinks = new WebLinksAddon();
    const unicode11 = new Unicode11Addon();
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    term.open(container);
    try {
      fit.fit();
    } catch {
      // 0-sized container in initial layout race — resize effect recovers.
    }

    terminalRef.current = term;
    fitAddonRef.current = fit;
    const publishTerminalContext = () => {
      const tracker = commandTrackerRef.current;
      if (!tracker) return;
      useTerminalPanelStore.getState().setTerminalContext(
        tracker.getContextSnapshot({
          sessionId: sessionIdRef.current,
          shell: shellRef.current,
          selectionText: term.hasSelection() ? term.getSelection() : "",
        }),
      );
    };
    const schedulePublishTerminalContext = () => {
      if (publishContextRafRef.current !== null) return;
      publishContextRafRef.current = requestAnimationFrame(() => {
        publishContextRafRef.current = null;
        publishTerminalContext();
      });
    };
    commandTrackerRef.current = installOsc133CommandBoundaries(term, {
      onCommandFailed: () => {
        schedulePublishTerminalContext();
      },
    });

    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let cancelled = false;

    const startSession = async () => {
      if (!isTauriRuntime()) {
        NON_TAURI_BANNER.forEach((line) => term.writeln(line));
        return;
      }

      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ]);

        // Subscribe BEFORE pty_open so the very first byte (e.g. shell
        // prompt) is captured. Filter is null-tolerant: in v1 we only
        // ever have one session so accept all events until we know our
        // own sessionId.
        unlistenOutput = await listen<PtyOutputPayload>(
          TERMINAL_OUTPUT_EVENT,
          (event) => {
            const expected = sessionIdRef.current;
            if (expected !== null && event.payload.sessionId !== expected) {
              return;
            }
            term.write(event.payload.data, schedulePublishTerminalContext);
          },
        );
        unlistenExit = await listen<PtyExitPayload>(
          TERMINAL_EXIT_EVENT,
          (event) => {
            const expected = sessionIdRef.current;
            if (expected !== null && event.payload.sessionId !== expected) {
              return;
            }
            isReadyRef.current = false;
            schedulePublishTerminalContext();
            term.writeln(
              "\r\n\x1b[33m[Process exited. Reload the panel to restart.]\x1b[0m",
            );
          },
        );

        if (cancelled) {
          unlistenOutput?.();
          unlistenExit?.();
          return;
        }

        const cols = term.cols > 0 ? term.cols : 80;
        const rows = term.rows > 0 ? term.rows : 24;
        const response = await invoke<PtyOpenResponse>("pty_open", {
          cols,
          rows,
          cwd: null,
        });

        if (cancelled) {
          unlistenOutput?.();
          unlistenExit?.();
          return;
        }

        sessionIdRef.current = response.sessionId;
        isReadyRef.current = true;
        const platform = await resolveTerminalPlatform().catch(() => null);
        shellRef.current =
          platform === "windows"
            ? "powershell"
            : platform === "posix"
              ? "posix"
              : "unknown";
        publishTerminalContext();
        await injectOsc133ShellIntegration(invoke, response.sessionId).catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        term.writeln(`\r\n\x1b[31m[Failed to start shell: ${msg}]\x1b[0m`);
      }
    };

    void startSession();

    // onData: forward every keystroke to the PTY. While the session is
    // not yet ready, drop input — startup banner has already informed
    // the user; the small (~100ms) delay won't surface practically.
    const onDataDisposable = term.onData((data) => {
      if (!isReadyRef.current) return;
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("pty_write", { sessionId, data });
        } catch {
          // Transient; backend may emit terminal:exit if it actually died.
        }
      })();
    });

    return () => {
      cancelled = true;
      onDataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      sessionIdRef.current = null;
      isReadyRef.current = false;
      commandTrackerRef.current?.dispose();
      commandTrackerRef.current = null;
      if (publishContextRafRef.current !== null) {
        cancelAnimationFrame(publishContextRafRef.current);
        publishContextRafRef.current = null;
      }
      useTerminalPanelStore.getState().setTerminalContext(null);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerElement, shouldMount]);

  // Resize observer + focus management. Re-subscribes whenever the panel
  // toggles collapsed state. Skipped while collapsed so the 0-width
  // parent never reaches FitAddon or pty_resize.
  React.useEffect(() => {
    if (isCollapsed && !hasVisibleContainer) return;
    const term = terminalRef.current;
    const fit = fitAddonRef.current;
    const container = containerElement;
    if (!term || !fit || !container) return;

    let raf = 0;
    const triggerFit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          return;
        }
        if (isReadyRef.current && sessionIdRef.current && isTauriRuntime()) {
          const sessionId = sessionIdRef.current;
          const cols = term.cols;
          const rows = term.rows;
          if (cols <= 0 || rows <= 0) return;
          void (async () => {
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("pty_resize", { sessionId, cols, rows });
            } catch {
              // Transient; ignore.
            }
          })();
        }
      });
    };

    // Catch up size + grab focus on the collapsed -> expanded transition.
    triggerFit();
    term.focus();

    const observer = new ResizeObserver(triggerFit);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    containerElement,
    containerSize.height,
    containerSize.width,
    hasVisibleContainer,
    isCollapsed,
  ]);

  // Stable accessor for the menu / panel layer to read the user's current
  // selection without leaking the Terminal instance itself.
  const getSelection = React.useCallback<UseTerminalSessionResult["getSelection"]>(
    () => {
      const term = terminalRef.current;
      if (!term) return "";
      return term.hasSelection() ? term.getSelection() : "";
    },
    [],
  );

  const getLastCommand = React.useCallback<
    UseTerminalSessionResult["getLastCommand"]
  >(() => commandTrackerRef.current?.getLastCommand() ?? null, []);

  const pasteText = React.useCallback<UseTerminalSessionResult["pasteText"]>(
    async (text) => {
      if (!text) return;
      const term = terminalRef.current as TerminalWithOptionalPaste | null;
      if (!term) {
        throw new Error("Terminal unavailable");
      }
      term.focus();
      if (typeof term.paste === "function" && isReadyRef.current) {
        term.paste(text);
        return;
      }
      const sessionId = sessionIdRef.current;
      if (!sessionId || !isReadyRef.current || !isTauriRuntime()) {
        throw new Error("Terminal not ready");
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("pty_write", { sessionId, data: text });
    },
    [],
  );

  return { getSelection, getLastCommand, pasteText };
}
