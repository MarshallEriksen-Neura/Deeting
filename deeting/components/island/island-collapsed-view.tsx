"use client";

import { ChevronDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/lib/utils";

import { IslandSeedLogo } from "./island-seed-logo";
import { useIslandStore } from "./island-store";

export function IslandCollapsedView() {
  const { statusLabel, summaryText, expand } = useIslandStore(
    useShallow((state) => ({
      statusLabel: state.statusLabel,
      summaryText: state.summaryText,
      expand: state.expand,
    }))
  );

  const isActive = statusLabel === "Working..." || statusLabel === "Pending approval";

  return (
    <div
      onClick={expand}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
    >
      <IslandSeedLogo size={20} isActive={isActive} />

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

      <span className="h-3.5 w-px bg-[var(--island-shell-border)]/50" />

      <span className="text-[12px] font-medium text-[var(--foreground)]/60 truncate max-w-[180px]">
        {summaryText}
      </span>

      <ChevronDown className="w-3.5 h-3.5 text-[var(--island-gold-stroke)] ml-auto shrink-0 transition-transform" />
    </div>
  );
}
