"use client";

import { ChevronUp, Maximize2, User, Bot } from "lucide-react";
import { motion, type Variants } from "framer-motion";

import { cn } from "@/lib/utils";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import type { IslandRecentMessage } from "./island-store";

import { IslandApprovalCard } from "./island-approval-card";
import { IslandQuickReply } from "./island-quick-reply";
import { IslandSeedLogo } from "./island-seed-logo";
import { IslandStatusTimeline } from "./island-status-timeline";
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

function IslandTranscriptMessage({ message }: { message: IslandRecentMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-[18px] border px-3 py-2 shadow-sm",
          isUser
            ? "border-island-gold/25 bg-island-gold/12 text-foreground"
            : "border-island-shell-border/60 bg-background/65 text-foreground/85"
        )}
      >
        <div
          className={cn(
            "mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
            isUser ? "text-island-gold/90" : "text-foreground/40"
          )}
        >
          {isUser ? (
            <User className="h-3 w-3 shrink-0" />
          ) : (
            <Bot className="h-3 w-3 shrink-0 text-island-gold/70" />
          )}
          <span>{isUser ? "You" : "Deeting"}</span>
        </div>
        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-[12px] leading-5">{message.content}</p>
        ) : (
          <div className="break-words text-[12px] leading-5">
            <MarkdownViewer
              content={message.content}
              className="chat-markdown chat-markdown-assistant text-[12px] leading-5"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function IslandExpandedView({
  headerDragRegion = false,
}: {
  headerDragRegion?: boolean;
} = {}) {
  const {
    statusLabel,
    recentMessages,
    pendingApproval,
    isBusy,
    errorMessage,
    statusStage,
    statusCode,
    statusMeta,
    stageHistory,
    collapse,
    sendQuickReply,
    approvePendingApproval,
    rejectPendingApproval,
    restoreWorkspace,
  } = useIslandContext();

  const isActive = statusLabel === "Working..." || statusLabel === "Pending approval";
  const hasConversation = recentMessages.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "100%" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      className="flex flex-col h-full overflow-hidden"
    >
      {/* Header - Pinned at top */}
      <motion.div
        data-tauri-drag-region={headerDragRegion ? "true" : undefined}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="shrink-0"
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
      </motion.div>

      <div className="border-t border-island-shell-border/50 shrink-0" />

      {/* Main Content Area - Scrollable */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="min-h-0 flex-1 overflow-y-auto island-content-scrollbar"
      >
        <motion.div variants={itemVariants} className="px-4 py-3">
          <div className="mb-3">
            <IslandStatusTimeline
              statusLabel={statusLabel}
              statusStage={statusStage}
              statusCode={statusCode}
              statusMeta={statusMeta}
              stageHistory={stageHistory}
              isBusy={isBusy}
            />
          </div>
          {hasConversation ? (
            <div className="space-y-3">
              {recentMessages.map((message, index) => (
                <IslandTranscriptMessage
                  key={`${message.role}-${message.createdAt}-${index}`}
                  message={message}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-3 gap-2">
              <IslandSeedLogo size={32} isActive={false} />
              <p className="text-[12px] text-foreground/40 text-center">
                Deeting is ready to help. Send a message to get started.
              </p>
            </div>
          )}
        </motion.div>

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

        {errorMessage ? (
          <>
            <div className="border-t border-island-shell-border/50" />
            <motion.div variants={itemVariants} className="px-4 py-2.5 text-[11px] text-amber-700 dark:text-amber-300">
              {errorMessage}
            </motion.div>
          </>
        ) : null}
      </motion.div>

      {/* Footer Area - Pinned at bottom */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="shrink-0"
      >
        <div className="border-t border-island-shell-border/50" />

        <motion.div variants={itemVariants} className="px-4 py-3">
          <IslandQuickReply onSend={sendQuickReply} disabled={isBusy} />
        </motion.div>

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
