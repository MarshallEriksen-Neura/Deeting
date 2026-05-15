"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { GlassButton } from "@/ui/common/glass-button";
import { useI18n } from "@/hooks/use-i18n";
import { humanizeToolName } from "@/lib/chat/tool-ux";
import { cn } from "@/lib/utils";

interface IslandApprovalCardProps {
  title: string;
  desc: string;
  onApprove?: () => void;
  onReject?: () => void;
  disabled?: boolean;
}

export function IslandApprovalCard({
  title,
  desc,
  onApprove,
  onReject,
  disabled = false,
}: IslandApprovalCardProps) {
  const [feedback, setFeedback] = useState<"approved" | "rejected" | null>(
    null,
  );
  const t = useI18n("island");
  const displayTitle = humanizeToolName(title) ?? title;

  const handleApprove = () => {
    setFeedback("approved");
    onApprove?.();
  };
  const handleReject = () => {
    setFeedback("rejected");
    onReject?.();
  };

  return (
    <div
      className={cn(
        "rounded-[24px] p-3.5",
        "border border-white/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(244,239,233,0.66))]",
        "shadow-[0_18px_40px_-30px_rgba(0,0,0,0.34)]",
        "dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(54,44,30,0.92),rgba(24,21,18,0.96))]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-island-gold/80">
            <span>{t("approvalTitle")}</span>
          </div>
          <p className="truncate text-[13px] font-semibold text-foreground">
            {displayTitle}
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-foreground/56">
            {desc}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <GlassButton
            size="sm"
            variant="ghost"
            onClick={handleReject}
            disabled={disabled}
            className="h-auto rounded-full border-white/30 bg-white/34 px-3 py-1.5 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
          >
            {t("approvalActions.reject")}
          </GlassButton>
          <GlassButton
            size="sm"
            onClick={handleApprove}
            disabled={disabled}
            className="h-auto rounded-full bg-island-gold/18 px-3 py-1.5 text-[11px] text-foreground shadow-[0_10px_22px_-18px_rgba(0,0,0,0.3)]"
          >
            {t("approvalActions.approve")}
          </GlassButton>
        </div>
      </div>
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center mt-2"
          >
            {feedback === "approved" ? (
              <Check className="w-4 h-4 text-emerald-500" />
            ) : (
              <X className="w-4 h-4 text-red-400" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


