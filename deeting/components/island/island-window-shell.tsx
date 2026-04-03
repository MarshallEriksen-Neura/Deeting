"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/lib/utils";

import { IslandCollapsedView } from "./island-collapsed-view";
import { IslandExpandedView } from "./island-expanded-view";
import { IslandProvider } from "./island-context";
import {
  useIslandWindowStore,
  type IslandSyncPayload,
} from "./island-window-store";

const COLLAPSED_SIZE = { width: 344, height: 60 };
const EXPANDED_SIZE = { width: 580, height: 560 };

/* ── Edge-snap constants ── */
const SNAP_THRESHOLD = 24;
const SNAP_MARGIN = 10;
const DRAG_IDLE_MS = 150;
const SNAP_ANIM_MS = 200;

type SnapEdges = { left: boolean; right: boolean; top: boolean; bottom: boolean };

function computeSnap(
  pos: { x: number; y: number },
  winSize: { width: number; height: number },
  screenSize: { width: number; height: number },
): { snapped: { x: number; y: number }; edges: SnapEdges } {
  const edges: SnapEdges = { left: false, right: false, top: false, bottom: false };
  let { x, y } = pos;

  if (x <= SNAP_THRESHOLD + SNAP_MARGIN) {
    x = SNAP_MARGIN;
    edges.left = true;
  } else if (x + winSize.width >= screenSize.width - SNAP_THRESHOLD - SNAP_MARGIN) {
    x = screenSize.width - winSize.width - SNAP_MARGIN;
    edges.right = true;
  }

  if (y <= SNAP_THRESHOLD + SNAP_MARGIN) {
    y = SNAP_MARGIN;
    edges.top = true;
  } else if (y + winSize.height >= screenSize.height - SNAP_THRESHOLD - SNAP_MARGIN) {
    y = screenSize.height - winSize.height - SNAP_MARGIN;
    edges.bottom = true;
  }

  return { snapped: { x, y }, edges };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function animatePosition(
  from: { x: number; y: number },
  to: { x: number; y: number },
  invokeFn: (cmd: string, args: { x: number; y: number }) => Promise<unknown>,
  onFrame: () => void,
  onDone: () => void,
): () => void {
  let cancelled = false;
  const start = performance.now();

  function tick(now: number) {
    if (cancelled) return;
    const t = Math.min((now - start) / SNAP_ANIM_MS, 1);
    const e = easeOutCubic(t);
    const x = from.x + (to.x - from.x) * e;
    const y = from.y + (to.y - from.y) * e;
    onFrame();
    invokeFn("set_island_position", { x, y });
    if (t < 1) requestAnimationFrame(tick);
    else onDone();
  }

  requestAnimationFrame(tick);
  return () => { cancelled = true; };
}

export function IslandWindowShell() {
  const store = useIslandWindowStore(
    useShallow((s) => ({
      mode: s.mode,
      statusLabel: s.statusLabel,
      summaryText: s.summaryText,
      lastReplyText: s.lastReplyText,
      lastReplyAt: s.lastReplyAt,
      recentMessages: s.recentMessages,
      pendingApproval: s.pendingApproval,
      isBusy: s.isBusy,
      errorMessage: s.errorMessage,
      statusStage: s.statusStage,
      statusCode: s.statusCode,
      statusMeta: s.statusMeta,
      stageHistory: s.stageHistory,
      expand: s.expand,
      collapse: s.collapse,
      hide: s.hide,
      toggleExpand: s.toggleExpand,
      restoreWorkspace: s.restoreWorkspace,
      sendQuickReply: s.sendQuickReply,
      approvePendingApproval: s.approvePendingApproval,
      rejectPendingApproval: s.rejectPendingApproval,
    }))
  );

  const syncFromEvent = useIslandWindowStore((s) => s.syncFromEvent);
  const mode = store.mode;

  // Listen for state sync events from main window
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<IslandSyncPayload>(
        "island:state-sync",
        (event) => {
          syncFromEvent(event.payload);
        }
      );
    })();

    return () => {
      unlisten?.();
    };
  }, [syncFromEvent]);

  // Resize window when mode changes
  useEffect(() => {
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const size =
        mode === "expanded" ? EXPANDED_SIZE : COLLAPSED_SIZE;
      await invoke("set_island_size", size);
    })();
  }, [mode]);

  // Position management: restore saved position, snap to edges after drag
  const positionInitRef = React.useRef(false);
  useEffect(() => {
    let unlistenMoved: (() => void) | undefined;
    let dragIdleTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelAnim: (() => void) | null = null;
    let selfMoveUntil = 0;

    const winSize = mode === "expanded" ? EXPANDED_SIZE : COLLAPSED_SIZE;

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { getCurrentWindow, currentMonitor, primaryMonitor } = await import("@tauri-apps/api/window");

      // Restore saved position (only on first mount)
      if (!positionInitRef.current) {
        positionInitRef.current = true;
        const saved = localStorage.getItem("island-position");
        if (saved) {
          try {
            const { x, y } = JSON.parse(saved);
            await invoke("set_island_position", { x, y });
          } catch {
            // ignore parse errors
          }
        } else {
          try {
            const monitor = await primaryMonitor();
            if (monitor) {
              const x = monitor.size.width / monitor.scaleFactor - 400;
              const y = monitor.size.height / monitor.scaleFactor - 150;
              await invoke("set_island_position", { x, y });
            }
          } catch {
            // fallback: don't set position
          }
        }
      }

      // Listen for window moves (during drag) + snap after drag ends
      unlistenMoved = await getCurrentWindow().onMoved(({ payload }) => {
        // Anti-loop: ignore moves triggered by our own snap animation
        if (Date.now() < selfMoveUntil) return;

        // Cancel any in-flight snap animation (user started dragging again)
        if (cancelAnim) { cancelAnim(); cancelAnim = null; }

        // Debounce: detect drag-end when onMoved stops for DRAG_IDLE_MS
        if (dragIdleTimer !== null) clearTimeout(dragIdleTimer);
        dragIdleTimer = setTimeout(async () => {
          try {
            const mon = await currentMonitor();
            if (!mon) {
              // No monitor info — just save raw position
              localStorage.setItem("island-position", JSON.stringify({ x: payload.x, y: payload.y }));
              return;
            }
            const sf = mon.scaleFactor;
            const logicalPos = { x: payload.x / sf, y: payload.y / sf };
            const screenLogical = {
              width: mon.size.width / sf,
              height: mon.size.height / sf,
            };

            const { snapped, edges } = computeSnap(logicalPos, winSize, screenLogical);
            const didSnap = edges.left || edges.right || edges.top || edges.bottom;

            if (didSnap) {
              selfMoveUntil = Date.now() + SNAP_ANIM_MS + 100;

              window.dispatchEvent(
                new CustomEvent("island:snap", { detail: edges })
              );

              cancelAnim = animatePosition(
                logicalPos,
                snapped,
                invoke,
                () => { selfMoveUntil = Date.now() + SNAP_ANIM_MS + 100; },
                () => { cancelAnim = null; },
              );

              localStorage.setItem("island-position", JSON.stringify(snapped));
            } else {
              localStorage.setItem("island-position", JSON.stringify(logicalPos));
            }
          } catch {
            // monitor query failed; save raw position
            localStorage.setItem("island-position", JSON.stringify({ x: payload.x, y: payload.y }));
          }
        }, DRAG_IDLE_MS);
      });
    })();

    return () => {
      if (dragIdleTimer !== null) clearTimeout(dragIdleTimer);
      if (cancelAnim) cancelAnim();
      unlistenMoved?.();
    };
  }, [mode]);

  // Snap-edge glow visual feedback
  const [snapEdges, setSnapEdges] = useState<SnapEdges | null>(null);
  useEffect(() => {
    function onSnap(e: Event) {
      const edges = (e as CustomEvent<SnapEdges>).detail;
      setSnapEdges(edges);
      setTimeout(() => setSnapEdges(null), 450);
    }
    window.addEventListener("island:snap", onSnap);
    return () => window.removeEventListener("island:snap", onSnap);
  }, []);

  if (mode === "hidden") return null;

  return (
    <IslandProvider value={store}>
      <div className="w-full h-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", damping: 24, stiffness: 260 }}
          className="w-full h-full"
        >
          <motion.div
            layout
            className={cn(
              "relative rounded-[1.75rem] overflow-hidden w-full h-full min-h-0",
              "border border-island-shell-border",
              "bg-island-shell-bg backdrop-blur-2xl",
              "shadow-[0_12px_36px_-16px_rgba(0,0,0,0.18)]"
            )}
          >
            <AnimatePresence>
              {store.isBusy && (
                <motion.div
                  key="glow"
                  className="island-active-glow"
                  aria-hidden="true"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.7 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                />
              )}
            </AnimatePresence>
            {snapEdges && (
              <>
                {snapEdges.left   && <div className="island-snap-glow" data-edge="left" />}
                {snapEdges.right  && <div className="island-snap-glow" data-edge="right" />}
                {snapEdges.top    && <div className="island-snap-glow" data-edge="top" />}
                {snapEdges.bottom && <div className="island-snap-glow" data-edge="bottom" />}
              </>
            )}
            <AnimatePresence mode="wait">
              {mode === "collapsed" ? (
                <motion.div
                  key="collapsed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full"
                >
                  <IslandCollapsedView dragRegion compact />
                </motion.div>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full min-h-0"
                >
                  <IslandExpandedView headerDragRegion />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </IslandProvider>
  );
}
