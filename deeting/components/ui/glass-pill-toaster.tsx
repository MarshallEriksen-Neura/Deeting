"use client"

import { Toaster } from "sonner"
import { cn } from "@/lib/utils"

export function GlassPillToaster() {
  return (
    <Toaster 
      position="top-right"
      offset={{ top: 16, right: 16 }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            // 基础样式：玻璃胶囊效果
            "bg-white/90 text-slate-900 border border-black/10 shadow-lg",
            "dark:bg-white/10 dark:text-white dark:border-white/20 dark:shadow-2xl",
            "backdrop-blur-xl",
            "rounded-full px-6 py-3 flex items-center gap-3",
            "w-auto min-w-[300px] max-w-md",
            "relative overflow-hidden",
            // 动画效果
            "animate-in slide-in-from-bottom-5 fade-in-0 duration-300 ease-out",
            "hover:scale-105 transition-transform duration-200",
          ),
          title: "font-medium text-sm text-slate-900 dark:text-white",
          description: "text-slate-600 text-xs mt-0.5 dark:text-white/70",
          actionButton: cn(
            "bg-black/5 hover:bg-black/10 text-slate-900 border border-black/10",
            "dark:bg-white/20 dark:hover:bg-white/30 dark:text-white dark:border-white/20",
            "rounded-full",
            "px-3 py-1 text-xs font-medium",
            "transition-colors duration-200"
          ),
          cancelButton: cn(
            "bg-black/5 hover:bg-black/10 text-slate-600 hover:text-slate-900",
            "dark:bg-white/10 dark:hover:bg-white/20 dark:text-white/70 dark:hover:text-white",
            "rounded-full px-3 py-1 text-xs font-medium",
            "transition-colors duration-200"
          ),
          close: cn(
            "text-slate-500 hover:text-slate-900 transition-colors",
            "dark:text-white/50 dark:hover:text-white",
            "p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
          ),
        },
      }}
      // 自定义关闭按钮
      closeButton={false}
      // 进入和退出动画
      expand={false}
      richColors
    />
  )
}
