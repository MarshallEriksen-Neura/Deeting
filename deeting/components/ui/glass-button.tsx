"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * iOS-style Glass Button
 *
 * 设计理念:
 * - 采用 iOS 的磨砂玻璃质感
 * - 按压时有真实的物理反馈 (scale + 阴影变化)
 * - 柔和的色彩过渡和微妙的边框
 * - 支持多种视觉变体
 */

const glassButtonVariants = cva(
  // Base styles - iOS 风格基础
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-medium",
    "rounded-xl", // iOS 更圆润的圆角
    "transition-all duration-200 ease-out",
    // 按压效果 - iOS 触感反馈
    "active:scale-[0.97] active:brightness-95",
    // 禁用状态
    "disabled:pointer-events-none disabled:opacity-40",
    // SVG 图标
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
    // Focus 样式
    "outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  ],
  {
    variants: {
      variant: {
        // 主要按钮 - 渐变玻璃效果
        default: [
          "bg-gradient-to-b from-[var(--primary)] to-[var(--primary)]/80",
          "text-white",
          "shadow-[0_2px_8px_-2px_rgba(124,109,255,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_rgba(124,109,255,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
        // 次要按钮 - 磨砂玻璃
        secondary: [
          "bg-[var(--surface)]/60 backdrop-blur-xl",
          "text-[var(--foreground)]",
          "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]",
          "hover:bg-[var(--surface)]/80",
          "hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.15)]",
          "border border-[var(--border)]/50",
        ],
        // 幽灵按钮 - 纯透明
        ghost: [
          "bg-transparent",
          "text-[var(--foreground)]",
          "hover:bg-[var(--foreground)]/5",
          "active:bg-[var(--foreground)]/10",
        ],
        // 轮廓按钮 - 边框发光
        outline: [
          "bg-transparent",
          "text-[var(--primary)]",
          "border border-[var(--primary)]/50",
          "hover:bg-[var(--primary)]/10",
          "hover:border-[var(--primary)]",
          "shadow-[0_0_0_0_rgba(124,109,255,0)]",
          "hover:shadow-[0_0_12px_-2px_rgba(124,109,255,0.3)]",
        ],
        // 危险按钮
        destructive: [
          "bg-gradient-to-b from-red-500 to-red-600",
          "text-white",
          "shadow-[0_2px_8px_-2px_rgba(239,68,68,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_rgba(239,68,68,0.5)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
        // 成功按钮 - iOS 绿色
        success: [
          "bg-gradient-to-b from-emerald-500 to-emerald-600",
          "text-white",
          "shadow-[0_2px_8px_-2px_rgba(16,185,129,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_rgba(16,185,129,0.5)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
        // Teal 强调色
        teal: [
          "bg-gradient-to-b from-[var(--teal-accent)] to-[var(--teal-accent)]/80",
          "text-white",
          "shadow-[0_2px_8px_-2px_rgba(33,201,195,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_rgba(33,201,195,0.5)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-lg",
        default: "h-10 px-4",
        lg: "h-12 px-6 text-base rounded-2xl",
        xl: "h-14 px-8 text-lg rounded-2xl",
        icon: "size-10",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-12 rounded-2xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof glassButtonVariants> {
  asChild?: boolean
  loading?: boolean
}

const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    return (
      <Comp
        ref={ref}
        data-slot="glass-button"
        data-variant={variant}
        data-size={size}
        disabled={disabled || loading}
        className={cn(glassButtonVariants({ variant, size, className }))}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="size-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Loading...</span>
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
GlassButton.displayName = "GlassButton"

export { GlassButton, glassButtonVariants }
