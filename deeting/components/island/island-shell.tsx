"use client";

import { useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useIslandStore } from "./island-store";
import { IslandCollapsedView } from "./island-collapsed-view";
import { IslandExpandedView } from "./island-expanded-view";
import { IslandProvider } from "./island-context";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";

export function IslandShell() {
  const storeValues = useIslandStore(
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

  const { mode } = storeValues;
  const hydrateFromChat = useIslandStore((s) => s.hydrateFromChat);
  const chatSnapshot = useChatStore(
    useShallow((state) => ({
      sessionId: state.sessionId,
      selectedAssistant: state.selectedAssistant,
      messages: state.messages,
      isLoading: state.isLoading,
      globalLoading: state.globalLoading,
      statusCode: state.statusCode,
      errorMessage: state.errorMessage,
    }))
  );

  useEffect(() => {
    hydrateFromChat(chatSnapshot);
  }, [chatSnapshot, hydrateFromChat]);

  // Emit state sync to Island window (debounced)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (syncTimerRef.current !== null) {
      clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = setTimeout(async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        const state = useIslandStore.getState();
        await emit("island:state-sync", {
          mode: state.mode,
          statusLabel: state.statusLabel,
          summaryText: state.summaryText,
          lastReplyText: state.lastReplyText,
          lastReplyAt: state.lastReplyAt,
          recentMessages: state.recentMessages,
          pendingApproval: state.pendingApproval,
          isBusy: state.isBusy,
          errorMessage: state.errorMessage,
          sessionId: chatSnapshot.sessionId,
        });
      } catch {
        // emit may fail in non-Tauri env
      }
    }, 100);
    return () => {
      if (syncTimerRef.current !== null) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, [storeValues, chatSnapshot.sessionId]);

  // Listen for action-completed from Island window → re-sync chat
  const resyncChat = useCallback(async () => {
    const sessionId = useChatStore.getState().sessionId;
    if (!sessionId) return;
    try {
      const { fetchConversationHistory } = await import("@/lib/api/conversations");
      const { normalizeConversationMessages } = await import("@/lib/chat/conversation-adapter");
      const history = await fetchConversationHistory(sessionId, { limit: 200 });
      const normalized = normalizeConversationMessages(history.messages ?? []);
      useChatStore.getState().setMessages(normalized);
    } catch {
      // ignore sync errors
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("island:action-completed", () => {
          resyncChat();
        });
      } catch {
        // non-Tauri env
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [resyncChat]);

  if (mode === "hidden") return null;

  return (
    <IslandProvider value={storeValues}>
      <motion.div
        initial={{ opacity: 0, y: -30, scale: 0.85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -30, scale: 0.85 }}
        transition={{ type: "spring", damping: 24, stiffness: 260 }}
        className={cn(
          "fixed top-4 left-1/2 -translate-x-1/2 z-[70]",
          "transition-[width] duration-300 ease-out",
          mode === "expanded" ? "w-[580px]" : "w-[360px]"
        )}
      >
        <motion.div
          layout
          className={cn(
            "relative rounded-[1.75rem] overflow-hidden",
            "border border-island-shell-border",
            "bg-island-shell-bg backdrop-blur-2xl",
            "shadow-[0_12px_36px_-16px_rgba(0,0,0,0.18)]"
          )}
        >
          <AnimatePresence>
            {storeValues.isBusy && (
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
    </IslandProvider>
  );
}
