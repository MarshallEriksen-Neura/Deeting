import * as React from "react"
import { cn } from "@/lib/utils"
import { type LucideIcon } from "lucide-react"
import {
  GlassCard,
} from "@/components/ui/glass-card"

export interface StatCardData {
  label: string
  value: string | number
  icon?: LucideIcon
  trend?: { value: number; isPositive: boolean }
  subtitle?: string
  color?: "default" | "primary" | "teal" | "emerald" | "amber" | "rose"
}

const colorMap = {
  default: "text-[var(--foreground)]",
  primary: "text-[var(--primary)]",
  teal: "text-teal-400",
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  rose: "text-rose-400",
}

const iconBgMap = {
  default: "bg-white/5",
  primary: "bg-[var(--primary)]/10",
  teal: "bg-teal-500/10",
  emerald: "bg-emerald-500/10",
  amber: "bg-amber-500/10",
  rose: "bg-rose-500/10",
}

export function AdminStatCards({
  stats,
  columns = 4,
  className,
}: {
  stats: StatCardData[]
  columns?: 2 | 3 | 4 | 5
  className?: string
}) {
  const gridCols = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-2 lg:grid-cols-4",
    5: "md:grid-cols-3 lg:grid-cols-5",
  }

  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {stats.map((stat, i) => (
        <GlassCard key={i} padding="default" hover="lift">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {stat.label}
              </span>
              <span
                className={cn(
                  "text-2xl font-bold",
                  colorMap[stat.color ?? "default"]
                )}
              >
                {stat.value}
              </span>
              {stat.trend && (
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs font-medium",
                    stat.trend.isPositive
                      ? "text-emerald-400"
                      : "text-rose-400"
                  )}
                >
                  <svg
                    className={cn(
                      "size-3",
                      !stat.trend.isPositive && "rotate-180"
                    )}
                    viewBox="0 0 12 12"
                    fill="none"
                  >
                    <path
                      d="M6 2.5v7M6 2.5L3 5.5M6 2.5l3 3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {Math.abs(stat.trend.value)}%
                </span>
              )}
              {stat.subtitle && (
                <span className="text-xs text-[var(--muted)]">
                  {stat.subtitle}
                </span>
              )}
            </div>
            {stat.icon && (
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-xl",
                  iconBgMap[stat.color ?? "default"]
                )}
              >
                <stat.icon
                  className={cn("size-5", colorMap[stat.color ?? "primary"])}
                />
              </div>
            )}
          </div>
        </GlassCard>
      ))}
    </div>
  )
}
