"use client"

import { Toaster } from "sonner"
import { cn } from "@/lib/utils"

export function GlassPillToaster() {
  return (
    <Toaster 
      position="bottom-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            // 基础样式：玻璃胶囊效果
            "bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl",
            "rounded-full px-6 py-3 flex items-center gap-3",
            "w-auto min-w-[300px] max-w-md",
            "relative overflow-hidden",
            // 动画效果
            "animate-in slide-in-from-bottom-5 fade-in-0 duration-300 ease-out",
            "hover:scale-105 transition-transform duration-200",
            // 文字样式
            "text-white"
          ),
          title: "font-medium text-sm text-white",
          description: "text-white/70 text-xs mt-0.5",
          actionButton: cn(
            "bg-white/20 hover:bg-white/30 text-white rounded-full",
            "px-3 py-1 text-xs font-medium",
            "transition-colors duration-200",
            "border border-white/20"
          ),
          cancelButton: cn(
            "bg-white/10 hover:bg-white/20 text-white/70 hover:text-white",
            "rounded-full px-3 py-1 text-xs font-medium",
            "transition-colors duration-200"
          ),
          close: cn(
            "text-white/50 hover:text-white transition-colors",
            "p-1 rounded-full hover:bg-white/10"
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