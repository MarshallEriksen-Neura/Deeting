"use client";

import { useEffect, useCallback } from "react";
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

const COLLAPSED_SIZE = { width: 380, height: 88 };
const EXPANDED_SIZE = { width: 580, height: 340 };

export function IslandWindowShell() {
  const store = useIslandWindowStore(
    useShallow((s) => ({
      mode: s.mode,
      statusLabel: s.statusLabel,
      summaryText: s.summaryText,
      lastReplyText: s.lastReplyText,
      pendingApproval: s.pendingApproval,
      isBusy: s.isBusy,
      errorMessage: s.errorMessage,
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

  // Position management: restore saved position or default to bottom-right
  useEffect(() => {
    let unlistenMoved: (() => void) | undefined;

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");

      const saved = localStorage.getItem("island-position");
      if (saved) {
        try {
          const { x, y } = JSON.parse(saved);
          await invoke("set_island_position", { x, y });
        } catch {
          // ignore parse errors
        }
      } else {
        // Default: bottom-right of primary monitor
        try {
          const monitor = await getCurrentWindow().currentMonitor();
          if (monitor) {
            const x = monitor.size.width / monitor.scaleFactor - 400;
            const y = monitor.size.height / monitor.scaleFactor - 150;
            await invoke("set_island_position", { x, y });
          }
        } catch {
          // fallback: don't set position
        }
      }

      // Persist position after drag (debounced)
      let saveTimeout: ReturnType<typeof setTimeout>;
      unlistenMoved = await getCurrentWindow().onMoved(({ payload }) => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          localStorage.setItem(
            "island-position",
            JSON.stringify({ x: payload.x, y: payload.y })
          );
        }, 300);
      });
    })();

    return () => {
      unlistenMoved?.();
    };
  }, []);

  if (mode === "hidden") return null;

  return (
    <IslandProvider value={store}>
      <div
        data-tauri-drag-region
        className="w-full h-full"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", damping: 24, stiffness: 260 }}
          className="w-full"
        >
          <motion.div
            layout
            className={cn(
              "rounded-[1.75rem] overflow-hidden",
              "border border-[var(--island-shell-border)]",
              "bg-[var(--island-shell-bg)] backdrop-blur-2xl",
              "shadow-[0_0_0_1px_var(--island-gold-stroke-soft),0_12px_36px_-16px_rgba(0,0,0,0.18)]",
              "ring-1 ring-[var(--island-gold-stroke-soft)]"
            )}
          >
            <AnimatePresence mode="wait">
              {mode === "collapsed" ? (
                <motion.div
                  key="collapsed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <IslandCollapsedView />
                </motion.div>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <IslandExpandedView />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </IslandProvider>
  );
}
