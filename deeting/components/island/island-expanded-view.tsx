"use client";

import { ChevronUp, Maximize2 } from "lucide-react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/lib/utils";

import { IslandApprovalCard } from "./island-approval-card";
import { IslandQuickReply } from "./island-quick-reply";
import { IslandSeedLogo } from "./island-seed-logo";
import { useIslandStore } from "./island-store";

export function IslandExpandedView() {
  const {
    statusLabel,
    lastReplyText,
    pendingApproval,
    isBusy,
    errorMessage,
    collapse,
    sendQuickReply,
    approvePendingApproval,
    rejectPendingApproval,
    restoreWorkspace,
  } = useIslandStore(
    useShallow((state) => ({
      statusLabel: state.statusLabel,
      lastReplyText: state.lastReplyText,
      pendingApproval: state.pendingApproval,
      isBusy: state.isBusy,
      errorMessage: state.errorMessage,
      collapse: state.collapse,
      sendQuickReply: state.sendQuickReply,
      approvePendingApproval: state.approvePendingApproval,
      rejectPendingApproval: state.rejectPendingApproval,
      restoreWorkspace: state.restoreWorkspace,
    }))
  );

  const isActive = statusLabel === "Working..." || statusLabel === "Pending approval";

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      className="overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-2.5">
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
            <span className="text-[11px] font-medium text-[var(--foreground)]/70">
              {statusLabel}
            </span>
          </div>
        </div>
        <button
          onClick={collapse}
          className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-[var(--island-gold-stroke)]/10 transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5 text-[var(--island-gold-stroke)]" />
        </button>
      </div>

      <div className="border-t border-[var(--island-shell-border)]/50" />

      <div className="px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[var(--foreground)]/40 mb-1.5">
          Latest reply
        </p>
        <p className="text-[13px] leading-relaxed text-[var(--foreground)]/80 line-clamp-3">
          {lastReplyText}
        </p>
      </div>

      {pendingApproval ? (
        <>
          <div className="border-t border-[var(--island-shell-border)]/50" />
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[var(--foreground)]/40 mb-1.5">
              Approval required
            </p>
            <IslandApprovalCard
              title={pendingApproval.title}
              desc={pendingApproval.desc}
              onApprove={approvePendingApproval}
              onReject={rejectPendingApproval}
              disabled={isBusy}
            />
          </div>
        </>
      ) : null}

      <div className="border-t border-[var(--island-shell-border)]/50" />

      <div className="px-4 py-3">
        <IslandQuickReply onSend={sendQuickReply} disabled={isBusy} />
      </div>

      {errorMessage ? (
        <>
          <div className="border-t border-[var(--island-shell-border)]/50" />
          <div className="px-4 py-2.5 text-[11px] text-amber-700 dark:text-amber-300">
            {errorMessage}
          </div>
        </>
      ) : null}

      <div className="border-t border-[var(--island-shell-border)]/50" />

      <button
        onClick={restoreWorkspace}
        className="flex items-center justify-center gap-1.5 w-full px-4 py-2 text-[11px] font-medium text-[var(--island-gold-stroke)] hover:bg-[var(--island-gold-stroke)]/8 transition-colors"
      >
        <Maximize2 className="w-3 h-3" />
        Return to workspace
      </button>
    </motion.div>
  );
}
