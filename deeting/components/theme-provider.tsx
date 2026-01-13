"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/store/theme-store";
import { ThemeTransitionOverlay } from "@/components/theme-transition-overlay";

interface ThemeProviderProps {
  children: React.ReactNode;
  /** 默认主题 */
  defaultTheme?: "light" | "dark" | "system";
  /** 是否启用系统主题跟随 */
  enableSystem?: boolean;
  /** 是否禁用过渡动画 */
  disableTransition?: boolean;
}

/**
 * 增强的主题提供者
 * 集成 next-themes、Zustand 持久化和平滑过渡效果
 */
export function ThemeProvider({
  children,
  defaultTheme = "system",
  enableSystem = true,
  disableTransition = false,
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem={enableSystem}
      disableTransitionOnChange={false}
      storageKey="deeting-theme"
    >
      {children}
      {!disableTransition && <ThemeTransitionOverlay />}
    </NextThemesProvider>
  );
}

/**
 * 主题切换按钮组件
 * 集成 Zustand store 实现过渡动画状态管理
 */
export function ThemeToggle({
  className,
  size = "default",
}: {
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const { setTheme, resolvedTheme } = useTheme();
  const { isTransitioning, startTransition, endTransition } = useThemeStore();
  const [mounted, setMounted] = React.useState(false);

  // 避免 SSR 不匹配
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleToggle = async () => {
    if (isTransitioning) return;

    // 开始过渡动画
    startTransition();

    // 等待遮罩层淡入
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 切换主题
    const newTheme = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(newTheme);

    // 等待主题应用完成后淡出遮罩
    await new Promise((resolve) => setTimeout(resolve, 400));

    // 结束过渡动画
    endTransition();
  };

  const iconSizes = {
    sm: "w-4 h-4",
    default: "w-5 h-5",
    lg: "w-6 h-6",
  };

  const buttonSizes = {
    sm: "icon-sm",
    default: "icon",
    lg: "icon-lg",
  } as const;

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size={buttonSizes[size]}
      onClick={handleToggle}
      disabled={!mounted || isTransitioning}
      className={cn(
        "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--primary)]/10",
        "relative group",
        className
      )}
      title={mounted ? (isDark ? "切换到亮色模式" : "切换到暗色模式") : undefined}
      aria-label={mounted ? (isDark ? "切换到亮色模式" : "切换到暗色模式") : undefined}
    >
      {!mounted ? (
        <div
          className={cn(
            iconSizes[size],
            "bg-[var(--muted-surface)]/30 rounded animate-pulse"
          )}
        />
      ) : (
        <>
          {/* 太阳图标 */}
          <svg
            className={`
              ${iconSizes[size]}
              absolute
              transition-all duration-300 ease-out
              text-amber-500
              ${isDark ? "opacity-0 rotate-90 scale-0" : "opacity-100 rotate-0 scale-100"}
              group-hover:text-amber-400
            `}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
            />
          </svg>

          {/* 月亮图标 */}
          <svg
            className={`
              ${iconSizes[size]}
              absolute
              transition-all duration-300 ease-out
              text-[var(--primary-soft)]
              ${isDark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-0"}
              group-hover:text-[var(--primary)]
            `}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
            />
          </svg>
        </>
      )}
    </Button>
  );
}

/**
 * 主题选择器组件（支持 system）
 * 集成 Zustand store 实现过渡动画状态管理
 */
export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { isTransitioning, startTransition, endTransition } = useThemeStore();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleSelect = async (newTheme: "light" | "dark" | "system") => {
    if (isTransitioning || theme === newTheme) return;

    startTransition();
    await new Promise((resolve) => setTimeout(resolve, 200));
    setTheme(newTheme);
    await new Promise((resolve) => setTimeout(resolve, 400));
    endTransition();
  };

  if (!mounted) {
    return <div className={`h-10 bg-[var(--surface)]/50 rounded-lg animate-pulse ${className}`} />;
  }

  const options = [
    { value: "light", label: "亮色", icon: "☀️" },
    { value: "dark", label: "暗色", icon: "🌙" },
    { value: "system", label: "跟随系统", icon: "💻" },
  ] as const;

  return (
    <div
      className={`
        flex gap-1 p-1
        bg-[var(--surface)]/50 backdrop-blur-sm
        border border-[var(--border)]/50
        rounded-lg
        ${className}
      `}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          onClick={() => handleSelect(option.value)}
          disabled={isTransitioning}
          className={`
            flex items-center gap-1.5 px-3 py-1.5
            rounded-md
            text-sm font-medium
            transition-all duration-200
            ${
              theme === option.value
                ? "bg-[var(--primary)]/20 text-[var(--primary)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]/80"
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          <span>{option.icon}</span>
          <span>{option.label}</span>
        </Button>
      ))}
    </div>
  );
}
