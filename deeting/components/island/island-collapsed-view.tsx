"use client";

import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";

import { IslandSeedLogo } from "./island-seed-logo";
import { useIslandContext } from "./island-context";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 text-island-gold">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block w-1 h-1 rounded-full bg-current"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

export function IslandCollapsedView() {
  const { statusLabel, summaryText, lastReplyAt, isBusy, expand } = useIslandContext();

  const isActive = statusLabel === "Working..." || statusLabel === "Pending approval";

  const locale = useLocale();
  const dateFnsLocale = locale === "zh-CN" ? zhCN : enUS;
  const relativeTime = lastReplyAt
    ? formatDistanceToNow(lastReplyAt, { addSuffix: true, locale: dateFnsLocale })
    : null;

  // Re-render every 30s to keep relative time fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastReplyAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [lastReplyAt]);

  return (
    <motion.div
      onClick={expand}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
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
        <span className="text-[11px] font-medium text-foreground/70">
          {statusLabel}
        </span>
      </div>

      <span className="h-3.5 w-px bg-island-shell-border/50" />

      {isBusy ? (
        <TypingDots />
      ) : (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[12px] font-medium text-foreground/60 truncate max-w-[140px]">
            {summaryText}
          </span>
          {relativeTime && (
            <span className="text-[10px] text-foreground/35 shrink-0 tabular-nums">
              {relativeTime}
            </span>
          )}
        </div>
      )}

      <ChevronDown className="w-3.5 h-3.5 text-island-gold ml-auto shrink-0 transition-transform" />
    </motion.div>
  );
}
