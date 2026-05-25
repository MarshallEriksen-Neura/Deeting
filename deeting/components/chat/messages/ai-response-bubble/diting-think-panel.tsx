"use client"

import { memo, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Brain, ChevronDown, AlertTriangle } from "lucide-react"

import type { DitingThinkFrameBlock } from "@/lib/chat/message-protocol"
import { useI18n } from "@/hooks/use-i18n"
import { cn } from "@/lib/utils"

interface DitingThinkPanelProps {
  block: DitingThinkFrameBlock
  contradicted?: boolean
}

type Translator = ReturnType<typeof useI18n>

type Section = {
  key: "intent" | "context" | "plan" | "constraints" | "assumptions"
  items: string[]
  isSingleLine: boolean
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function trimmedList(values: string[] | undefined | null): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed.length === 0) continue
    out.push(trimmed)
  }
  return out
}

function buildSections(block: DitingThinkFrameBlock): Section[] {
  const intent = isNonEmpty(block.intent) ? [block.intent.trim()] : []
  const facts = trimmedList(block.facts)
  const plan = trimmedList(block.verificationTargets)
  const constraints = trimmedList(block.rules)
  const assumptions = trimmedList(block.assumptions)

  return [
    { key: "intent", items: intent, isSingleLine: true },
    { key: "context", items: facts, isSingleLine: false },
    { key: "plan", items: plan, isSingleLine: false },
    { key: "constraints", items: constraints, isSingleLine: false },
    { key: "assumptions", items: assumptions, isSingleLine: false },
  ]
}

function countFilledSections(sections: Section[]): number {
  return sections.reduce((acc, section) => acc + (section.items.length > 0 ? 1 : 0), 0)
}

function SectionRow({
  section,
  t,
}: {
  section: Section
  t: Translator
}) {
  const labelKey = `frame.sections.${section.key}` as const
  const emptyKey = `frame.empty.${section.key}` as const
  const label = t(labelKey)
  const hasItems = section.items.length > 0

  return (
    <div className="flex gap-2.5">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500/70" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[11px] uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
          {label}
        </div>
        {hasItems ? (
          section.isSingleLine ? (
            <p className="mt-0.5 break-words text-[12.5px] leading-[1.55] text-slate-700 dark:text-slate-200">
              {section.items[0]}
            </p>
          ) : (
            <ul className="mt-0.5 space-y-0.5">
              {section.items.map((item, index) => (
                <li
                  key={`${section.key}-${index}`}
                  className="break-words text-[12.5px] leading-[1.55] text-slate-700 dark:text-slate-200 before:mr-1.5 before:text-slate-400 before:content-['—']"
                >
                  {item}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="mt-0.5 text-[11.5px] italic leading-[1.55] text-slate-400 dark:text-slate-500">
            {t(emptyKey)}
          </p>
        )}
      </div>
    </div>
  )
}

export const DitingThinkPanel = memo<DitingThinkPanelProps>(
  function DitingThinkPanel({ block, contradicted = false }) {
    const t = useI18n("chat")
    const [open, setOpen] = useState(false)

    const sections = useMemo(() => buildSections(block), [block])
    const filledCount = useMemo(() => countFilledSections(sections), [sections])

    const summaryLabel = contradicted
      ? t("frame.summaryContradicted")
      : filledCount > 0
        ? t("frame.summaryReady", { count: filledCount })
        : t("frame.summaryEmpty")

    const isInert = filledCount === 0 && !contradicted

    return (
      <div
        className={cn(
          "mb-3 overflow-hidden rounded-lg border text-xs",
          contradicted
            ? "border-amber-300/80 bg-amber-50/70 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-200"
            : "border-slate-200/80 bg-slate-50/80 text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-200",
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t("frame.collapse") : t("frame.expand")}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            "flex w-full items-center justify-between gap-2 px-3 py-2 text-left",
            "transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-900/40",
            contradicted && "hover:bg-amber-100/60 dark:hover:bg-amber-950/40",
          )}
        >
          <span className="flex min-w-0 items-center gap-2 font-semibold uppercase tracking-[0.1em]">
            {contradicted ? (
              <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400" />
            ) : (
              <Brain size={13} className="text-sky-600 dark:text-sky-400" />
            )}
            <span className="truncate">{t("frame.title")}</span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal",
                contradicted
                  ? "bg-amber-200/60 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                  : isInert
                    ? "bg-slate-200/60 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400"
                    : "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
              )}
            >
              {summaryLabel}
            </span>
          </span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="shrink-0 text-slate-400 dark:text-slate-500"
          >
            <ChevronDown size={14} />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="diting-think-panel-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  "space-y-2.5 border-t px-3 pb-3 pt-2.5",
                  contradicted
                    ? "border-amber-300/60 dark:border-amber-800/50"
                    : "border-slate-200/70 dark:border-slate-800/70",
                )}
              >
                {sections.map((section) => (
                  <SectionRow key={section.key} section={section} t={t} />
                ))}
                <p className="pt-1 text-[10.5px] leading-[1.5] text-slate-400 dark:text-slate-500">
                  {t("frame.hint")}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  },
)
