"use client";

import { ChevronUp, Maximize2, User, Bot } from "lucide-react";
import { motion, type Variants } from "framer-motion";

import { cn } from "@/lib/utils";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";

import { IslandApprovalCard } from "./island-approval-card";
import { IslandQuickReply } from "./island-quick-reply";
import { IslandSeedLogo } from "./island-seed-logo";
import { useIslandContext } from "./island-context";

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", damping: 20, stiffness: 300 },
  },
};

export function IslandExpandedView() {
  const {
    statusLabel,
    lastReplyText,
    recentMessages,
    pendingApproval,
    isBusy,
    errorMessage,
    collapse,
    sendQuickReply,
    approvePendingApproval,
    rejectPendingApproval,
    restoreWorkspace,
  } = useIslandContext();

  const isActive = statusLabel === "Working..." || statusLabel === "Pending approval";

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      className="overflow-hidden"
    >
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <IslandSeedLogo size={22} isActive={isActive} />
            <div className="flex items-center gap-1.5">
              <div className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full rounded-full opacity-75",
                    isActive ? "animate-ping bg-amber-400" : "bg-emerald-400"
                  )}
                />
                <span
                  className={cn(
                    "relative inline-flex rounded-full h-2 w-2",
                    isActive ? "bg-amber-400" : "bg-emerald-400"
                  )}
                />
              </div>
              <span className="text-[11px] font-medium text-foreground/70">
                {statusLabel}
              </span>
            </div>
          </div>
          <button
            onClick={collapse}
            className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-island-gold/10 transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5 text-island-gold" />
          </button>
        </motion.div>

        <div className="border-t border-island-shell-border/50" />

        <motion.div variants={itemVariants} className="px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-foreground/40 mb-1.5">
            Latest reply
          </p>
          {lastReplyText === "No replies yet." ? (
            <div className="flex flex-col items-center justify-center py-3 gap-2">
              <IslandSeedLogo size={32} isActive={false} />
              <p className="text-[12px] text-foreground/40 text-center">
                Deeting is ready to help. Send a message to get started.
              </p>
            </div>
          ) : (
            <div className="island-compact-markdown text-foreground/80">
              <MarkdownViewer content={lastReplyText} />
            </div>
          )}
        </motion.div>

        {recentMessages.length > 1 && (
          <>
            <div className="border-t border-island-shell-border/50" />
            <motion.div variants={itemVariants} className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-foreground/40 mb-1.5">
                Recent
              </p>
              <div className="space-y-1.5">
                {recentMessages.map((msg, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {msg.role === "user" ? (
                      <User className="w-3 h-3 mt-0.5 text-foreground/30 shrink-0" />
                    ) : (
                      <Bot className="w-3 h-3 mt-0.5 text-island-gold/60 shrink-0" />
                    )}
                    <span className="text-[11px] leading-snug text-foreground/55 truncate">
                      {msg.content}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}

        {pendingApproval ? (
          <>
            <div className="border-t border-island-shell-border/50" />
            <motion.div variants={itemVariants} className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-foreground/40 mb-1.5">
                Approval required
              </p>
              <IslandApprovalCard
                title={pendingApproval.title}
                desc={pendingApproval.desc}
                onApprove={approvePendingApproval}
                onReject={rejectPendingApproval}
                disabled={isBusy}
              />
            </motion.div>
          </>
        ) : null}

        <div className="border-t border-island-shell-border/50" />

        <motion.div variants={itemVariants} className="px-4 py-3">
          <IslandQuickReply onSend={sendQuickReply} disabled={isBusy} />
        </motion.div>

        {errorMessage ? (
          <>
            <div className="border-t border-island-shell-border/50" />
            <motion.div variants={itemVariants} className="px-4 py-2.5 text-[11px] text-amber-700 dark:text-amber-300">
              {errorMessage}
            </motion.div>
          </>
        ) : null}

        <div className="border-t border-island-shell-border/50" />

        <motion.button
          variants={itemVariants}
          onClick={restoreWorkspace}
          className="flex items-center justify-center gap-1.5 w-full px-4 py-2 text-[11px] font-medium text-island-gold hover:bg-island-gold/8 transition-colors"
        >
          <Maximize2 className="w-3 h-3" />
          Return to workspace
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
