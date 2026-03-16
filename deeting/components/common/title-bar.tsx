"use client";

import { useState, useEffect } from "react";
import { Minus, Square, X, AppWindow } from "lucide-react";
import { cn } from "@/lib/utils";

const isTauriRuntime = () => {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
};

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    setIsTauri(isTauriRuntime());
  }, []);

  // 只在 Tauri 桌面端显示自定义标题栏
  if (!isTauri) return null;

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  };

  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      if (await window.isMaximized()) {
        await window.unmaximize();
        setIsMaximized(false);
      } else {
        await window.maximize();
        setIsMaximized(true);
      }
    } catch (error) {
      console.error("Failed to maximize/unmaximize window:", error);
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "h-9 flex items-center justify-between px-3 select-none",
        "bg-[var(--surface)]/95 backdrop-blur-md",
        "border-b border-[var(--border)]",
        "transition-colors duration-200"
      )}
    >
      {/* 左侧：Logo 和标题 */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 text-[var(--foreground)]"
      >
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[var(--primary)] to-[var(--teal-accent)] flex items-center justify-center">
          <AppWindow className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-medium tracking-tight">Deeting</span>
      </div>

      {/* 中间：拖拽区域 */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* 右侧：窗口控制按钮 */}
      <div className="flex items-center gap-1">
        {/* 最小化按钮 */}
        <button
          onClick={handleMinimize}
          className={cn(
            "w-8 h-6 flex items-center justify-center rounded",
            "text-[var(--muted)] hover:text-[var(--foreground)]",
            "hover:bg-[var(--muted-surface)]/50",
            "transition-all duration-150"
          )}
          aria-label="最小化"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* 最大化/还原按钮 */}
        <button
          onClick={handleMaximize}
          className={cn(
            "w-8 h-6 flex items-center justify-center rounded",
            "text-[var(--muted)] hover:text-[var(--foreground)]",
            "hover:bg-[var(--muted-surface)]/50",
            "transition-all duration-150"
          )}
          aria-label={isMaximized ? "还原" : "最大化"}
        >
          <Square className={cn("w-3 h-3", isMaximized && "scale-75")} />
        </button>

        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className={cn(
            "w-8 h-6 flex items-center justify-center rounded",
            "text-[var(--muted)] hover:text-white",
            "hover:bg-red-500",
            "transition-all duration-150"
          )}
          aria-label="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
