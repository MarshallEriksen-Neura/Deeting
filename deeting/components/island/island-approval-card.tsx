"use client";

import { GlassButton } from "@/components/ui/glass-button";
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
  return (
    <div
      className={cn(
        "rounded-xl p-3",
        "bg-white/50 dark:bg-white/5",
        "border border-[var(--island-shell-border)]/40",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-[var(--foreground)] truncate">
            {title}
          </p>
          <p className="text-[11px] text-[var(--foreground)]/50 mt-0.5 line-clamp-1">
            {desc}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <GlassButton
            size="sm"
            variant="ghost"
            onClick={onReject}
            disabled={disabled}
            className="text-[11px] px-2.5 py-1 h-auto rounded-lg"
          >
            Reject
          </GlassButton>
          <GlassButton
            size="sm"
            onClick={onApprove}
            disabled={disabled}
            className="text-[11px] px-2.5 py-1 h-auto rounded-lg"
          >
            Approve
          </GlassButton>
        </div>
      </div>
    </div>
  );
}
