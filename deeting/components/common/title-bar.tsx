"use client";

import { useEffect, useState } from "react";
import { Minus, X } from "lucide-react";

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function TitleBar() {
  const [isTauri, setIsTauri] = useState(false);
  const [isIslandWindow, setIsIslandWindow] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    setIsTauri(true);
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        setIsIslandWindow(getCurrentWindow().label === "island");
      })
      .catch(() => {
        setIsIslandWindow(false);
      });
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
          aria-label="最小化"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-[var(--ink-3)] transition-colors duration-150 hover:bg-red-500 hover:text-white"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
