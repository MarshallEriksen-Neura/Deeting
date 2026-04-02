"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useIslandStore } from "./island-store";
import { IslandCollapsedView } from "./island-collapsed-view";
import { IslandExpandedView } from "./island-expanded-view";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";

export function IslandShell() {
  const mode = useIslandStore((s) => s.mode);
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

  if (mode === "hidden") return null;

  return (
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
  );
}
