"use client"

import { useEffect, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useTranslations } from "next-intl"
import {
  Plane,
  Search,
  BarChart3,
  CheckCircle2,
  FileText,
  Brain,
  Zap,
  TrendingUp,
} from "lucide-react"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  Scenario definitions                                               */
/* ------------------------------------------------------------------ */

interface Step {
  icon: React.ReactNode
  text: string
}

interface Scenario {
  id: string
  userInput: string
  steps: Step[]
  result: React.ReactNode
}

/* ---------- result cards ---------- */

function TicketCard() {
  const t = useTranslations("home.demo.cards.ticket")

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-950/80 to-indigo-950/80 backdrop-blur-xl p-5 shadow-2xl">
      {/* airline header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
            <Plane className="size-4 text-blue-400 -rotate-45" />
          </div>
          <span className="text-sm font-semibold text-white">{t("airline")}</span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-400 font-medium">
          {t("badge")}
        </span>
      </div>

      {/* route */}
      <div className="flex items-center gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-white tracking-wide">{t("origin.code")}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t("origin.city")}</div>
          <div className="text-xs text-gray-300 font-medium mt-1">{t("origin.time")}</div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="text-[10px] text-gray-500">{t("duration")}</div>
          <div className="w-full flex items-center gap-1">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-blue-400/50" />
            <Plane className="size-3 text-blue-400 -rotate-0" />
            <div className="h-px flex-1 bg-gradient-to-r from-blue-400/50 to-transparent" />
          </div>
          <div className="text-[10px] text-gray-500">{t("flightNo")}</div>
        </div>

        <div className="text-center">
          <div className="text-2xl font-bold text-white tracking-wide">{t("destination.code")}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t("destination.city")}</div>
          <div className="text-xs text-gray-300 font-medium mt-1">{t("destination.time")}</div>
        </div>
      </div>

      {/* bottom row */}
      <div className="flex items-end justify-between pt-3 border-t border-white/5">
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t("dateLabel")}</div>
          <div className="text-xs text-gray-300 font-medium">{t("date")}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t("classLabel")}</div>
          <div className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
            {t("price")}
          </div>
        </div>
      </div>
    </div>
  )
}

function AnalyticsCard() {
  const t = useTranslations("home.demo.cards.analytics")

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-950/80 to-teal-950/80 backdrop-blur-xl p-5 shadow-2xl">
      <div className="flex items-center gap-2 mb-4">
        <div className="size-8 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
          <BarChart3 className="size-4 text-emerald-400" />
        </div>
        <span className="text-sm font-semibold text-white">{t("title")}</span>
      </div>

      {/* metrics grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <MetricItem label={t("metrics.revenue")} value="¥2.4M" change="+12%" positive />
        <MetricItem label={t("metrics.orders")} value="8,432" change="+8%" positive />
        <MetricItem label={t("metrics.aov")} value="¥285" change="+3%" positive />
        <MetricItem label={t("metrics.refund")} value="1.2%" change="-0.3%" positive />
      </div>

      {/* mini chart */}
      <div className="h-12 flex items-end gap-1 px-1">
        {[35, 42, 38, 55, 48, 62, 58, 71, 65, 78, 82, 90].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-gradient-to-t from-emerald-500/60 to-emerald-400/40 transition-all"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function MetricItem({
  label,
  value,
  change,
  positive,
}: {
  label: string
  value: string
  change: string
  positive: boolean
}) {
  return (
    <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold text-white mt-0.5">{value}</div>
      <div
        className={cn(
          "text-[10px] font-medium mt-0.5 flex items-center gap-0.5",
          positive ? "text-emerald-400" : "text-red-400"
        )}
      >
        <TrendingUp className="size-2.5" />
        {change}
      </div>
    </div>
  )
}

function CodeCard() {
  const t = useTranslations("home.demo.cards.code")
  const lines = [
    { indent: 0, tokens: [{ text: "export function", cls: "text-purple-400" }, { text: " LoginForm", cls: "text-blue-300" }, { text: "() {", cls: "text-gray-400" }] },
    { indent: 1, tokens: [{ text: "const", cls: "text-purple-400" }, { text: " [email, setEmail] = ", cls: "text-gray-300" }, { text: "useState", cls: "text-yellow-300" }, { text: "('')", cls: "text-emerald-400" }] },
    { indent: 1, tokens: [{ text: "const", cls: "text-purple-400" }, { text: " [pass, setPass] = ", cls: "text-gray-300" }, { text: "useState", cls: "text-yellow-300" }, { text: "('')", cls: "text-emerald-400" }] },
    { indent: 0, tokens: [] },
    { indent: 1, tokens: [{ text: "return", cls: "text-purple-400" }, { text: " (", cls: "text-gray-400" }] },
    { indent: 2, tokens: [{ text: "<form", cls: "text-blue-300" }, { text: " onSubmit={handleLogin}", cls: "text-gray-300" }, { text: ">", cls: "text-blue-300" }] },
    { indent: 3, tokens: [{ text: "<Input", cls: "text-blue-300" }, { text: " type=", cls: "text-gray-400" }, { text: '"email"', cls: "text-emerald-400" }, { text: " value={email}", cls: "text-gray-300" }, { text: " />", cls: "text-blue-300" }] },
    { indent: 3, tokens: [{ text: "<Input", cls: "text-blue-300" }, { text: " type=", cls: "text-gray-400" }, { text: '"password"', cls: "text-emerald-400" }, { text: " value={pass}", cls: "text-gray-300" }, { text: " />", cls: "text-blue-300" }] },
    { indent: 3, tokens: [{ text: "<Button", cls: "text-blue-300" }, { text: " type=", cls: "text-gray-400" }, { text: '"submit"', cls: "text-emerald-400" }, { text: ">Login</", cls: "text-gray-300" }, { text: "Button>", cls: "text-blue-300" }] },
    { indent: 2, tokens: [{ text: "</form>", cls: "text-blue-300" }] },
    { indent: 1, tokens: [{ text: ")", cls: "text-gray-400" }] },
    { indent: 0, tokens: [{ text: "}", cls: "text-gray-400" }] },
  ]

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-violet-950/80 to-purple-950/80 backdrop-blur-xl shadow-2xl overflow-hidden">
      {/* editor header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <div className="flex gap-1.5">
          <div className="size-2.5 rounded-full bg-red-500/70" />
          <div className="size-2.5 rounded-full bg-yellow-500/70" />
          <div className="size-2.5 rounded-full bg-green-500/70" />
        </div>
        <span className="text-[10px] text-gray-500 font-mono ml-2">{t("windowTitle")}</span>
      </div>

      {/* code body */}
      <div className="p-4 font-mono text-[11px] leading-5 overflow-hidden">
        {lines.map((line, i) => (
          <div key={i} className="flex" style={{ paddingLeft: `${line.indent * 16}px` }}>
            <span className="text-gray-600 w-5 text-right mr-3 select-none text-[10px]">{i + 1}</span>
            {line.tokens.map((tok, j) => (
              <span key={j} className={tok.cls}>{tok.text}</span>
            ))}
            {line.tokens.length === 0 && <span>&nbsp;</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Typewriter hook                                                    */
/* ------------------------------------------------------------------ */

function useTypewriter(text: string, speed = 60, trigger = true) {
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    if (!trigger) {
      setDisplayed("")
      return
    }
    setDisplayed("")
    let i = 0
    const id = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) clearInterval(id)
    }, speed)
    return () => clearInterval(id)
  }, [text, speed, trigger])

  return displayed
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

const SCENE_DURATION = 9000 // ms per scenario
const TYPING_DELAY = 400
const STEP_INTERVAL = 800
const RESULT_DELAY = 600

export function HeroDemo() {
  const t = useTranslations("home.demo")
  const [activeIdx, setActiveIdx] = useState(0)
  const [phase, setPhase] = useState<"typing" | "steps" | "result">("typing")
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [cycleKey, setCycleKey] = useState(0)
  const scenarios: Scenario[] = [
    {
      id: "flight",
      userInput: t("scenarios.flight.userInput"),
      steps: [
        { icon: <Search className="size-3.5" />, text: t("scenarios.flight.steps.search") },
        { icon: <BarChart3 className="size-3.5" />, text: t("scenarios.flight.steps.compare") },
        { icon: <CheckCircle2 className="size-3.5" />, text: t("scenarios.flight.steps.done") },
      ],
      result: <TicketCard />,
    },
    {
      id: "analytics",
      userInput: t("scenarios.analytics.userInput"),
      steps: [
        { icon: <FileText className="size-3.5" />, text: t("scenarios.analytics.steps.read") },
        { icon: <BarChart3 className="size-3.5" />, text: t("scenarios.analytics.steps.report") },
        { icon: <CheckCircle2 className="size-3.5" />, text: t("scenarios.analytics.steps.done") },
      ],
      result: <AnalyticsCard />,
    },
    {
      id: "code",
      userInput: t("scenarios.code.userInput"),
      steps: [
        { icon: <Brain className="size-3.5" />, text: t("scenarios.code.steps.analyze") },
        { icon: <Zap className="size-3.5" />, text: t("scenarios.code.steps.generate") },
        { icon: <CheckCircle2 className="size-3.5" />, text: t("scenarios.code.steps.done") },
      ],
      result: <CodeCard />,
    },
  ]

  const scenario = scenarios[activeIdx]
  const typed = useTypewriter(scenario.userInput, 60, phase === "typing" || phase === "steps" || phase === "result")

  // Phase machine
  useEffect(() => {
    setPhase("typing")
    setVisibleSteps(0)
    setCycleKey((k) => k + 1)

    const typingDone = TYPING_DELAY + scenario.userInput.length * 60 + 300

    const t1 = setTimeout(() => setPhase("steps"), typingDone)

    // reveal steps one by one
    const stepTimers: ReturnType<typeof setTimeout>[] = []
    scenario.steps.forEach((_, i) => {
      stepTimers.push(
        setTimeout(() => setVisibleSteps(i + 1), typingDone + (i + 1) * STEP_INTERVAL)
      )
    })

    const allStepsDone = typingDone + scenario.steps.length * STEP_INTERVAL + RESULT_DELAY
    const t2 = setTimeout(() => setPhase("result"), allStepsDone)

    // move to next scenario
    const t3 = setTimeout(() => {
      setActiveIdx((prev) => (prev + 1) % scenarios.length)
    }, SCENE_DURATION)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      stepTimers.forEach(clearTimeout)
    }
  }, [activeIdx, scenario.steps.length, scenario.userInput])

  const handleDotClick = useCallback((idx: number) => {
    setActiveIdx(idx)
  }, [])

  return (
    <div className="w-full max-w-md mx-auto lg:mx-0">
      {/* Chat window shell */}
      <div className="rounded-2xl border border-white/10 bg-[#0A0A0F]/80 backdrop-blur-2xl shadow-2xl overflow-hidden ring-1 ring-white/5">
        {/* Window bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <div className="flex gap-1.5">
            <div className="size-2.5 rounded-full bg-red-500/70" />
            <div className="size-2.5 rounded-full bg-yellow-500/70" />
            <div className="size-2.5 rounded-full bg-green-500/70" />
          </div>
          <span className="text-[10px] text-gray-500 font-mono">{t("windowTitle")}</span>
          <div className="w-12" />
        </div>

        {/* Chat area */}
        <div className="p-5 min-h-[420px] flex flex-col" key={cycleKey}>
          <AnimatePresence mode="wait">
            <motion.div
              key={scenario.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-4 flex-1"
            >
              {/* User message */}
              <div className="flex justify-end">
                <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tr-md bg-blue-600/90 text-white text-sm shadow-lg shadow-blue-500/10">
                  {typed}
                  {phase === "typing" && typed.length < scenario.userInput.length && (
                    <span className="inline-block w-0.5 h-4 bg-white/80 ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>

              {/* Agent steps */}
              {(phase === "steps" || phase === "result") && (
                <div className="flex gap-3">
                  <div className="size-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold shadow-lg shadow-blue-500/20 shrink-0 mt-0.5">
                    AI
                  </div>
                  <div className="flex-1 space-y-2">
                    {scenario.steps.map((step, i) => (
                      i < visibleSteps && (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.25 }}
                          className={cn(
                            "flex items-center gap-2 text-sm",
                            i === visibleSteps - 1 && phase === "steps"
                              ? "text-gray-200"
                              : "text-gray-500"
                          )}
                        >
                          <span
                            className={cn(
                              i < visibleSteps - 1 || phase === "result"
                                ? "text-emerald-400"
                                : "text-blue-400 animate-pulse"
                            )}
                          >
                            {i < visibleSteps - 1 || phase === "result" ? (
                              <CheckCircle2 className="size-3.5" />
                            ) : (
                              step.icon
                            )}
                          </span>
                          {step.text}
                        </motion.div>
                      )
                    ))}

                    {/* Result card */}
                    {phase === "result" && (
                      <motion.div
                        initial={{ opacity: 0, y: 12, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className="mt-3"
                      >
                        {scenario.result}
                      </motion.div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Scenario dots */}
        <div className="flex items-center justify-center gap-2 py-3 border-t border-white/5 bg-white/[0.01]">
          {scenarios.map((s, i) => (
            <button
              key={s.id}
              onClick={() => handleDotClick(i)}
              className={cn(
                "transition-all duration-300 rounded-full",
                i === activeIdx
                  ? "w-6 h-2 bg-blue-500"
                  : "size-2 bg-gray-600 hover:bg-gray-500"
              )}
              aria-label={t("sceneAriaLabel", { index: i + 1 })}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
