"use client"

import { motion } from "framer-motion"
import { Code2, Lightbulb, ListChecks, Mail, Sparkles } from "lucide-react"
import type { ComponentType } from "react"
import { useI18n } from "@/hooks/use-i18n"
import { cn } from "@/lib/utils"

const SUGGESTION_KEYS = ["draftEmail", "explainConcept", "analyzeCode", "workPlan"] as const
const SUGGESTION_ICONS = {
  draftEmail: Mail,
  explainConcept: Lightbulb,
  analyzeCode: Code2,
  workPlan: ListChecks,
} satisfies Record<(typeof SUGGESTION_KEYS)[number], ComponentType<{ className?: string }>>

interface ChatWelcomeProps {
  onSuggestion?: (text: string) => void
}

/** 标题区域 — 独立导出，供 split-view 放在 controls 上方 */
export function ChatWelcomeHeading() {
  const t = useI18n("chat")
  return (
    <motion.div
      className="flex flex-col items-center gap-3 text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        className="flex items-center justify-center gap-3.5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.48, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
      >
        <Sparkles className="h-9 w-9 shrink-0 fill-[#6d58d2] text-[#6d58d2] drop-shadow-[0_10px_18px_rgba(100,82,205,0.12)]" strokeWidth={1.45} />
        <h2 className="bg-[linear-gradient(92deg,#5f84e2_0%,#6377db_48%,#6c58cb_100%)] bg-clip-text text-[30px] font-semibold leading-[1.12] text-transparent md:text-[36px]">
          {t("controls.welcomeHeading")}
        </h2>
      </motion.div>
      <motion.p
        className="text-[15px] font-medium leading-5 text-slate-500/80"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
      >
        {t("controls.welcomeSubtitle")}
      </motion.p>
    </motion.div>
  )
}

/** 建议卡片区域 — 保持绝对定位吸附底部 */
export function ChatWelcome({ onSuggestion }: ChatWelcomeProps) {
  const t = useI18n("chat")

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <div className="absolute bottom-[13.5%] left-1/2 z-10 flex w-full max-w-[980px] -translate-x-1/2 flex-col items-center gap-3 px-4 md:bottom-[14%]">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-700">
          <Sparkles className="h-3.5 w-3.5 fill-[#6d58d2] text-[#6d58d2]" strokeWidth={1.6} />
          <span>{t("controls.welcomeTryTitle")}</span>
          <Sparkles className="h-3 w-3 fill-[#6d58d2] text-[#6d58d2]" strokeWidth={1.6} />
        </div>

        <div className="pointer-events-auto grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SUGGESTION_KEYS.map((key) => {
            const Icon = SUGGESTION_ICONS[key]
            const title = t(`controls.welcomeSuggestions.${key}.title`)
            const description = t(`controls.welcomeSuggestions.${key}.description`)
            const prompt = t(`controls.welcomeSuggestions.${key}.prompt`)
            return (
              <motion.button
                key={key}
                type="button"
                onClick={() => onSuggestion?.(prompt)}
                className={cn(
                  "group flex min-h-[76px] items-center gap-3 rounded-[16px] border border-white/70 bg-white/68 px-3.5 text-left",
                  "shadow-[0_14px_36px_-34px_rgba(82,90,136,0.42)] backdrop-blur-2xl transition-all duration-200",
                  "hover:-translate-y-0.5 hover:bg-white/88 hover:shadow-[0_16px_40px_-34px_rgba(82,90,136,0.5)] active:translate-y-0",
                  "dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.09]",
                )}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, delay: 0.16 + SUGGESTION_KEYS.indexOf(key) * 0.04, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[15px] bg-[linear-gradient(145deg,rgba(124,88,226,0.09),rgba(88,154,236,0.08))] text-[#6c5fc9] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] group-hover:text-[#604fc0]">
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold leading-5 text-slate-800 dark:text-white/90">
                    {title}
                  </span>
                  <span className="mt-1 block truncate text-[13px] font-medium leading-4 text-slate-500 dark:text-white/45">
                    {description}
                  </span>
                </span>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
