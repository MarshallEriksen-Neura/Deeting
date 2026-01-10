"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { cva, type VariantProps } from "class-variance-authority"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * iOS-style Glass Dropdown Menu
 *
 * 设计理念:
 * - iOS 磨砂玻璃效果 (Frosted Glass / Glassmorphism)
 * - 流畅的弹出动画 (Spring Animation)
 * - 圆润的圆角和柔和的阴影
 * - 悬停时的微妙高亮效果
 * - 支持图标、快捷键、分组等功能
 */

// ============================================================================
// Root & Trigger
// ============================================================================

const GlassDropdownMenu = DropdownMenuPrimitive.Root

const GlassDropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const GlassDropdownMenuPortal = DropdownMenuPrimitive.Portal

const GlassDropdownMenuGroup = DropdownMenuPrimitive.Group

const GlassDropdownMenuSub = DropdownMenuPrimitive.Sub

const GlassDropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

// ============================================================================
// Content Variants
// ============================================================================

const glassDropdownContentVariants = cva(
  // Base styles - iOS 磨砂玻璃基础
  [
    "z-50 min-w-[180px] overflow-hidden",
    "rounded-2xl", // iOS 风格大圆角
    "p-1.5",
    // 磨砂玻璃效果
    "bg-[var(--surface)]/80 backdrop-blur-2xl",
    // 边框 - 模拟光线折射
    "border border-white/10",
    // 阴影 - iOS 风格多层阴影
    "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3),0_4px_16px_-4px_rgba(0,0,0,0.2)]",
    // 动画
    "data-[state=open]:animate-in data-[state=closed]:animate-out",
    "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
    "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
    "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
    "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
  ],
  {
    variants: {
      // 模糊强度
      blur: {
        sm: "backdrop-blur-sm bg-[var(--surface)]/90",
        default: "backdrop-blur-2xl bg-[var(--surface)]/80",
        lg: "backdrop-blur-3xl bg-[var(--surface)]/70",
      },
      // 颜色主题
      theme: {
        default: "",
        primary: "[--glass-highlight:rgba(124,109,255,0.1)]",
        teal: "[--glass-highlight:rgba(33,201,195,0.1)]",
      },
    },
    defaultVariants: {
      blur: "default",
      theme: "default",
    },
  }
)

// ============================================================================
// Content
// ============================================================================

interface GlassDropdownMenuContentProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>,
    VariantProps<typeof glassDropdownContentVariants> {
  /** 是否显示顶部高光效果 */
  shine?: boolean
  /** 是否显示内边框 */
  innerBorder?: boolean
}

const GlassDropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  GlassDropdownMenuContentProps
>(({ className, sideOffset = 8, blur, theme, shine = true, innerBorder = true, children, ...props }, ref) => (
  <GlassDropdownMenuPortal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(glassDropdownContentVariants({ blur, theme, className }))}
      {...props}
    >
      {/* 顶部高光 - 模拟光线效果 */}
      {shine && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15) 50%, transparent)",
          }}
        />
      )}

      {/* 内边框 - 增加层次感 */}
      {innerBorder && (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        />
      )}

      {children}
    </DropdownMenuPrimitive.Content>
  </GlassDropdownMenuPortal>
))
GlassDropdownMenuContent.displayName = "GlassDropdownMenuContent"

// ============================================================================
// Item Variants
// ============================================================================

const glassDropdownItemVariants = cva(
  // Base styles
  [
    "relative flex cursor-pointer select-none items-center gap-2",
    "rounded-xl px-3 py-2.5", // iOS 风格圆角和内边距
    "text-sm font-medium",
    "text-[var(--foreground)]",
    "outline-none",
    // 过渡动画
    "transition-all duration-150 ease-out",
    // 禁用状态
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
  ],
  {
    variants: {
      variant: {
        default: [
          "hover:bg-[var(--primary)]/10",
          "focus:bg-[var(--primary)]/10",
          "active:bg-[var(--primary)]/15 active:scale-[0.98]",
        ],
        destructive: [
          "text-red-400",
          "hover:bg-red-500/10 hover:text-red-400",
          "focus:bg-red-500/10 focus:text-red-400",
          "active:bg-red-500/15 active:scale-[0.98]",
        ],
        success: [
          "text-emerald-400",
          "hover:bg-emerald-500/10 hover:text-emerald-400",
          "focus:bg-emerald-500/10 focus:text-emerald-400",
          "active:bg-emerald-500/15 active:scale-[0.98]",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// ============================================================================
// Item
// ============================================================================

interface GlassDropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>,
    VariantProps<typeof glassDropdownItemVariants> {
  inset?: boolean
  /** 左侧图标 */
  icon?: React.ReactNode
  /** 右侧快捷键提示 */
  shortcut?: string
  /** 是否选中 (用于选择列表) */
  selected?: boolean
}

const GlassDropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  GlassDropdownMenuItemProps
>(({ className, variant, inset, icon, shortcut, selected, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      glassDropdownItemVariants({ variant }),
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {icon && (
      <span className="flex size-5 shrink-0 items-center justify-center text-[var(--muted)]">
        {icon}
      </span>
    )}
    <span className="flex-1">{children}</span>
    {selected && (
      <Check className="size-4 text-[var(--primary)]" />
    )}
    {shortcut && (
      <span className="ml-auto text-xs tracking-widest text-[var(--muted)]">
        {shortcut}
      </span>
    )}
  </DropdownMenuPrimitive.Item>
))
GlassDropdownMenuItem.displayName = "GlassDropdownMenuItem"

// ============================================================================
// Checkbox Item
// ============================================================================

const GlassDropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      glassDropdownItemVariants({ variant: "default" }),
      "pl-8",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-3 flex size-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="size-4 text-[var(--primary)]" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
GlassDropdownMenuCheckboxItem.displayName = "GlassDropdownMenuCheckboxItem"

// ============================================================================
// Radio Item
// ============================================================================

const GlassDropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      glassDropdownItemVariants({ variant: "default" }),
      "pl-8",
      className
    )}
    {...props}
  >
    <span className="absolute left-3 flex size-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="size-2 fill-[var(--primary)] text-[var(--primary)]" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
GlassDropdownMenuRadioItem.displayName = "GlassDropdownMenuRadioItem"

// ============================================================================
// Label
// ============================================================================

const GlassDropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
GlassDropdownMenuLabel.displayName = "GlassDropdownMenuLabel"

// ============================================================================
// Separator
// ============================================================================

const GlassDropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(
      "-mx-1.5 my-1.5 h-px",
      "bg-gradient-to-r from-transparent via-[var(--border)] to-transparent",
      className
    )}
    {...props}
  />
))
GlassDropdownMenuSeparator.displayName = "GlassDropdownMenuSeparator"

// ============================================================================
// Sub Menu Trigger
// ============================================================================

const GlassDropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
    icon?: React.ReactNode
  }
>(({ className, inset, icon, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      glassDropdownItemVariants({ variant: "default" }),
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {icon && (
      <span className="flex size-5 shrink-0 items-center justify-center text-[var(--muted)]">
        {icon}
      </span>
    )}
    <span className="flex-1">{children}</span>
    <ChevronRight className="size-4 text-[var(--muted)]" />
  </DropdownMenuPrimitive.SubTrigger>
))
GlassDropdownMenuSubTrigger.displayName = "GlassDropdownMenuSubTrigger"

// ============================================================================
// Sub Menu Content
// ============================================================================

const GlassDropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(glassDropdownContentVariants(), className)}
    {...props}
  />
))
GlassDropdownMenuSubContent.displayName = "GlassDropdownMenuSubContent"

// ============================================================================
// Shortcut (辅助组件)
// ============================================================================

const GlassDropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("ml-auto text-xs tracking-widest text-[var(--muted)]", className)}
    {...props}
  />
)
GlassDropdownMenuShortcut.displayName = "GlassDropdownMenuShortcut"

// ============================================================================
// User Info Header (便捷组件 - 用于用户菜单)
// ============================================================================

interface GlassDropdownUserHeaderProps {
  name: string
  email?: string
  avatar?: React.ReactNode
  className?: string
}

const GlassDropdownUserHeader = React.forwardRef<
  HTMLDivElement,
  GlassDropdownUserHeaderProps
>(({ name, email, avatar, className }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-3 px-3 py-2.5", className)}>
    {avatar && (
      <div className="shrink-0">{avatar}</div>
    )}
    <div className="flex flex-col">
      <span className="text-sm font-semibold text-[var(--foreground)]">{name}</span>
      {email && (
        <span className="text-xs text-[var(--muted)]">{email}</span>
      )}
    </div>
  </div>
))
GlassDropdownUserHeader.displayName = "GlassDropdownUserHeader"

// ============================================================================
// Exports
// ============================================================================

export {
  GlassDropdownMenu,
  GlassDropdownMenuTrigger,
  GlassDropdownMenuPortal,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuCheckboxItem,
  GlassDropdownMenuRadioItem,
  GlassDropdownMenuLabel,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuGroup,
  GlassDropdownMenuSub,
  GlassDropdownMenuSubTrigger,
  GlassDropdownMenuSubContent,
  GlassDropdownMenuRadioGroup,
  GlassDropdownMenuShortcut,
  GlassDropdownUserHeader,
  // Variants for customization
  glassDropdownContentVariants,
  glassDropdownItemVariants,
}
