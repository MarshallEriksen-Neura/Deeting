"use client";

import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Globe } from "lucide-react";
import type { WorldModelSnapshotBlock } from "@/lib/chat/message-protocol";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

interface WorldModelPanelProps {
  block: WorldModelSnapshotBlock;
}

type Section = {
  key: string;
  label: string;
  items: string[];
  emptyLabel: string;
};

function buildSections(block: WorldModelSnapshotBlock, t: (key: string) => string): Section[] {
  return [
    {
      key: "facts",
      label: t("worldModel.sections.facts"),
      items: block.facts,
      emptyLabel: t("worldModel.empty.facts"),
    },
    {
      key: "assumptions",
      label: t("worldModel.sections.assumptions"),
      items: block.assumptions,
      emptyLabel: t("worldModel.empty.assumptions"),
    },
    {
      key: "unknowns",
      label: t("worldModel.sections.unknowns"),
      items: block.unknowns,
      emptyLabel: t("worldModel.empty.unknowns"),
    },
    {
      key: "verificationTargets",
      label: t("worldModel.sections.verificationTargets"),
      items: block.verificationTargets,
      emptyLabel: t("worldModel.empty.verificationTargets"),
    },
    {
      key: "rules",
      label: t("worldModel.sections.rules"),
      items: block.rules,
      emptyLabel: t("worldModel.empty.rules"),
    },
  ];
}

function countFilled(sections: Section[]): number {
  return sections.filter((s) => s.items.length > 0).length;
}

const FRAME_STATUS_COLORS: Record<string, string> = {
  Fresh: "text-emerald-600 dark:text-emerald-400",
  Stale: "text-amber-600 dark:text-amber-400",
  Contradicted: "text-red-600 dark:text-red-400",
  Missing: "text-slate-400 dark:text-slate-500",
  InsufficientForCommit: "text-amber-600 dark:text-amber-400",
  VerifiedEnough: "text-emerald-600 dark:text-emerald-400",
};

export const WorldModelPanel = memo<WorldModelPanelProps>(
  function WorldModelPanel({ block }) {
    const t = useI18n("chat");
    const [open, setOpen] = useState(false);

    const sections = useMemo(() => buildSections(block, t), [block, t]);
    const filled = useMemo(() => countFilled(sections), [sections]);

    const summaryLabel =
      filled > 0
        ? t("worldModel.summaryReady").replace("{facts}", String(block.facts.length)).replace("{assumptions}", String(block.assumptions.length))
        : t("worldModel.summaryEmpty");

    const statusColor = FRAME_STATUS_COLORS[block.frameStatus] ?? "text-slate-500 dark:text-slate-400";
    const strategyLabel = block.executionStrategy
      ? block.executionStrategy.replace(/_/g, " ")
      : null;

    return (
      <div
        className={cn(
          "mb-3 overflow-hidden rounded-lg border text-xs",
          "border-slate-200/80 bg-slate-50/80 text-slate-700",
          "dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-200",
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t("worldModel.collapse") : t("worldModel.expand")}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            "flex w-full items-center justify-between gap-2 px-3 py-2 text-left",
            "transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-900/40",
          )}
        >
          <span className="flex min-w-0 items-center gap-2 font-semibold uppercase tracking-[0.1em]">
            <Globe size={13} className="text-[#6d5cff] dark:text-[var(--accent)]" />
            <span className="truncate">{t("worldModel.title")}</span>
            <span className={cn("text-[10px] font-mono font-normal normal-case tracking-normal", statusColor)}>
              {block.frameStatus}
            </span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 normal-case tracking-normal">
              {summaryLabel}
            </span>
            <ChevronDown
              size={13}
              className={cn(
                "text-slate-400 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </span>
        </button>

        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-200/60 dark:border-slate-800/60 px-3 py-2.5 space-y-3">
              {/* Goal */}
              {block.goal && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 mb-1">
                    {t("worldModel.sections.goal")}
                  </div>
                  <div className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                    {block.goal}
                  </div>
                </div>
              )}

              {/* Sections */}
              {sections.map((section) => (
                <div key={section.key}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 mb-1">
                    {section.label}
                  </div>
                  {section.items.length > 0 ? (
                    <ul className="space-y-0.5">
                      {section.items.map((item, i) => (
                        <li
                          key={i}
                          className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 pl-3 relative before:content-['·'] before:absolute before:left-0 before:text-slate-300 dark:before:text-slate-600"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[11px] text-slate-400 dark:text-slate-600 italic">
                      {section.emptyLabel}
                    </div>
                  )}
                </div>
              ))}

              {/* Execution strategy */}
              {strategyLabel && (
                <div className="flex items-center gap-2 pt-1 border-t border-slate-200/40 dark:border-slate-800/40">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                    {t("worldModel.executionStrategy")}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#6d5cff]/8 text-[#6d5cff] dark:text-[var(--accent)]">
                    {strategyLabel}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    );
  },
);
