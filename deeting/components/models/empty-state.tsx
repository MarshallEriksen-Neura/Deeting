"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { RefreshCw, Satellite, Signal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { GlassButton } from "@/components/ui/common/glass-button";

interface ModelEmptyStateProps {
  onSync: () => void;
  isSyncing?: boolean;
  providerName?: string;
  className?: string;
  onQuickAdd?: () => void;
}

function RadarAnimation() {
  return (
    <div className="relative size-32">
      {[1, 2, 3].map((ring) => (
        <motion.div
          key={ring}
          className="absolute inset-0 rounded-full border border-[var(--primary)]/20"
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: [0, 0.5, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, delay: ring * 0.5, ease: "easeOut" }}
        />
      ))}
      <div className="absolute inset-0 rounded-full border border-[var(--primary)]/10" />
      <div className="absolute inset-4 rounded-full border border-[var(--primary)]/10" />
      <div className="absolute inset-8 rounded-full border border-[var(--primary)]/10" />
      <motion.div className="absolute inset-0" animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
        <div className="absolute left-1/2 top-1/2 h-0.5 w-1/2 origin-left" style={{ background: "linear-gradient(90deg, var(--primary), transparent)" }} />
      </motion.div>
      <motion.div
        className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)]"
        animate={{ boxShadow: ["0 0 0 0 rgba(124,109,255,0.4)", "0 0 0 8px rgba(124,109,255,0)"] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
    </div>
  );
}

function ScanningAnimation() {
  return (
    <div className="relative flex size-32 items-center justify-center">
      {[1, 2, 3].map((ring) => (
        <motion.div
          key={ring}
          className="absolute rounded-full border-2 border-[var(--primary)]"
          style={{ width: `${30 + ring * 20}%`, height: `${30 + ring * 20}%` }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: ring * 0.2 }}
        />
      ))}
      <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 2, repeat: Infinity }} className="text-[var(--primary)]">
        <Satellite className="size-10" />
      </motion.div>
      <motion.div className="absolute -right-2 top-1/2 -translate-y-1/2" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }}>
        <Signal className="size-6 text-[var(--primary)]" />
      </motion.div>
    </div>
  );
}

export function ModelEmptyState({
  onSync,
  isSyncing = false,
  providerName = "this provider",
  className,
  onQuickAdd,
}: ModelEmptyStateProps) {
  const t = useTranslations("models");

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={cn("flex flex-col items-center justify-center px-8 py-16 text-center", className)}>
      <div className="mb-8">{isSyncing ? <ScanningAnimation /> : <RadarAnimation />}</div>
      <h3 className="mb-2 text-xl font-semibold text-[var(--foreground)]">
        {isSyncing ? t("list.empty.scanningTitle") : t("list.empty.title")}
      </h3>
      <p className="mb-6 max-w-[320px] text-sm text-[var(--muted)]">
        {isSyncing ? t("list.empty.scanningDescription", { provider: providerName }) : t("list.empty.description", { provider: providerName })}
      </p>
      {!isSyncing && onQuickAdd ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <GlassButton onClick={onQuickAdd} variant="secondary" size="lg" className="gap-2">
            <Signal className="size-5" />
            {t("quickAdd.cta")}
          </GlassButton>
          <GlassButton onClick={onSync} variant="default" size="lg" className="gap-2">
            <RefreshCw className="size-5" />
            {t("list.empty.button")}
          </GlassButton>
        </div>
      ) : null}
      {isSyncing ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-[var(--primary)]">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
            <RefreshCw className="size-4" />
          </motion.div>
          {t("list.empty.progress")}
        </div>
      ) : null}
    </motion.div>
  );
}
