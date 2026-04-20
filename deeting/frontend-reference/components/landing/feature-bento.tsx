"use client"

import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import {
  ShieldCheck,
  Terminal,
  Command,
  Plane,
  Code2,
  BarChart3,
  Languages,
  Sparkles,
  BrainCircuit,
} from "lucide-react"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FeatureBento() {
  const t = useTranslations("home.features")
  const features = [
    {
      title: t("cards.agent.title"),
      titleEn: t("cards.agent.eyebrow"),
      desc: t("cards.agent.desc"),
      icon: BrainCircuit,
      color: "from-blue-500/20 to-cyan-500/20",
      border: "border-blue-500/20",
      iconColor: "text-blue-400",
    },
    {
      title: t("cards.privacy.title"),
      titleEn: t("cards.privacy.eyebrow"),
      desc: t("cards.privacy.desc"),
      icon: ShieldCheck,
      color: "from-emerald-500/20 to-teal-500/20",
      border: "border-emerald-500/20",
      iconColor: "text-emerald-400",
    },
    {
      title: t("cards.system.title"),
      titleEn: t("cards.system.eyebrow"),
      desc: t("cards.system.desc"),
      icon: Command,
      color: "from-purple-500/20 to-pink-500/20",
      border: "border-purple-500/20",
      iconColor: "text-purple-400",
    },
  ]
  const scenarios = [
    { icon: Plane, label: t("scenarios.bookFlights"), color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    { icon: BarChart3, label: t("scenarios.analyzeData"), color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { icon: Code2, label: t("scenarios.writeCode"), color: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
    { icon: Languages, label: t("scenarios.translateDocs"), color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { icon: Terminal, label: t("scenarios.devOps"), color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" },
    { icon: Sparkles, label: t("scenarios.creativeWriting"), color: "text-pink-400 bg-pink-500/10 border-pink-500/20" },
  ]

  return (
    <div id="features" className="container mx-auto px-6 py-24">
      {/* Section header */}
      <div className="text-center mb-16 space-y-4">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60"
        >
          {t("title")}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-muted-foreground max-w-2xl mx-auto"
        >
          {t("description")}
        </motion.p>
      </div>

      {/* Scenario pills */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.15 }}
        className="flex flex-wrap justify-center gap-2.5 mb-16 max-w-3xl mx-auto"
      >
        {scenarios.map((s, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all hover:scale-105",
              s.color
            )}
          >
            <s.icon className="size-4" />
            {s.label}
          </div>
        ))}
      </motion.div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
        {features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className={cn(
              "relative group overflow-hidden rounded-3xl border",
              f.border,
              "bg-card/60 backdrop-blur-xl p-8",
              "hover:bg-accent/50 transition-all duration-500 hover:-translate-y-1"
            )}
          >
            {/* Hover gradient */}
            <div
              className={cn(
                "absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl",
                f.color
              )}
            />

            <div className="relative z-10 flex flex-col h-full items-start">
              <div
                className={cn(
                  "p-3 rounded-2xl bg-accent/50 border border-border mb-6",
                  f.iconColor,
                  "group-hover:scale-110 transition-transform duration-300"
                )}
              >
                <f.icon className="size-6" />
              </div>

              <h3 className="text-xl font-bold text-foreground mb-1">{f.title}</h3>
              <p className="text-xs font-mono text-muted-foreground mb-4 uppercase tracking-wider">
                {f.titleEn}
              </p>

              <p className="text-muted-foreground leading-relaxed group-hover:text-foreground transition-colors">
                {f.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
