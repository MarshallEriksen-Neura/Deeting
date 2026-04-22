"use client";

import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function TitleBar() {
  const [isTauri, setIsTauri] = useState(false);
  const [isIslandWindow, setIsIslandWindow] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    setIsTauri(true);
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const setupWindowState = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();

        if (disposed) return;

        setIsIslandWindow(currentWindow.label === "island");
        setIsMaximized(await currentWindow.isMaximized());

        cleanup = await currentWindow.onResized(async () => {
          if (disposed) return;
          setIsMaximized(await currentWindow.isMaximized());
        });
      } catch {
        if (disposed) return;
        setIsIslandWindow(false);
        setIsMaximized(false);
      }
    };

    void setupWindowState();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  if (!isTauri || isIslandWindow) return null;

  const handleMinimize = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("minimize_main_hide_island");
    } catch (error) {
      console.error("Failed to minimize window:", error);
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
      } catch {
        // ignore fallback failure
      }
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      if (await currentWindow.isMaximized()) {
        await currentWindow.unmaximize();
        setIsMaximized(false);
        return;
      }

      await currentWindow.maximize();
      setIsMaximized(true);
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
      className="fixed top-0 left-0 right-0 z-[60] flex h-[var(--desktop-title-bar-height,2rem)] items-center justify-between bg-[var(--shell-chrome-bg)] px-3 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1"
      />

      <div className="absolute top-0 right-0 flex h-full items-center">
        <button
          type="button"
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-[var(--ink-3)] transition-colors duration-150 hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/8"
          aria-label="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          className="flex h-full w-11 items-center justify-center text-[var(--ink-3)] transition-colors duration-150 hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/8"
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          <Square className={isMaximized ? "h-3 w-3 scale-75" : "h-3 w-3"} />
        </button>

        <button
          type="button"
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-[var(--ink-3)] transition-colors duration-150 hover:bg-red-500 hover:text-white"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
