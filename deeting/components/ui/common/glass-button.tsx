"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Workstation Button — 统一按钮封装
 *
 * 基于 globals.css 设计 token，所有页面复用。
 * 保持向后兼容的 props 接口，内部样式全部使用标准 token。
 */

const glassButtonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-medium",
    "rounded-[var(--r-10)]",
    "transition-all duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
    "active:scale-[0.97] active:brightness-95",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
    "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-gradient-to-b from-[var(--accent-strong)] to-[var(--accent-ink)]",
          "text-[var(--accent-contrast)]",
          "shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--accent-strong)_40%,transparent),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_color-mix(in_oklch,var(--accent-strong)_50%,transparent),inset_0_1px_0_rgba(255,255,255,0.2)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
        secondary: [
          "bg-[var(--panel-bg)]/60 backdrop-blur-xl",
          "text-[var(--ink)]",
          "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]",
          "hover:bg-[var(--panel-bg)]/80",
          "hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.15)]",
          "border border-[var(--hairline)]/50",
        ],
        ghost: [
          "bg-transparent",
          "text-[var(--ink)]",
          "hover:bg-[var(--ink)]/5",
          "active:bg-[var(--ink)]/10",
        ],
        outline: [
          "bg-transparent",
          "text-[var(--accent-strong)]",
          "border border-[var(--accent-border)]",
          "hover:bg-[var(--accent-soft)]",
          "hover:border-[var(--accent-strong)]",
          "shadow-none",
          "hover:shadow-[0_0_12px_-2px_color-mix(in_oklch,var(--accent-strong)_30%,transparent)]",
        ],
        destructive: [
          "bg-gradient-to-b from-[var(--danger)] to-[var(--danger)]/90",
          "text-white",
          "shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--danger)_40%,transparent),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_color-mix(in_oklch,var(--danger)_50%,transparent)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
        success: [
          "bg-gradient-to-b from-[var(--ok)] to-[var(--ok)]/90",
          "text-white",
          "shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--ok)_40%,transparent),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_color-mix(in_oklch,var(--ok)_50%,transparent)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
        teal: [
          "bg-gradient-to-b from-[var(--info)] to-[var(--info)]/80",
          "text-white",
          "shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--info)_40%,transparent),inset_0_1px_0_rgba(255,255,255,0.15)]",
          "hover:shadow-[0_4px_16px_-2px_color-mix(in_oklch,var(--info)_50%,transparent)]",
          "hover:brightness-110",
          "border border-white/10",
        ],
        blueprint: [
          "bg-transparent",
          "text-[var(--foreground)]",
          "border border-[var(--border)]",
          "rounded-none",
          "font-mono text-[11px] font-bold uppercase tracking-widest",
          "hover:bg-[var(--accent-strong)]/5 hover:border-[var(--accent-strong)]/50",
          "active:bg-[var(--accent-strong)]/10 active:scale-[0.98]",
          "shadow-none",
        ],
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-[var(--r-6)]",
        default: "h-10 px-4",
        lg: "h-12 px-6 text-base rounded-[var(--r-14)]",
        xl: "h-14 px-8 text-lg rounded-[var(--r-14)]",
        icon: "size-10",
        "icon-sm": "size-8 rounded-[var(--r-6)]",
        "icon-lg": "size-12 rounded-[var(--r-14)]",
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
