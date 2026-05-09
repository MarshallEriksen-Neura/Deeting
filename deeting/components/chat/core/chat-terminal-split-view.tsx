"use client";

import * as React from "react";
import {
  usePanelRef,
  type PanelImperativeHandle,
  type PanelSize,
} from "react-resizable-panels";

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/ui/shadcn/resizable";
import { cn } from "@/lib/utils";
import { useTerminalPanelStore } from "@/store/terminal-panel-store";
import { TerminalPanel } from "@/components/terminal/terminal-panel";

// `PanelImperativeHandle` is re-exported solely so external callers (none
// today, but anticipated) can share the same handle type without depending
// on `react-resizable-panels` directly.
export type { PanelImperativeHandle };

interface ChatTerminalSplitViewProps {
  hud: React.ReactNode;
  controls: React.ReactNode;
  children: React.ReactNode;
}

// react-resizable-panels v4 treats bare numeric props as PIXELS, not percentages.
// String values without an explicit unit (or ending with "%") are percentages.
// We want percentage-based sizing so the splitter scales with window width.
/** Default width (% of group) when the terminal is freshly opened. */
const TERMINAL_DEFAULT_SIZE = "40%";
/** Smallest terminal width before further drag triggers auto-collapse. */
const TERMINAL_MIN_SIZE = "25%";
/** Largest terminal width — keeps chat usable even when terminal is wide. */
const TERMINAL_MAX_SIZE = "60%";
/** Smallest chat-main width — prevents the chat column from being squeezed. */
const CHAT_MAIN_MIN_SIZE = "40%";

/**
 * Wraps the main chat interaction layer in a horizontal splitter. The left
 * panel hosts the existing hud / chat / controls grid. The right panel hosts
 * the terminal — collapsed (size 0) by default and toggled exclusively via
 * the Island terminal button.
 *
 * Design choices (locked in plan):
 * - Width is **not** persisted across sessions: each fresh open snaps to
 *   `TERMINAL_DEFAULT_SIZE`. Within a session the user may drag to resize.
 * - When collapsed, the resize handle is visually and interactively hidden.
 *   There is no edge-drag-to-reveal — the toggle is button-only by design.
 * - Store is the source of truth. An effect bridges store toggles to the
 *   imperative panel handle. Inversely, `onResize` watches for user-driven
 *   collapse (e.g. dragging below minSize) and reflects it back to the
 *   store so the Island button stays in sync.
 */
export function ChatTerminalSplitView({
  hud,
  controls,
  children,
}: ChatTerminalSplitViewProps) {
  const isOpen = useTerminalPanelStore((state) => state.isOpen);
  const open = useTerminalPanelStore((state) => state.open);
  const close = useTerminalPanelStore((state) => state.close);

  // `usePanelRef` is the v4 convenience hook — returns a typed RefObject
  // matching what `<ResizablePanel panelRef={...} />` expects.
  const terminalPanelRef = usePanelRef();

  // Bridge: store -> panel. When the Island button toggles the store, sync
  // the imperative handle. Always snap fresh expands to the default size —
  // we deliberately don't remember last drag width across toggles.
  React.useEffect(() => {
    const handle = terminalPanelRef.current;
    if (!handle) return;
    const currentlyCollapsed = handle.isCollapsed();
    if (isOpen && currentlyCollapsed) {
      handle.expand();
      handle.resize(TERMINAL_DEFAULT_SIZE);
    } else if (!isOpen && !currentlyCollapsed) {
      handle.collapse();
    }
  }, [isOpen, terminalPanelRef]);

  // Reverse bridge: panel resize -> store. v4 dropped the dedicated
  // `onCollapse`/`onExpand` callbacks; we reconstruct collapse detection
  // from the size transition. If the user drags the handle past minSize
  // (or any other path causes a 0-sized panel), reflect that into store.
  const handlePanelResize = React.useCallback(
    (
      panelSize: PanelSize,
      _id: string | number | undefined,
      prevPanelSize: PanelSize | undefined,
    ) => {
      if (!prevPanelSize) return;
      const wasOpen = prevPanelSize.asPercentage > 0;
      const wasCollapsed = prevPanelSize.asPercentage === 0;
      const nowCollapsed = panelSize.asPercentage === 0;
      const nowOpen = panelSize.asPercentage > 0;
      if (wasCollapsed && nowOpen) {
        open();
        return;
      }
      if (wasOpen && nowCollapsed) {
        close();
      }
    },
    [close, open],
  );

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="relative z-10 h-full w-full"
    >
      <ResizablePanel id="chat-main" defaultSize="100%" minSize={CHAT_MAIN_MIN_SIZE}>
        <div className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto]">
          {/* Heads-Up Display (Top Center) */}
          <div
            data-chat-hud
            className="flex justify-center pt-6 pointer-events-none"
          >
            <div className="pointer-events-auto">{hud}</div>
          </div>

          {/* Chat content */}
          <div
            data-chat-scroll
            className="relative min-h-0 overflow-y-auto overflow-x-hidden"
          >
            <div className="flex min-h-0 h-full w-full">{children}</div>
          </div>

          {/* Controls / Morphing Bar (Bottom Center) */}
          {controls ? (
            <div
              data-chat-controls
              className="flex justify-center pb-8 pointer-events-none"
            >
              <div className="pointer-events-auto w-full max-w-5xl 2xl:max-w-6xl px-4">
                {controls}
              </div>
            </div>
          ) : null}
        </div>
      </ResizablePanel>

      <ResizableHandle
        className={cn(
          "relative w-[1px] bg-[rgba(255,255,255,0.08)] transition-opacity duration-200 after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:cursor-col-resize",
          // Hide handle visually + disable pointer events when collapsed.
          // No edge-drag-to-reveal by design; toggle is button-only.
          !isOpen && "pointer-events-none opacity-0",
        )}
      />

      <ResizablePanel
        panelRef={terminalPanelRef}
        id="chat-terminal"
        collapsible
        collapsedSize="0%"
        defaultSize="0%"
        minSize={TERMINAL_MIN_SIZE}
        maxSize={TERMINAL_MAX_SIZE}
        onResize={handlePanelResize}
      >
        <TerminalPanel isCollapsed={!isOpen} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
