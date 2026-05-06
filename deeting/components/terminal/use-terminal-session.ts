"use client";

import * as React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";

import "@xterm/xterm/css/xterm.css";

interface UseTerminalSessionOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isCollapsed: boolean;
}

/**
 * Theme tuned for a dark "panel-on-app" look. Tracked separately from app
 * theme tokens for now; in v1.5 we may derive these from CSS variables so
 * the terminal follows light/dark mode automatically.
 */
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

/** Pseudo-prompt used by the Phase 2 self-echo loop. */
const PROMPT = "\x1b[36mdeeting\x1b[0m \x1b[33m›\x1b[0m ";

const PHASE_2_BANNER = [
  "\x1b[2;90m# Phase 2 self-echo. Real PTY lands in Phase 3-4.\x1b[0m",
  "\x1b[2;90m# Type to echo locally; Enter flushes the buffer; Ctrl+C resets.\x1b[0m",
  "",
];

/**
 * Mounts and manages an xterm.js Terminal instance bound to a container ref.
 *
 * Lifecycle:
 * - **Lazy-mounts** on first non-collapsed render — users who never open
 *   the terminal pay zero cost.
 * - **Stays mounted** across collapse/expand cycles so scrollback, cursor
 *   position, and (in Phase 4+) the upstream PTY session are preserved.
 * - **Disposes** only when the hook unmounts.
 *
 * Resize:
 * - While collapsed, the FitAddon is frozen — the parent panel's 0-width
 *   collapsedSize must never propagate into a cols=0 / rows=0 update,
 *   which would corrupt a real PTY in Phase 4.
 * - On the collapsed -> expanded transition, fires a single fit() + focus()
 *   so the terminal catches up to the new size and is ready for input.
 *
 * Phase 2 implements a self-echo loop inline. Phase 4 replaces the entire
 * `onData` handler with a `pty_write` invocation and subscribes the
 * terminal to a `terminal:output` Tauri event for the read direction.
 */
export function useTerminalSession({
  containerRef,
  isCollapsed,
}: UseTerminalSessionOptions) {
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const lineBufferRef = React.useRef<string>("");

  // Mount xterm lazily on first non-collapsed render.
  React.useEffect(() => {
    if (isCollapsed) return;
    if (terminalRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        "'JetBrains Mono', 'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      lineHeight: 1.3,
      scrollback: 5000,
      // allowProposedApi is required by the Unicode11Addon.
      allowProposedApi: true,
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
      // FitAddon throws if container measures 0 in a layout race; the
      // ResizeObserver below recovers on the next tick.
    }

    PHASE_2_BANNER.forEach((line) => term.writeln(line));
    term.write(PROMPT);

    // Phase 2 self-echo input handler. Replaced wholesale in Phase 4 with
    // `invoke('pty_write', { sessionId, data })`.
    const onDataDisposable = term.onData((data) => {
      const code = data.charCodeAt(0);

      // Enter — flush line buffer and re-prompt.
      if (data === "\r") {
        term.write("\r\n");
        const line = lineBufferRef.current;
        lineBufferRef.current = "";
        if (line.trim().length > 0) {
          term.writeln(`\x1b[90m(echo)\x1b[0m ${line}`);
        }
        term.write(PROMPT);
        return;
      }

      // Backspace (DEL = 127). Erase one cell only if buffer is non-empty.
      if (code === 127) {
        if (lineBufferRef.current.length > 0) {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }

      // Ctrl+C — abandon current line.
      if (data === "\x03") {
        term.write("^C\r\n");
        lineBufferRef.current = "";
        term.write(PROMPT);
        return;
      }

      // Printable + Tab. Skip other control bytes in self-echo mode.
      if (code >= 32 || code === 9) {
        lineBufferRef.current += data;
        term.write(data);
      }
    });

    terminalRef.current = term;
    fitAddonRef.current = fit;

    return () => {
      onDataDisposable.dispose();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lineBufferRef.current = "";
    };
  }, [containerRef, isCollapsed]);

  // Resize observer + focus management. Skipped while collapsed so the
  // 0-width parent never reaches FitAddon. On expand, fits + refocuses.
  React.useEffect(() => {
    if (isCollapsed) return;
    const term = terminalRef.current;
    const fit = fitAddonRef.current;
    const container = containerRef.current;
    if (!term || !fit || !container) return;

    let raf = 0;
    const triggerFit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // 0-sized container during transitions — next observer tick recovers.
        }
      });
    };

    // Catch up on size + grab focus on the collapsed -> expanded transition.
    triggerFit();
    term.focus();

    const observer = new ResizeObserver(triggerFit);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [containerRef, isCollapsed]);
}
