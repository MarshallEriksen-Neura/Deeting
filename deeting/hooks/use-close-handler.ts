"use client";

import { useEffect, useState, useCallback } from "react";
import {
  type DesktopWindowCloseAction,
  getDesktopConfig,
  setDesktopWindowCloseAction,
  DESKTOP_CONFIG_KEYS,
  normalizeDesktopWindowCloseAction,
} from "@/lib/api/desktop-config";
import { usePlatform } from "@/lib/platform/provider";

const LEGACY_STORAGE_KEY = "deeting-close-action";
const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";

export function useCloseHandler() {
  const [showDialog, setShowDialog] = useState(false);
  const { app } = usePlatform();

  const executeAction = useCallback(async (action: DesktopWindowCloseAction) => {
    if (!isTauri || typeof window === "undefined") return;
    try {
      switch (action) {
        case "show_island": {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("hide_main_show_island");
          break;
        }
        case "minimize":
          await app.minimize();
          break;
        default:
          await app.quit();
      }
    } catch (err) {
      console.error("close action failed:", err);
    }
  }, [app]);

  const loadSavedAction = useCallback(async (): Promise<DesktopWindowCloseAction | null> => {
    const saved = await getDesktopConfig(DESKTOP_CONFIG_KEYS.desktopWindowCloseAction);
    if (saved?.trim()) {
      return normalizeDesktopWindowCloseAction(saved);
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === "minimize" || legacy === "quit") {
      await setDesktopWindowCloseAction(legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return legacy;
    }

    return null;
  }, []);

  const handleChoose = useCallback(
    (action: DesktopWindowCloseAction, remember: boolean) => {
      setShowDialog(false);
      if (remember && typeof window !== "undefined") {
        void setDesktopWindowCloseAction(action);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      void executeAction(action);
    },
    [executeAction]
  );

  useEffect(() => {
    if (!isTauri || typeof window === "undefined") return;

    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("close-requested", () => {
        void (async () => {
          const saved = await loadSavedAction();
          if (saved) {
            await executeAction(saved);
            return;
          }
          setShowDialog(true);
        })();
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [executeAction, loadSavedAction]);

  return { showDialog, handleChoose };
}
