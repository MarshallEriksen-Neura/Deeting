"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Workstation Card — 统一卡片封装
 *
 * 基于 globals.css 设计 token，所有页面复用。
 * 保持向后兼容的 props 接口，内部样式全部使用标准 token。
 */

const glassCardVariants = cva(
  [
    "relative overflow-hidden",
    "rounded-[var(--r-14)]",
    "transition-all duration-[var(--dur-medium)] ease-[var(--ease-standard)]",
    "border border-white/10",
    "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)]",
  ],
  {
    variants: {
      blur: {
        none: "backdrop-blur-none bg-[var(--card)]",
        sm: "backdrop-blur-sm bg-[var(--card)]/80",
        default: "backdrop-blur-xl bg-[var(--card)]/60",
        lg: "backdrop-blur-2xl bg-[var(--card)]/50",
        xl: "backdrop-blur-3xl bg-[var(--card)]/40",
      },
      theme: {
        default: [
          "bg-[var(--card)]/60",
          "[--glass-border:color-mix(in_oklch,white_8%,transparent)]",
          "[--glass-shine:color-mix(in_oklch,white_5%,transparent)]",
        ],
        primary: [
          "bg-[var(--accent-soft)]",
          "[--glass-border:color-mix(in_oklch,var(--accent-strong)_20%,transparent)]",
          "[--glass-shine:color-mix(in_oklch,var(--accent-strong)_5%,transparent)]",
        ],
        teal: [
          "bg-[var(--info-soft)]",
          "[--glass-border:color-mix(in_oklch,var(--info)_20%,transparent)]",
          "[--glass-shine:color-mix(in_oklch,var(--info)_5%,transparent)]",
        ],
        surface: [
          "bg-[var(--panel-bg)]/70",
          "[--glass-border:color-mix(in_oklch,white_5%,transparent)]",
          "[--glass-shine:color-mix(in_oklch,white_3%,transparent)]",
        ],
        blueprint: [
          "rounded-none",
          "bg-[var(--card)]",
          "border-[var(--border)]",
          "shadow-none",
          "[--glass-border:transparent]",
          "[--glass-shine:transparent]",
        ],
      },
      hover: {
        none: "",
        lift: "hover:-translate-y-1 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.15)]",
        glow: "hover:shadow-[0_8px_32px_-8px_color-mix(in_oklch,var(--accent-strong)_20%,transparent)]",
        scale: "hover:scale-[1.02]",
      },
      padding: {
        none: "p-0",
        sm: "p-4",
        default: "p-6",
        lg: "p-8",
      },
    },
    defaultVariants: {
      blur: "default",
      theme: "default",
      hover: "lift",
      padding: "default",
    },
  }
)

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {
  shine?: boolean
  innerBorder?: boolean
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, blur, theme, hover, padding, shine = true, innerBorder = true, children, ...props }, ref) => {
    const isBlueprint = theme === "blueprint"

    return (
      <div
        ref={ref}
        data-slot="glass-card"
        data-theme={theme}
        className={cn(glassCardVariants({ blur, theme, hover, padding, className }))}
        {...props}
      >
        {isBlueprint && (
          <>
            <div className="pointer-events-none absolute -top-px -left-px size-3 border-l-2 border-t-2 border-[var(--muted-foreground)] opacity-30" />
            <div className="pointer-events-none absolute -bottom-px -right-px size-3 border-r-2 border-b-2 border-[var(--muted-foreground)] opacity-30" />
          </>
        )}

        {isBlueprint && (
          <div
            className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)`,
              backgroundSize: '24px 24px'
            }}
          />
        )}

        {shine && !isBlueprint && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background: "linear-gradient(90deg, transparent, var(--glass-shine, rgba(255,255,255,0.1)) 50%, transparent)",
            }}
          />
        )}

        {innerBorder && !isBlueprint && (
          <div
            className="pointer-events-none absolute inset-0 rounded-[var(--r-14)]"
            style={{
              boxShadow: "inset 0 0 0 1px var(--glass-border, rgba(255,255,255,0.05))",
            }}
          />
        )}

        {children}
      </div>
    )
  }
)
GlassCard.displayName = "GlassCard"

const GlassCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { blueprint?: boolean }>(
  ({ className, blueprint, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="glass-card-header"
      className={cn(
        "flex flex-col gap-1.5",
        blueprint && "relative z-10 flex-row items-center justify-between border-b border-[var(--border)] px-4 py-3 gap-0",
        className
      )}
      {...props}
    />
  )
)
GlassCardHeader.displayName = "GlassCardHeader"

const GlassCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement> & { blueprint?: boolean }>(
  ({ className, blueprint, ...props }, ref) => (
    <h3
      ref={ref}
      data-slot="glass-card-title"
      className={cn(
        "text-lg font-semibold text-[var(--foreground)]",
        blueprint && "font-mono text-[11px] font-bold uppercase tracking-widest",
        className
      )}
      {...props}
    />
  )
)
GlassCardTitle.displayName = "GlassCardTitle"

const GlassCardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement> & { blueprint?: boolean }>(
  ({ className, blueprint, ...props }, ref) => (
    <p
      ref={ref}
      data-slot="glass-card-description"
      className={cn(
        "text-sm text-[var(--muted)]",
        blueprint && "font-mono text-[9px] text-[var(--muted-foreground)] uppercase",
        className
      )}
      {...props}
    />
  )
)
GlassCardDescription.displayName = "GlassCardDescription"

const GlassCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { blueprint?: boolean }>(
  ({ className, blueprint, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="glass-card-content"
      className={cn(blueprint && "relative z-10 flex-1 p-4", className)}
      {...props}
    />
  )
)
GlassCardContent.displayName = "GlassCardContent"

const GlassCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { blueprint?: boolean }>(
  ({ className, blueprint, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="glass-card-footer"
      className={cn(
        "flex items-center gap-3 pt-4",
        blueprint && "h-1 w-full bg-[var(--border)] opacity-30 pt-0",
        className
      )}
      {...props}
    />
  )
)
GlassCardFooter.displayName = "GlassCardFooter"

interface GlassStatCardProps extends Omit<GlassCardProps, "children"> {
  label: string
  value: string | number
  trend?: {
    value: number
    isPositive: boolean
  }
  icon?: React.ReactNode
}

const GlassStatCard = React.forwardRef<HTMLDivElement, GlassStatCardProps>(
  ({ label, value, trend, icon, className, ...props }, ref) => (
    <GlassCard
      ref={ref}
      className={cn("", className)}
      {...props}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-[var(--muted)]">{label}</span>
          <span className="text-3xl font-bold text-[var(--foreground)]">{value}</span>
          {trend && (
            <span
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                trend.isPositive ? "text-[var(--ok)]" : "text-[var(--danger)]"
              )}
            >
              <svg
                className={cn("size-3", !trend.isPositive && "rotate-180")}
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
              {Math.abs(trend.value)}%
            </span>
          )}
        </div>
        {icon && (
          <div className="flex size-10 items-center justify-center rounded-[var(--r-10)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            {icon}
          </div>
        )}
      </div>
    </GlassCard>
  )
)
GlassStatCard.displayName = "GlassStatCard"

export {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardContent,
  GlassCardFooter,
  GlassStatCard,
  glassCardVariants,
}
