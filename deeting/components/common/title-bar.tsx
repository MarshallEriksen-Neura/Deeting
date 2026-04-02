"use client";

import { useState, useEffect } from "react";
import { Minus, Square, X } from "lucide-react";
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
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("hide_main_show_island");
    } catch (error) {
      console.error("Failed to minimize window:", error);
      // Fallback: plain minimize
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
      } catch {
        // ignore
      }
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
        "fixed top-0 left-0 right-0 z-[60]",
        "h-[var(--desktop-title-bar-height,2.25rem)] flex items-center justify-between px-3 select-none",
        "bg-transparent backdrop-blur-sm",
        "transition-colors duration-200"
      )}
    >
      {/* 左侧：标题 */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2"
      >
        <span
          className="text-sm font-semibold tracking-wide bg-gradient-to-r from-[var(--primary)] to-[var(--teal-accent)] bg-clip-text text-transparent"
          style={{ fontFamily: "'AlibabaPuHuiTi', sans-serif" }}
        >
          Deeting
        </span>
      </div>

      {/* 中间：拖拽区域 */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* 右侧：窗口控制按钮 */}
      <div className="flex items-center">
        <button
          onClick={handleMinimize}
          className={cn(
            "w-12 h-full flex items-center justify-center",
            "text-[var(--foreground)]/50 hover:text-[var(--foreground)]",
            "hover:bg-black/5 dark:hover:bg-white/8",
            "transition-colors duration-150"
          )}
          aria-label="最小化"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleMaximize}
          className={cn(
            "w-12 h-full flex items-center justify-center",
            "text-[var(--foreground)]/50 hover:text-[var(--foreground)]",
            "hover:bg-black/5 dark:hover:bg-white/8",
            "transition-colors duration-150"
          )}
          aria-label={isMaximized ? "还原" : "最大化"}
        >
          <Square className={cn("w-3 h-3", isMaximized && "scale-75")} />
        </button>

        <button
          onClick={handleClose}
          className={cn(
            "w-12 h-full flex items-center justify-center",
            "text-[var(--foreground)]/50 hover:text-white",
            "hover:bg-red-500",
            "transition-colors duration-150"
          )}
          aria-label="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
