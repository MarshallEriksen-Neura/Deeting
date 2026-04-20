"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * iOS-style Glass Card
 *
 * 设计理念:
 * - iOS 磨砂玻璃效果 (Frosted Glass / Glassmorphism)
 * - 多层次的光影效果
 * - 微妙的边框和内阴影
 * - 悬停时的浮动效果
 * - 支持不同模糊强度和颜色主题
 */

const glassCardVariants = cva(
  // Base styles - iOS 磨砂玻璃基础
  [
    "relative overflow-hidden",
    "rounded-2xl", // iOS 风格圆角
    "transition-all duration-300 ease-out",
    // 边框 - 模拟光线折射
    "border border-white/10",
    // 基础阴影
    "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)]",
  ],
  {
    variants: {
      // 模糊强度
      blur: {
        none: "backdrop-blur-none bg-[var(--card)]",
        sm: "backdrop-blur-sm bg-[var(--card)]/80",
        default: "backdrop-blur-xl bg-[var(--card)]/60",
        lg: "backdrop-blur-2xl bg-[var(--card)]/50",
        xl: "backdrop-blur-3xl bg-[var(--card)]/40",
      },
      // 颜色主题
      theme: {
        default: [
          "bg-[var(--card)]/60",
          "[--glass-border:rgba(255,255,255,0.08)]",
          "[--glass-shine:rgba(255,255,255,0.05)]",
        ],
        primary: [
          "bg-[var(--primary)]/10",
          "[--glass-border:rgba(124,109,255,0.2)]",
          "[--glass-shine:rgba(124,109,255,0.05)]",
        ],
        teal: [
          "bg-[var(--teal-accent)]/10",
          "[--glass-border:rgba(33,201,195,0.2)]",
          "[--glass-shine:rgba(33,201,195,0.05)]",
        ],
        surface: [
          "bg-[var(--surface)]/70",
          "[--glass-border:rgba(255,255,255,0.05)]",
          "[--glass-shine:rgba(255,255,255,0.03)]",
        ],
      },
      // 悬停效果
      hover: {
        none: "",
        lift: "hover:-translate-y-1 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.15)]",
        glow: "hover:shadow-[0_8px_32px_-8px_rgba(124,109,255,0.2)]",
        scale: "hover:scale-[1.02]",
      },
      // 内边距
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
  /** 是否显示顶部高光效果 */
  shine?: boolean
  /** 是否显示内边框 */
  innerBorder?: boolean
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, blur, theme, hover, padding, shine = true, innerBorder = true, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="glass-card"
        className={cn(glassCardVariants({ blur, theme, hover, padding, className }))}
        {...props}
      >
        {/* 顶部高光 - 模拟光线效果 */}
        {shine && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background: "linear-gradient(90deg, transparent, var(--glass-shine, rgba(255,255,255,0.1)) 50%, transparent)",
            }}
          />
        )}

        {/* 内边框 - 增加层次感 */}
        {innerBorder && (
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              boxShadow: "inset 0 0 0 1px var(--glass-border, rgba(255,255,255,0.05))",
            }}
          />
        )}

        {/* 内容 */}
        {children}
      </div>
    )
  }
)
GlassCard.displayName = "GlassCard"

// GlassCard 子组件
const GlassCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="glass-card-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
)
GlassCardHeader.displayName = "GlassCardHeader"

const GlassCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      data-slot="glass-card-title"
      className={cn("text-lg font-semibold text-[var(--foreground)]", className)}
      {...props}
    />
  )
)
GlassCardTitle.displayName = "GlassCardTitle"

const GlassCardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      data-slot="glass-card-description"
      className={cn("text-sm text-[var(--muted)]", className)}
      {...props}
    />
  )
)
GlassCardDescription.displayName = "GlassCardDescription"

const GlassCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="glass-card-content"
      className={cn("", className)}
      {...props}
    />
  )
)
GlassCardContent.displayName = "GlassCardContent"

const GlassCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="glass-card-footer"
      className={cn("flex items-center gap-3 pt-4", className)}
      {...props}
    />
  )
)
GlassCardFooter.displayName = "GlassCardFooter"

// 统计卡片变体 - 用于 Dashboard
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
                trend.isPositive ? "text-emerald-400" : "text-red-400"
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
          <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)]">
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
