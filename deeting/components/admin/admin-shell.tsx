"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export type AdminMetric = {
  label: string
  value: React.ReactNode
  detail?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: "blue" | "emerald" | "amber" | "rose"
}

const toneClasses: Record<NonNullable<AdminMetric["tone"]>, string> = {
  blue: "from-sky-500/18 to-cyan-500/6 text-sky-500",
  emerald: "from-emerald-500/18 to-teal-500/6 text-emerald-500",
  amber: "from-amber-500/20 to-orange-500/6 text-amber-500",
  rose: "from-rose-500/18 to-red-500/6 text-rose-500",
}

export function AdminPageShell({
  title,
  eyebrow,
  description,
  actions,
  children,
}: {
  title: string
  eyebrow: string
  description: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden bg-[var(--window-bg)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_6%,color-mix(in_srgb,var(--accent-soft)_82%,transparent),transparent_30%),radial-gradient(circle_at_88%_18%,color-mix(in_srgb,var(--ink)_9%,transparent),transparent_24%),linear-gradient(180deg,color-mix(in_srgb,var(--window-bg)_84%,white_8%),var(--window-bg))]" />
      <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="relative isolate overflow-hidden rounded-[36px] border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--panel-bg)_88%,transparent)] p-6 shadow-[0_26px_90px_-72px_color-mix(in_srgb,var(--ink)_58%,transparent)] backdrop-blur-xl sm:p-8"
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(125deg,color-mix(in_srgb,var(--accent-soft)_54%,transparent),transparent_36%),radial-gradient(circle_at_84%_20%,rgba(255,255,255,0.22),transparent_26%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-5xl space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--ink-3)]">{eyebrow}</div>
              <h1 className="max-w-5xl text-[clamp(2.6rem,5vw,5.8rem)] font-semibold leading-[0.9] tracking-[-0.075em] text-[var(--ink)]">
                {title}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--ink-2)] sm:text-base">{description}</p>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </motion.section>
        {children}
      </div>
    </main>
  )
}

export function AdminMetricGrid({ metrics }: { metrics: AdminMetric[] }) {
  return (
    <section className="grid grid-flow-dense gap-3 md:grid-cols-4">
      {metrics.map((metric, index) => {
        const Icon = metric.icon
        return (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.045, duration: 0.32 }}
            className="group overflow-hidden rounded-[26px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-5 shadow-[0_18px_56px_-48px_color-mix(in_srgb,var(--ink)_46%,transparent)] transition-transform duration-500 ease-out hover:-translate-y-1"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium text-[var(--ink-3)]">{metric.label}</div>
                <div className="mt-3 text-3xl font-semibold tracking-[-0.055em] text-[var(--ink)]">{metric.value}</div>
              </div>
              <div className={cn("flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br", toneClasses[metric.tone ?? "blue"])}>
                <Icon className="size-5 transition-transform duration-700 ease-out group-hover:scale-110" />
              </div>
            </div>
            {metric.detail ? <div className="mt-4 text-xs leading-5 text-[var(--ink-3)]">{metric.detail}</div> : null}
          </motion.div>
        )
      })}
    </section>
  )
}

export function AdminPanel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
      className={cn("overflow-hidden rounded-[30px] border border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[0_22px_70px_-58px_color-mix(in_srgb,var(--ink)_52%,transparent)]", className)}
    >
      {children}
    </motion.section>
  )
}

export function AdminStatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        active
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300"
      )}
    >
      {label}
    </span>
  )
}
