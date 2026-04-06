"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useIslandStore } from "./island-store";
import { IslandCollapsedView } from "./island-collapsed-view";
import { IslandExpandedView } from "./island-expanded-view";
import { IslandProvider } from "./island-context";
import { resolveIslandChatRequestConfig } from "./island-chat-request";
import { cn } from "@/lib/utils";
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri";
import { useChatStore } from "@/store/chat-store";

type IslandActionCompletedPayload = {
  sessionId?: string | null;
};

const AUTO_COLLAPSE_DELAY_MS = 1800;
const COMPLETED_BADGE_DURATION_MS = 2600;

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
    })),
  );

  const { mode } = storeValues;
  const autoCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const approvalFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const completionFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const collapsedHighlightTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const previousActiveRef = useRef(false);
  const previousPendingApprovalRef = useRef(false);
  const [approvalFlash, setApprovalFlash] = useState(false);
  const [completionFlash, setCompletionFlash] = useState(false);
  const [collapsedHighlight, setCollapsedHighlight] = useState<{
    tone: "success" | "pending";
    labelKey: string;
    detailKey?: string | null;
  } | null>(null);
  const hydrateFromChat = useIslandStore((s) => s.hydrateFromChat);
  const chatSnapshot = useChatStore(
    useShallow((state) => ({
      sessionId: state.sessionId,
      config: state.config,
      models: state.models,
      messages: state.messages,
      isLoading: state.isLoading,
      globalLoading: state.globalLoading,
      statusStage: state.statusStage,
      statusCode: state.statusCode,
      statusMeta: state.statusMeta,
      errorMessage: state.errorMessage,
    })),
  );

  useEffect(() => {
    hydrateFromChat(chatSnapshot);
  }, [chatSnapshot, hydrateFromChat]);

  const hasPendingApproval = Boolean(storeValues.pendingApproval);
  const isTaskActive =
    storeValues.isBusy ||
    hasPendingApproval ||
    Boolean(storeValues.statusCode) ||
    storeValues.statusLabel === "Working..." ||
    storeValues.statusLabel === "Pending approval";

  useEffect(() => {
    const pendingApprovalJustAppeared =
      hasPendingApproval && !previousPendingApprovalRef.current;

    if (pendingApprovalJustAppeared && mode === "collapsed") {
      storeValues.expand();
    }
    if (pendingApprovalJustAppeared) {
      if (collapsedHighlightTimerRef.current !== null) {
        clearTimeout(collapsedHighlightTimerRef.current);
        collapsedHighlightTimerRef.current = null;
      }
      setCollapsedHighlight(null);
    }
    if (pendingApprovalJustAppeared) {
      if (approvalFlashTimerRef.current !== null) {
        clearTimeout(approvalFlashTimerRef.current);
      }
      setApprovalFlash(true);
      approvalFlashTimerRef.current = setTimeout(() => {
        setApprovalFlash(false);
        approvalFlashTimerRef.current = null;
      }, 950);
    }

    if (
      autoCollapseTimerRef.current !== null &&
      (isTaskActive || mode !== "expanded")
    ) {
      clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }

    const taskJustCompleted =
      previousActiveRef.current &&
      !isTaskActive &&
      mode === "expanded" &&
      !storeValues.errorMessage;

    if (taskJustCompleted) {
      if (completionFlashTimerRef.current !== null) {
        clearTimeout(completionFlashTimerRef.current);
      }
      setCompletionFlash(true);
      completionFlashTimerRef.current = setTimeout(() => {
        setCompletionFlash(false);
        completionFlashTimerRef.current = null;
      }, 1100);

      autoCollapseTimerRef.current = setTimeout(() => {
        const state = useIslandStore.getState();
        if (
          state.mode === "expanded" &&
          !state.isBusy &&
          !state.pendingApproval &&
          !state.errorMessage
        ) {
          state.collapse();
          if (collapsedHighlightTimerRef.current !== null) {
            clearTimeout(collapsedHighlightTimerRef.current);
          }
          setCollapsedHighlight({
            tone: "success",
            labelKey: "island.status.completed",
            detailKey: "island.completedDetail",
          });
          collapsedHighlightTimerRef.current = setTimeout(() => {
            setCollapsedHighlight(null);
            collapsedHighlightTimerRef.current = null;
          }, COMPLETED_BADGE_DURATION_MS);
        }
        autoCollapseTimerRef.current = null;
      }, AUTO_COLLAPSE_DELAY_MS);
    }

    previousActiveRef.current = isTaskActive;
    previousPendingApprovalRef.current = hasPendingApproval;

    return () => {
      if (
        autoCollapseTimerRef.current !== null &&
        (isTaskActive || mode !== "expanded")
      ) {
        clearTimeout(autoCollapseTimerRef.current);
        autoCollapseTimerRef.current = null;
      }
      if (
        !pendingApprovalJustAppeared &&
        approvalFlashTimerRef.current !== null
      ) {
        clearTimeout(approvalFlashTimerRef.current);
        approvalFlashTimerRef.current = null;
      }
      if (collapsedHighlightTimerRef.current !== null && isTaskActive) {
        clearTimeout(collapsedHighlightTimerRef.current);
        collapsedHighlightTimerRef.current = null;
      }
    };
  }, [hasPendingApproval, isTaskActive, mode, storeValues]);

  const chatRequestConfig = resolveIslandChatRequestConfig({
    configModel: chatSnapshot.config.model,
    models: chatSnapshot.models,
    isTauriRuntime: detectTauriRuntime(),
  });

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
          statusStage: state.statusStage,
          statusCode: state.statusCode,
          statusMeta: state.statusMeta,
          stageHistory: state.stageHistory,
          sessionId: chatSnapshot.sessionId,
          chatRequestConfig,
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
  }, [
    chatRequestConfig,
    storeValues,
    chatSnapshot.sessionId,
  ]);

  // Listen for action-completed from Island window → re-sync chat
  const resyncChat = useCallback(
    async (payload?: IslandActionCompletedPayload) => {
      const sessionId =
        typeof payload?.sessionId === "string" &&
        payload.sessionId.trim().length > 0
          ? payload.sessionId.trim()
          : useChatStore.getState().sessionId;
      if (!sessionId) return;
      try {
        if (useChatStore.getState().sessionId !== sessionId) {
          useChatStore.getState().setSessionId(sessionId);
        }
        const { fetchConversationHistory } =
          await import("@/lib/api/conversations");
        const { normalizeConversationMessages } =
          await import("@/lib/chat/conversation-adapter");
        const history = await fetchConversationHistory(sessionId, {
          limit: 200,
        });
        const normalized = normalizeConversationMessages(
          history.messages ?? [],
        );
        useChatStore.getState().setMessages(normalized);
      } catch {
        // ignore sync errors
      }
    },
    [],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<IslandActionCompletedPayload>(
          "island:action-completed",
          (event) => {
            resyncChat(event.payload);
          },
        );
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
    <IslandProvider value={{ ...storeValues, collapsedHighlight }}>
      <motion.div
        initial={{ opacity: 0, y: -30, scale: 0.85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -30, scale: 0.85 }}
        transition={{ type: "spring", damping: 24, stiffness: 260 }}
        style={{
          transformOrigin: "top center",
        }}
        className={cn(
          "fixed top-4 left-1/2 -translate-x-1/2 z-[70]",
          "transition-[width] duration-300 ease-out",
          mode === "expanded" ? "w-[592px]" : "w-[372px]",
        )}
      >
        <motion.div
          layout
          transition={{ type: "spring", damping: 26, stiffness: 260 }}
          animate={{
            borderRadius: mode === "expanded" ? 34 : 999,
            scale: approvalFlash ? 1.018 : completionFlash ? 1.01 : 1,
            boxShadow:
              mode === "expanded"
                ? completionFlash
                  ? "0 28px 62px -26px rgba(16,185,129,0.3)"
                  : approvalFlash
                    ? "0 26px 58px -24px rgba(212,184,150,0.36)"
                    : "0 24px 56px -30px rgba(0,0,0,0.34)"
                : approvalFlash
                  ? "0 22px 44px -22px rgba(212,184,150,0.38)"
                  : completionFlash
                    ? "0 22px 46px -24px rgba(16,185,129,0.3)"
                    : "0 18px 40px -26px rgba(0,0,0,0.38)",
          }}
          className={cn(
            "relative overflow-hidden",
            "border border-island-shell-border",
            "bg-island-shell-bg backdrop-blur-2xl",
            mode === "expanded"
              ? "ring-1 ring-white/20"
              : "ring-1 ring-white/30",
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
          <AnimatePresence>
            {approvalFlash ? (
              <motion.div
                key="approval-flash"
                className="island-approval-glow"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            ) : null}
            {completionFlash ? (
              <motion.div
                key="completion-flash"
                className="island-complete-glow"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            ) : null}
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
